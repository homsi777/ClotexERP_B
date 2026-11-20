import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {manufacturingSpecificationRevisionRoutes} from './manufacturingSpecificationRevisionRoutes.js';
import {manufacturingBeamQualityRoutes} from './manufacturingBeamQualityRoutes.js';
import {manufacturingOperationalReportRoutes} from './manufacturingOperationalReportRoutes.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, type JwtPayload } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  MACHINE_STATUSES,
  canTransitionMachineStatus,
  normalizeReferenceCode,
  validateMachineOwnership,
  validateMaintenanceCompletion,
  type MachineStatus,
} from '../services/manufacturingReferenceRules.js';
import {
  previewManufacturingSpecificationWorkbook,
  previewWarpCardTemplate,
} from '../services/manufacturingSpecificationWorkbook.js';

const machineTypeSchema = z.enum(['WARPING', 'SIZING', 'LOOM', 'PROCESSING', 'INSPECTION', 'OTHER']);
const machineStatusSchema = z.enum(MACHINE_STATUSES);
const ownershipSchema = z.enum(['COMPANY', 'CUSTODY']);
const stageSchema = z.enum(['ALL', 'WARPING', 'SIZING', 'WEAVING', 'PROCESSING', 'INSPECTION']);
const inspectionTypeSchema = z.enum(['ALL', 'WARP_BEAM', 'SIZED_BEAM', 'RAW_FABRIC', 'FINISHED_FABRIC']);
const severitySchema = z.enum(['MINOR', 'MAJOR', 'CRITICAL']);

const nullableText = z.string().trim().max(1000).nullable().optional();
const codeText = z.string().trim().min(1).max(64);
const nameText = z.string().trim().min(1).max(160);
const workbookPreviewSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine((name) => /\.xlsx?$/i.test(name), 'يجب اختيار ملف Excel بصيغة xlsx أو xls'),
  documentType: z.enum(['SPECIFICATION', 'WARP_CARD']).default('SPECIFICATION'),
  base64: z.string().min(1).max(5_600_000),
});
const workbookImportSchema = workbookPreviewSchema.extend({
  documentType: z.literal('SPECIFICATION').default('SPECIFICATION'),
  code: codeText,
  name: nameText,
  description: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function decodeWorkbookUpload(data: z.infer<typeof workbookPreviewSchema>): { buffer: Buffer } | { error: string; code: string } {
  const buffer = Buffer.from(data.base64, 'base64');
  if (buffer.length === 0 || buffer.length > 4 * 1024 * 1024) {
    return { error: 'حجم ملف Excel يجب ألا يتجاوز 4 ميغابايت', code: 'FILE_TOO_LARGE' };
  }
  const isZipWorkbook = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isLegacyWorkbook = buffer.length >= 8
    && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (!isZipWorkbook && !isLegacyWorkbook) return { error: 'محتوى الملف لا يطابق صيغة Excel', code: 'INVALID_FILE' };
  return { buffer };
}

const departmentSchema = z.object({
  code: codeText,
  name: nameText,
  description: nullableText,
  isActive: z.boolean().optional(),
});

const machineSchema = z.object({
  departmentId: z.string().uuid().nullable().optional(),
  code: codeText,
  name: nameText,
  machineType: machineTypeSchema,
  widthCm: z.number().positive().nullable().optional(),
  fixedLocation: z.string().trim().max(240).nullable().optional(),
  manufacturer: z.string().trim().max(160).nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  serialNumber: z.string().trim().max(160).nullable().optional(),
  manufactureYear: z.number().int().min(1800).max(2100).nullable().optional(),
  powerKw: z.number().positive().nullable().optional(),
  ratedSpeed: z.number().positive().nullable().optional(),
  ratedSpeedUnit: z.enum(['RPM', 'PICKS_PER_MINUTE', 'METERS_PER_MINUTE', 'OTHER']).nullable().optional(),
  technicalSpecs: z.record(z.union([z.string().max(1_500_000), z.number(), z.boolean()])).superRefine((value,ctx) => {
    if (Object.keys(value).length > 50) ctx.addIssue({ code:z.ZodIssueCode.custom,message:'عدد حقول المواصفات الفنية يتجاوز الحد المسموح' });
    const image=value.sheddingTypeImage;
    if (typeof image==='string' && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) ctx.addIssue({ code:z.ZodIssueCode.custom,path:['sheddingTypeImage'],message:'صورة نوع اللقية غير صالحة' });
    const gear=Number(value.gearTooth); if(value.gearTooth!==undefined && (!Number.isInteger(gear)||gear<1||gear>100)) ctx.addIssue({code:z.ZodIssueCode.custom,path:['gearTooth'],message:'المسنن يجب أن يكون من 1 إلى 100'});
  }).optional(),
  assetValue: z.number().min(0).nullable().optional(),
  assetCurrencyCode: z.string().trim().length(3).nullable().optional(),
  ownershipType: ownershipSchema.default('COMPANY'),
  ownerName: z.string().trim().max(240).nullable().optional(),
  notes: nullableText,
  isActive: z.boolean().optional(),
  version: z.number().int().positive().optional(),
});

const downtimeReasonSchema = z.object({
  code: codeText,
  name: nameText,
  stage: stageSchema.default('ALL'),
  isPlanned: z.boolean().default(false),
  isActive: z.boolean().optional(),
});

const defectSchema = z.object({
  code: codeText,
  name: nameText,
  inspectionType: inspectionTypeSchema.default('ALL'),
  defaultSeverity: severitySchema.nullable().optional(),
  description: nullableText,
  isActive: z.boolean().optional(),
});

const maintenanceSchema = z.object({
  eventType: z.enum(['BREAKDOWN', 'PREVENTIVE', 'CORRECTIVE', 'INSPECTION']),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('OPEN'),
  occurredAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  description: z.string().trim().min(1).max(2000),
  resolution: z.string().trim().max(2000).nullable().optional(),
  costAmount: z.number().min(0).nullable().optional(),
  costCurrencyCode: z.string().trim().length(3).nullable().optional(),
});

function hasPermission(user: JwtPayload | undefined, code: string): boolean {
  return Boolean(user && (user.role === 'admin' || user.permissions.includes(code)));
}

function requireAny(user: JwtPayload | undefined, codes: string[]): boolean {
  return codes.some((code) => hasPermission(user, code));
}

function handleDbError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === '23505') return sendError(reply, 409, 'الكود مستخدم مسبقًا ضمن الشركة', 'DUPLICATE');
  if (code === '23503') return sendError(reply, 409, 'المرجع المحدد غير موجود أو لا يتبع الشركة', 'CONFLICT');
  if (code === '23514') return sendError(reply, 400, 'البيانات لا تحقق قواعد التصنيع المعتمدة', 'VALIDATION');
  throw error;
}

export const manufacturingReferenceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticateRequest);
  await app.register(manufacturingSpecificationRevisionRoutes);
  await app.register(manufacturingBeamQualityRoutes);
  await app.register(manufacturingOperationalReportRoutes);

  app.post('/specifications/preview', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.reference.view', 'manufacturing.reference.manage'])) {
      return sendError(reply, 403, 'ليست لديك صلاحية معاينة ملفات مواصفات التصنيع', 'FORBIDDEN');
    }
    const parsed = workbookPreviewSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'ملف غير صالح', 'VALIDATION');

    const decoded = decodeWorkbookUpload(parsed.data);
    if ('error' in decoded) return sendError(reply, 400, decoded.error, decoded.code);

    try {
      const data = parsed.data.documentType === 'WARP_CARD'
        ? previewWarpCardTemplate(decoded.buffer)
        : previewManufacturingSpecificationWorkbook(decoded.buffer);
      return reply.send({ ok: true, data });
    } catch {
      return sendError(reply, 400, 'تعذر قراءة ملف Excel؛ تحقق من أن الملف غير تالف أو محمي بكلمة مرور', 'INVALID_WORKBOOK');
    }
  });

  app.get('/specifications', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.specifications.view', 'manufacturing.reference.view'])) {
      return sendError(reply, 403, 'ليست لديك صلاحية عرض مكتبة المواصفات', 'FORBIDDEN');
    }
    const query = req.query as { search?: string; active?: string };
    const params: unknown[] = [req.user!.companyId];
    const conditions = ['s.company_id=$1'];
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      conditions.push(`(s.code ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }
    if (query.active === 'true' || query.active === 'false') {
      params.push(query.active === 'true');
      conditions.push(`s.is_active=$${params.length}`);
    }
    const rows = await getPool().query(
      `SELECT s.id,s.code,s.name,s.description,s.version,s.is_active,s.created_at,s.updated_at,
              latest.id AS latest_version_id,latest.version_no AS latest_version_no,latest.status AS latest_status,
              latest.source_file_name AS latest_source_file_name,latest.source_file_size AS latest_source_file_size,
              latest.created_at AS latest_version_created_at,
              approved.id AS approved_version_id,approved.version_no AS approved_version_no,approved.approved_at
       FROM manufacturing_specifications s
       LEFT JOIN LATERAL (
         SELECT v.id,v.version_no,v.status,v.source_file_name,v.source_file_size,v.created_at
         FROM manufacturing_specification_versions v
         WHERE v.company_id=s.company_id AND v.specification_id=s.id
         ORDER BY v.version_no DESC LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT v.id,v.version_no,v.approved_at
         FROM manufacturing_specification_versions v
         WHERE v.company_id=s.company_id AND v.specification_id=s.id AND v.status='APPROVED'
         LIMIT 1
       ) approved ON true
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.is_active DESC,s.code`,
      params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.get('/specifications/:id/versions', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.specifications.view', 'manufacturing.reference.view'])) {
      return sendError(reply, 403, 'ليست لديك صلاحية عرض إصدارات المواصفات', 'FORBIDDEN');
    }
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'معرف البطاقة غير صالح', 'VALIDATION');
    const rows = await getPool().query(
      `SELECT v.id,v.version_no,v.status,v.source_file_name,v.source_file_size,v.source_file_sha256,
              v.parsed_data,v.validation_warnings,v.notes,v.approved_at,v.archived_at,v.created_at,
              creator.full_name AS created_by_name,approver.full_name AS approved_by_name
       FROM manufacturing_specification_versions v
       JOIN manufacturing_specifications s ON s.id=v.specification_id AND s.company_id=v.company_id
       LEFT JOIN users creator ON creator.id=v.created_by_user_id
       LEFT JOIN users approver ON approver.id=v.approved_by_user_id
       WHERE v.company_id=$1 AND v.specification_id=$2
       ORDER BY v.version_no DESC`,
      [req.user!.companyId, id],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post('/specifications/import', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.specifications.import')) {
      return sendError(reply, 403, 'ليست لديك صلاحية استيراد المواصفات', 'FORBIDDEN');
    }
    const parsed = workbookImportSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'بيانات الاستيراد غير صالحة', 'VALIDATION');
    const decoded = decodeWorkbookUpload(parsed.data);
    if ('error' in decoded) return sendError(reply, 400, decoded.error, decoded.code);

    let preview: ReturnType<typeof previewManufacturingSpecificationWorkbook>;
    try {
      preview = previewManufacturingSpecificationWorkbook(decoded.buffer);
    } catch {
      return sendError(reply, 400, 'تعذر قراءة ملف المواصفات', 'INVALID_WORKBOOK');
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const specification = await client.query<{ id: string }>(
        `INSERT INTO manufacturing_specifications(company_id,code,name,description,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,$5)
         ON CONFLICT(company_id,code) DO UPDATE SET
           name=EXCLUDED.name,description=COALESCE(EXCLUDED.description,manufacturing_specifications.description),
           version=manufacturing_specifications.version+1,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
         RETURNING id`,
        [req.user!.companyId, normalizeReferenceCode(parsed.data.code), parsed.data.name, parsed.data.description ?? null, req.user!.sub],
      );
      const specificationId = specification.rows[0].id;
      await client.query(
        `SELECT id FROM manufacturing_specifications WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [specificationId, req.user!.companyId],
      );
      const sha256 = createHash('sha256').update(decoded.buffer).digest('hex');
      const duplicate = await client.query(
        `SELECT id FROM manufacturing_specification_versions
         WHERE company_id=$1 AND specification_id=$2 AND source_file_sha256=$3 LIMIT 1`,
        [req.user!.companyId, specificationId, sha256],
      );
      if (duplicate.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 409, 'هذا الملف مستورد مسبقاً ضمن البطاقة نفسها', 'DUPLICATE_VERSION_FILE');
      }
      const next = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version_no),0)::int+1 AS next_version
         FROM manufacturing_specification_versions WHERE company_id=$1 AND specification_id=$2`,
        [req.user!.companyId, specificationId],
      );
      const version = await client.query(
        `INSERT INTO manufacturing_specification_versions(
           company_id,specification_id,version_no,status,source_file_name,source_file_content,source_file_size,
           source_file_sha256,parsed_data,validation_warnings,notes,created_by_user_id
         ) VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
         RETURNING id,version_no,status,source_file_name,source_file_size,source_file_sha256,parsed_data,validation_warnings,notes,created_at`,
        [req.user!.companyId,specificationId,next.rows[0].next_version,parsed.data.fileName,decoded.buffer,decoded.buffer.length,
          sha256,JSON.stringify(preview),JSON.stringify(preview.warnings),parsed.data.notes ?? null,req.user!.sub],
      );
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: { specificationId, code: normalizeReferenceCode(parsed.data.code), version: version.rows[0] } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return handleDbError(reply, error);
    } finally {
      client.release();
    }
  });

  app.post('/specifications/:id/versions/:versionId/approve', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.specifications.approve')) {
      return sendError(reply, 403, 'ليست لديك صلاحية اعتماد المواصفات', 'FORBIDDEN');
    }
    const { id, versionId } = req.params as { id: string; versionId: string };
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(versionId).success) {
      return sendError(reply, 400, 'معرف البطاقة أو الإصدار غير صالح', 'VALIDATION');
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<{ status: 'DRAFT' | 'APPROVED' | 'ARCHIVED' }>(
        `SELECT v.status FROM manufacturing_specification_versions v
         JOIN manufacturing_specifications s ON s.id=v.specification_id AND s.company_id=v.company_id
         WHERE v.id=$1 AND v.specification_id=$2 AND v.company_id=$3 FOR UPDATE`,
        [versionId,id,req.user!.companyId],
      );
      if (!target.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'إصدار المواصفة غير موجود', 'NOT_FOUND');
      }
      if (target.rows[0].status !== 'APPROVED') {
        await client.query(
          `UPDATE manufacturing_specification_versions
           SET status='ARCHIVED',archived_at=now()
           WHERE company_id=$1 AND specification_id=$2 AND status='APPROVED' AND id<>$3`,
          [req.user!.companyId,id,versionId],
        );
        await client.query(
          `UPDATE manufacturing_specification_versions
           SET status='APPROVED',approved_by_user_id=$4,approved_at=now(),archived_at=NULL
           WHERE id=$1 AND specification_id=$2 AND company_id=$3`,
          [versionId,id,req.user!.companyId,req.user!.sub],
        );
      }
      await client.query('COMMIT');
      return reply.send({ ok: true, data: { specificationId: id, versionId, status: 'APPROVED' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return handleDbError(reply,error);
    } finally {
      client.release();
    }
  });

  app.get('/specifications/:id/versions/:versionId/source', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.specifications.view', 'manufacturing.reference.view'])) {
      return sendError(reply, 403, 'ليست لديك صلاحية تنزيل ملف المواصفة', 'FORBIDDEN');
    }
    const { id, versionId } = req.params as { id: string; versionId: string };
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(versionId).success) {
      return sendError(reply, 400, 'معرف البطاقة أو الإصدار غير صالح', 'VALIDATION');
    }
    const row = await getPool().query<{ source_file_name: string; source_file_content: Buffer }>(
      `SELECT v.source_file_name,v.source_file_content
       FROM manufacturing_specification_versions v
       JOIN manufacturing_specifications s ON s.id=v.specification_id AND s.company_id=v.company_id
       WHERE v.id=$1 AND v.specification_id=$2 AND v.company_id=$3`,
      [versionId,id,req.user!.companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'ملف إصدار المواصفة غير موجود', 'NOT_FOUND');
    const fileName = row.rows[0].source_file_name.replace(/[\r\n"]/g, '_');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    reply.type(/\.xls$/i.test(fileName) ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return reply.send(row.rows[0].source_file_content);
  });

  app.get('/overview', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.dashboard.view', 'manufacturing.reference.view'])) {
      return sendError(reply, 403, 'ليست لديك صلاحية عرض تعريفات التصنيع', 'FORBIDDEN');
    }
    const { companyId } = req.user!;
    const pool = getPool();
    const row = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM manufacturing_departments WHERE company_id=$1 AND is_active) AS departments,
        (SELECT COUNT(*)::int FROM manufacturing_machines WHERE company_id=$1 AND is_active) AS machines,
        (SELECT COUNT(*)::int FROM manufacturing_machines WHERE company_id=$1 AND operational_status='ACTIVE' AND is_active) AS active_machines,
        (SELECT COUNT(*)::int FROM manufacturing_machines WHERE company_id=$1 AND operational_status IN ('STOPPED','MAINTENANCE')) AS unavailable_machines,
        (SELECT COUNT(*)::int FROM manufacturing_machine_maintenance_events WHERE company_id=$1 AND status IN ('OPEN','IN_PROGRESS')) AS open_maintenance,
        (SELECT COUNT(*)::int FROM manufacturing_downtime_reasons WHERE company_id=$1 AND is_active) AS downtime_reasons,
        (SELECT COUNT(*)::int FROM manufacturing_quality_defect_catalog WHERE company_id=$1 AND is_active) AS quality_defects`,
      [companyId],
    );
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.get('/departments', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.reference.view', 'manufacturing.dashboard.view'])) {
      return sendError(reply, 403, 'ليست لديك صلاحية عرض أقسام المصنع', 'FORBIDDEN');
    }
    const rows = await getPool().query(
      `SELECT id,code,name,description,is_active,created_at,updated_at
       FROM manufacturing_departments WHERE company_id=$1 ORDER BY is_active DESC,name`,
      [req.user!.companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post('/departments', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.reference.manage')) return sendError(reply, 403, 'ليست لديك صلاحية إدارة الأقسام', 'FORBIDDEN');
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'بيانات غير صالحة', 'VALIDATION');
    const d = parsed.data;
    try {
      const row = await getPool().query(
        `INSERT INTO manufacturing_departments(company_id,code,name,description,is_active,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$6)
         RETURNING id,code,name,description,is_active,created_at,updated_at`,
        [req.user!.companyId, normalizeReferenceCode(d.code), d.name, d.description ?? null, d.isActive ?? true, req.user!.sub],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (error) { return handleDbError(reply, error); }
  });

  app.put('/departments/:id', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.reference.manage')) return sendError(reply, 403, 'ليست لديك صلاحية إدارة الأقسام', 'FORBIDDEN');
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'بيانات غير صالحة', 'VALIDATION');
    const { id } = req.params as { id: string };
    const d = parsed.data;
    try {
      const row = await getPool().query(
        `UPDATE manufacturing_departments SET code=$3,name=$4,description=$5,is_active=$6,
           updated_by_user_id=$7,updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,code,name,description,is_active,created_at,updated_at`,
        [id, req.user!.companyId, normalizeReferenceCode(d.code), d.name, d.description ?? null, d.isActive ?? true, req.user!.sub],
      );
      if (!row.rows.length) return sendError(reply, 404, 'القسم غير موجود', 'NOT_FOUND');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (error) { return handleDbError(reply, error); }
  });

  app.get('/machines', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.reference.view', 'manufacturing.dashboard.view'])) {
      return sendError(reply, 403, 'ليست لديك صلاحية عرض الماكينات', 'FORBIDDEN');
    }
    const q = req.query as { search?: string; status?: string; departmentId?: string };
    const conditions = ['m.company_id=$1'];
    const params: unknown[] = [req.user!.companyId];
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`); conditions.push(`(m.code ILIKE $${params.length} OR m.name ILIKE $${params.length})`); }
    if (q.status && machineStatusSchema.safeParse(q.status).success) { params.push(q.status); conditions.push(`m.operational_status=$${params.length}`); }
    if (q.departmentId && z.string().uuid().safeParse(q.departmentId).success) { params.push(q.departmentId); conditions.push(`m.department_id=$${params.length}`); }
    const rows = await getPool().query(
      `SELECT m.id,m.department_id,d.name AS department_name,m.code,m.name,m.machine_type,m.width_cm,
              m.fixed_location,m.manufacturer,m.model,m.serial_number,m.manufacture_year,m.power_kw,
              m.rated_speed,m.rated_speed_unit,m.technical_specs-'sheddingTypeImage' AS technical_specs,
              (m.technical_specs ? 'sheddingTypeImage') AS has_shedding_type_image,m.asset_value,m.asset_currency_code,m.ownership_type,m.owner_name,
              m.operational_status,m.notes,m.version,m.is_active,m.created_at,m.updated_at,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('stage','WARPING','orderNo',x.warping_order_no,'workOrderNo',w.work_order_no,'status',x.status) ORDER BY x.created_at)
                FROM manufacturing_warping_orders x JOIN manufacturing_work_orders w ON w.id=x.work_order_id AND w.company_id=x.company_id
                WHERE x.company_id=m.company_id AND (x.warping_machine_id=m.id OR x.target_loom_id=m.id) AND x.status IN ('RELEASED','IN_PROGRESS')),'[]'::jsonb) AS current_operations
       FROM manufacturing_machines m
       LEFT JOIN manufacturing_departments d ON d.id=m.department_id AND d.company_id=m.company_id
       WHERE ${conditions.join(' AND ')} ORDER BY m.is_active DESC,m.code`, params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post('/machines', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.machines.manage')) return sendError(reply, 403, 'ليست لديك صلاحية إدارة الماكينات', 'FORBIDDEN');
    const parsed = machineSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'بيانات غير صالحة', 'VALIDATION');
    const d = parsed.data;
    const ownershipError = validateMachineOwnership({ ownershipType: d.ownershipType, ownerName: d.ownerName });
    if (ownershipError) return sendError(reply, 400, ownershipError, 'VALIDATION');
    try {
      const row = await getPool().query(
        `INSERT INTO manufacturing_machines(company_id,department_id,code,name,machine_type,width_cm,fixed_location,
          manufacturer,model,serial_number,manufacture_year,power_kw,rated_speed,rated_speed_unit,technical_specs,
          asset_value,asset_currency_code,ownership_type,owner_name,notes,is_active,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$22)
         RETURNING *`,
        [req.user!.companyId,d.departmentId ?? null,normalizeReferenceCode(d.code),d.name,d.machineType,d.widthCm ?? null,
          d.fixedLocation ?? null,d.manufacturer ?? null,d.model ?? null,d.serialNumber ?? null,d.manufactureYear ?? null,
          d.powerKw ?? null,d.ratedSpeed ?? null,d.ratedSpeedUnit ?? null,JSON.stringify(d.technicalSpecs ?? {}),
          d.assetValue ?? null,d.assetCurrencyCode?.toUpperCase() ?? null,d.ownershipType,
          d.ownershipType === 'CUSTODY' ? d.ownerName?.trim() : null,d.notes ?? null,d.isActive ?? true,req.user!.sub],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (error) { return handleDbError(reply, error); }
  });

  app.put('/machines/:id', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.machines.manage')) return sendError(reply, 403, 'ليست لديك صلاحية إدارة الماكينات', 'FORBIDDEN');
    const parsed = machineSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.version) return sendError(reply, 400, 'بيانات الماكينة ورقم النسخة مطلوبة', 'VALIDATION');
    const d = parsed.data;
    const ownershipError = validateMachineOwnership({ ownershipType: d.ownershipType, ownerName: d.ownerName });
    if (ownershipError) return sendError(reply, 400, ownershipError, 'VALIDATION');
    const { id } = req.params as { id: string };
    try {
      const row = await getPool().query(
        `UPDATE manufacturing_machines SET department_id=$4,code=$5,name=$6,machine_type=$7,width_cm=$8,
          fixed_location=$9,manufacturer=$10,model=$11,serial_number=$12,manufacture_year=$13,power_kw=$14,
          rated_speed=$15,rated_speed_unit=$16,technical_specs=CASE WHEN $17::jsonb IS NULL THEN technical_specs ELSE technical_specs || $17::jsonb END,asset_value=$18,asset_currency_code=$19,
          ownership_type=$20,owner_name=$21,notes=$22,is_active=$23,version=version+1,updated_by_user_id=$24,updated_at=now()
         WHERE id=$1 AND company_id=$2 AND version=$3 RETURNING *`,
        [id,req.user!.companyId,d.version,d.departmentId ?? null,normalizeReferenceCode(d.code),d.name,d.machineType,
          d.widthCm ?? null,d.fixedLocation ?? null,d.manufacturer ?? null,d.model ?? null,d.serialNumber ?? null,
          d.manufactureYear ?? null,d.powerKw ?? null,d.ratedSpeed ?? null,d.ratedSpeedUnit ?? null,
          d.technicalSpecs === undefined ? null : JSON.stringify(d.technicalSpecs),d.assetValue ?? null,d.assetCurrencyCode?.toUpperCase() ?? null,
          d.ownershipType,d.ownershipType === 'CUSTODY' ? d.ownerName?.trim() : null,d.notes ?? null,d.isActive ?? true,req.user!.sub],
      );
      if (!row.rows.length) return sendError(reply, 409, 'تم تعديل الماكينة من مستخدم آخر؛ حدّث الصفحة ثم أعد المحاولة', 'VERSION_CONFLICT');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (error) { return handleDbError(reply, error); }
  });

  app.get('/machines/:id/shedding-image', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.reference.view','manufacturing.dashboard.view'])) return sendError(reply,403,'ليست لديك صلاحية عرض صورة اللقية','FORBIDDEN');
    const { id } = req.params as { id:string };
    const row=await getPool().query<{image:string|null}>(`SELECT technical_specs->>'sheddingTypeImage' AS image FROM manufacturing_machines WHERE id=$1 AND company_id=$2`,[id,req.user!.companyId]);
    if(!row.rows.length)return sendError(reply,404,'الماكينة غير موجودة','NOT_FOUND');
    return reply.send({ok:true,data:{image:row.rows[0].image}});
  });

  app.post('/machines/:id/status', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.machines.manage')) return sendError(reply, 403, 'ليست لديك صلاحية تغيير حالة الماكينة', 'FORBIDDEN');
    const parsed = z.object({ status: machineStatusSchema, reason: z.string().trim().min(1).max(1000), version: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'بيانات غير صالحة', 'VALIDATION');
    const { id } = req.params as { id: string };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ operational_status: MachineStatus; version: number }>(
        `SELECT operational_status,version FROM manufacturing_machines WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id,req.user!.companyId],
      );
      if (!current.rows.length) { await client.query('ROLLBACK'); return sendError(reply, 404, 'الماكينة غير موجودة', 'NOT_FOUND'); }
      const from = current.rows[0].operational_status;
      if (current.rows[0].version !== parsed.data.version) { await client.query('ROLLBACK'); return sendError(reply, 409, 'تم تعديل الماكينة من مستخدم آخر', 'VERSION_CONFLICT'); }
      if (!canTransitionMachineStatus(from, parsed.data.status)) { await client.query('ROLLBACK'); return sendError(reply, 409, `الانتقال من ${from} إلى ${parsed.data.status} غير مسموح`, 'INVALID_STATE'); }
      const updated = await client.query(
        `UPDATE manufacturing_machines SET operational_status=$3,version=version+1,updated_by_user_id=$4,updated_at=now()
         WHERE id=$1 AND company_id=$2 RETURNING *`,
        [id,req.user!.companyId,parsed.data.status,req.user!.sub],
      );
      await client.query(
        `INSERT INTO manufacturing_machine_status_events(company_id,machine_id,old_status,new_status,reason,created_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [req.user!.companyId,id,from,parsed.data.status,parsed.data.reason,req.user!.sub],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, data: updated.rows[0] });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return handleDbError(reply,error); }
    finally { client.release(); }
  });

  app.get('/machines/:id/history', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.reference.view', 'manufacturing.dashboard.view'])) return sendError(reply, 403, 'ليست لديك صلاحية العرض', 'FORBIDDEN');
    const { id } = req.params as { id: string };
    const [statusRows, maintenanceRows] = await Promise.all([
      getPool().query(`SELECT e.*,u.full_name AS created_by_name FROM manufacturing_machine_status_events e LEFT JOIN users u ON u.id=e.created_by_user_id WHERE e.company_id=$1 AND e.machine_id=$2 ORDER BY e.created_at DESC`, [req.user!.companyId,id]),
      getPool().query(`SELECT e.*,u.full_name AS created_by_name FROM manufacturing_machine_maintenance_events e LEFT JOIN users u ON u.id=e.created_by_user_id WHERE e.company_id=$1 AND e.machine_id=$2 ORDER BY e.occurred_at DESC`, [req.user!.companyId,id]),
    ]);
    return reply.send({ ok: true, data: { statusEvents: statusRows.rows, maintenanceEvents: maintenanceRows.rows } });
  });

  app.post('/machines/:id/maintenance', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.maintenance.manage')) return sendError(reply, 403, 'ليست لديك صلاحية إدارة الصيانة', 'FORBIDDEN');
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'بيانات غير صالحة', 'VALIDATION');
    const validation = validateMaintenanceCompletion(parsed.data);
    if (validation) return sendError(reply, 400, validation, 'VALIDATION');
    const { id } = req.params as { id: string };
    try {
      const row = await getPool().query(
        `INSERT INTO manufacturing_machine_maintenance_events(company_id,machine_id,event_type,status,occurred_at,completed_at,
          description,resolution,cost_amount,cost_currency_code,created_by_user_id,updated_by_user_id)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11
         WHERE EXISTS(SELECT 1 FROM manufacturing_machines WHERE id=$2 AND company_id=$1)
         RETURNING *`,
        [req.user!.companyId,id,parsed.data.eventType,parsed.data.status,parsed.data.occurredAt,parsed.data.completedAt ?? null,
          parsed.data.description,parsed.data.resolution ?? null,parsed.data.costAmount ?? null,
          parsed.data.costCurrencyCode?.toUpperCase() ?? null,req.user!.sub],
      );
      if (!row.rows.length) return sendError(reply, 404, 'الماكينة غير موجودة', 'NOT_FOUND');
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (error) { return handleDbError(reply,error); }
  });

  app.get('/downtime-reasons', async (req, reply) => {
    if (!requireAny(req.user, ['manufacturing.reference.view','manufacturing.dashboard.view'])) return sendError(reply,403,'ليست لديك صلاحية العرض','FORBIDDEN');
    const rows = await getPool().query(`SELECT id,code,name,stage,is_planned,is_active,created_at,updated_at FROM manufacturing_downtime_reasons WHERE company_id=$1 ORDER BY is_active DESC,stage,name`,[req.user!.companyId]);
    return reply.send({ok:true,data:rows.rows});
  });

  app.post('/downtime-reasons', async (req, reply) => {
    if (!hasPermission(req.user,'manufacturing.reference.manage')) return sendError(reply,403,'ليست لديك صلاحية إدارة أسباب التوقف','FORBIDDEN');
    const parsed=downtimeReasonSchema.safeParse(req.body); if(!parsed.success) return sendError(reply,400,parsed.error.issues[0]?.message||'بيانات غير صالحة','VALIDATION');
    const d=parsed.data;
    try { const row=await getPool().query(`INSERT INTO manufacturing_downtime_reasons(company_id,code,name,stage,is_planned,is_active,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,[req.user!.companyId,normalizeReferenceCode(d.code),d.name,d.stage,d.isPlanned,d.isActive??true,req.user!.sub]); return reply.status(201).send({ok:true,data:row.rows[0]}); } catch(error){return handleDbError(reply,error);}
  });

  app.put('/downtime-reasons/:id', async (req, reply) => {
    if (!hasPermission(req.user,'manufacturing.reference.manage')) return sendError(reply,403,'ليست لديك صلاحية إدارة أسباب التوقف','FORBIDDEN');
    const parsed=downtimeReasonSchema.safeParse(req.body); if(!parsed.success) return sendError(reply,400,parsed.error.issues[0]?.message||'بيانات غير صالحة','VALIDATION');
    const {id}=req.params as {id:string}; const d=parsed.data;
    try { const row=await getPool().query(`UPDATE manufacturing_downtime_reasons SET code=$3,name=$4,stage=$5,is_planned=$6,is_active=$7,updated_by_user_id=$8,updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *`,[id,req.user!.companyId,normalizeReferenceCode(d.code),d.name,d.stage,d.isPlanned,d.isActive??true,req.user!.sub]); if(!row.rows.length)return sendError(reply,404,'سبب التوقف غير موجود','NOT_FOUND'); return reply.send({ok:true,data:row.rows[0]}); } catch(error){return handleDbError(reply,error);}
  });

  app.get('/quality-defects', async (req, reply) => {
    if (!requireAny(req.user,['manufacturing.reference.view','manufacturing.dashboard.view'])) return sendError(reply,403,'ليست لديك صلاحية العرض','FORBIDDEN');
    const rows=await getPool().query(`SELECT id,code,name,inspection_type,default_severity,description,is_active,created_at,updated_at FROM manufacturing_quality_defect_catalog WHERE company_id=$1 ORDER BY is_active DESC,inspection_type,name`,[req.user!.companyId]);
    return reply.send({ok:true,data:rows.rows});
  });

  app.post('/quality-defects', async (req, reply) => {
    if (!hasPermission(req.user,'manufacturing.quality.catalog.manage')) return sendError(reply,403,'ليست لديك صلاحية إدارة عيوب الجودة','FORBIDDEN');
    const parsed=defectSchema.safeParse(req.body); if(!parsed.success) return sendError(reply,400,parsed.error.issues[0]?.message||'بيانات غير صالحة','VALIDATION'); const d=parsed.data;
    try { const row=await getPool().query(`INSERT INTO manufacturing_quality_defect_catalog(company_id,code,name,inspection_type,default_severity,description,is_active,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,[req.user!.companyId,normalizeReferenceCode(d.code),d.name,d.inspectionType,d.defaultSeverity??null,d.description??null,d.isActive??true,req.user!.sub]); return reply.status(201).send({ok:true,data:row.rows[0]}); } catch(error){return handleDbError(reply,error);}
  });

  app.put('/quality-defects/:id', async (req, reply) => {
    if (!hasPermission(req.user,'manufacturing.quality.catalog.manage')) return sendError(reply,403,'ليست لديك صلاحية إدارة عيوب الجودة','FORBIDDEN');
    const parsed=defectSchema.safeParse(req.body); if(!parsed.success) return sendError(reply,400,parsed.error.issues[0]?.message||'بيانات غير صالحة','VALIDATION'); const {id}=req.params as {id:string}; const d=parsed.data;
    try { const row=await getPool().query(`UPDATE manufacturing_quality_defect_catalog SET code=$3,name=$4,inspection_type=$5,default_severity=$6,description=$7,is_active=$8,updated_by_user_id=$9,updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *`,[id,req.user!.companyId,normalizeReferenceCode(d.code),d.name,d.inspectionType,d.defaultSeverity??null,d.description??null,d.isActive??true,req.user!.sub]); if(!row.rows.length)return sendError(reply,404,'تعريف العيب غير موجود','NOT_FOUND'); return reply.send({ok:true,data:row.rows[0]}); } catch(error){return handleDbError(reply,error);}
  });
};
