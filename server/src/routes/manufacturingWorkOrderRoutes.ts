import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, type JwtPayload } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  canTransitionManufacturingWorkOrder,
  validateWorkOrderAllocations,
  type ManufacturingWorkOrderStatus,
} from '../services/manufacturingReferenceRules.js';
import { generateManufacturingWorkOrderNo } from '../services/manufacturingWorkOrderService.js';

const allocationSchema = z.object({
  customerOrderId: z.string().uuid(),
  customerOrderLineId: z.string().uuid(),
  allocatedLengthM: z.number().positive(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const workOrderInputSchema = z.object({
  specificationVersionId: z.string().uuid(),
  targetLengthM: z.number().positive(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  plannedStartDate: z.string().date().nullable().optional(),
  plannedEndDate: z.string().date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  allocations: z.array(allocationSchema).max(100).default([]),
  version: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.plannedStartDate && value.plannedEndDate && value.plannedEndDate < value.plannedStartDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['plannedEndDate'], message: 'تاريخ النهاية لا يمكن أن يسبق تاريخ البداية' });
  }
});

function hasPermission(user: JwtPayload | undefined, code: string): boolean {
  return Boolean(user && (user.role === 'admin' || user.permissions.includes(code)));
}

function requireView(user: JwtPayload | undefined): boolean {
  return hasPermission(user, 'manufacturing.work_orders.view') || hasPermission(user, 'manufacturing.dashboard.view');
}

function handleDbError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === '23505') return sendError(reply, 409, 'رقم أمر الإنتاج أو التخصيص مستخدم مسبقاً', 'DUPLICATE');
  if (code === '23503') return sendError(reply, 409, 'أحد المراجع لا يتبع الشركة أو لم يعد موجوداً', 'CONFLICT');
  if (code === '23514') return sendError(reply, 400, 'بيانات أمر الإنتاج لا تحقق قواعد الاعتماد', 'VALIDATION');
  throw error;
}

async function validateAllocationReferences(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string; order_id: string; status: string }> }> },
  companyId: string,
  allocations: z.infer<typeof allocationSchema>[],
): Promise<string | null> {
  if (!allocations.length) return null;
  const ids = allocations.map((item) => item.customerOrderLineId);
  const rows = await client.query(
    `SELECT l.id,l.order_id,o.status
     FROM customer_order_lines l
     JOIN customer_orders o ON o.id=l.order_id AND o.company_id=l.company_id
     WHERE l.company_id=$1 AND l.id=ANY($2::uuid[])`,
    [companyId, ids],
  );
  if (rows.rows.length !== ids.length) return 'أحد أسطر أوردرات العملاء غير موجود أو لا يتبع الشركة';
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  for (const allocation of allocations) {
    const row = byId.get(allocation.customerOrderLineId);
    if (!row || row.order_id !== allocation.customerOrderId) return 'سطر أوردر العميل لا يتبع الأوردر المحدد';
    if (row.status === 'cancelled' || row.status === 'completed') return 'لا يمكن تخصيص أمر إنتاج لأوردر عميل ملغى أو مكتمل';
  }
  return null;
}

export const manufacturingWorkOrderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticateRequest);

  app.get('/', async (req, reply) => {
    if (!requireView(req.user)) return sendError(reply, 403, 'ليست لديك صلاحية عرض أوامر الإنتاج', 'FORBIDDEN');
    const query = req.query as { search?: string; status?: string };
    const params: unknown[] = [req.user!.companyId];
    const conditions = ['w.company_id=$1'];
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      conditions.push(`(w.work_order_no ILIKE $${params.length} OR s.code ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }
    if (query.status && ['DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED'].includes(query.status)) {
      params.push(query.status);
      conditions.push(`w.status=$${params.length}`);
    }
    const rows = await getPool().query(
      `SELECT w.id,w.work_order_no,w.status,w.priority,w.target_length_m,w.planned_start_date,w.planned_end_date,
              w.notes,w.version,w.released_at,w.completed_at,w.cancelled_at,w.created_at,w.updated_at,
              s.id AS specification_id,s.code AS specification_code,s.name AS specification_name,
              sv.id AS specification_version_id,sv.version_no AS specification_version_no,
              COALESCE(SUM(a.allocated_length_m) FILTER (WHERE a.is_active),0) AS allocated_length_m,
              COUNT(a.id) FILTER (WHERE a.is_active)::int AS allocation_count
       FROM manufacturing_work_orders w
       JOIN manufacturing_specifications s ON s.id=w.specification_id AND s.company_id=w.company_id
       JOIN manufacturing_specification_versions sv ON sv.id=w.specification_version_id AND sv.specification_id=w.specification_id AND sv.company_id=w.company_id
       LEFT JOIN manufacturing_work_order_allocations a ON a.work_order_id=w.id AND a.company_id=w.company_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY w.id,s.id,sv.id
       ORDER BY w.created_at DESC`,
      params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.get('/:id', async (req, reply) => {
    if (!requireView(req.user)) return sendError(reply, 403, 'ليست لديك صلاحية عرض أمر الإنتاج', 'FORBIDDEN');
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'معرف أمر الإنتاج غير صالح', 'VALIDATION');
    const [order, allocations, events] = await Promise.all([
      getPool().query(
        `SELECT w.*,s.code AS specification_code,s.name AS specification_name,sv.version_no AS specification_version_no,sv.status AS specification_version_status
         FROM manufacturing_work_orders w
         JOIN manufacturing_specifications s ON s.id=w.specification_id AND s.company_id=w.company_id
         JOIN manufacturing_specification_versions sv ON sv.id=w.specification_version_id AND sv.specification_id=w.specification_id AND sv.company_id=w.company_id
         WHERE w.id=$1 AND w.company_id=$2`, [id,req.user!.companyId],
      ),
      getPool().query(
        `SELECT a.id,a.customer_order_id,a.customer_order_line_id,a.allocated_length_m,a.notes,
                o.order_no,l.line_no,l.material_name,l.color_name,l.dsam_number
         FROM manufacturing_work_order_allocations a
         JOIN customer_orders o ON o.id=a.customer_order_id AND o.company_id=a.company_id
         JOIN customer_order_lines l ON l.id=a.customer_order_line_id AND l.order_id=a.customer_order_id AND l.company_id=a.company_id
         WHERE a.work_order_id=$1 AND a.company_id=$2 AND a.is_active ORDER BY o.order_no,l.line_no`, [id,req.user!.companyId],
      ),
      getPool().query(
        `SELECT e.*,u.full_name AS created_by_name FROM manufacturing_work_order_events e
         LEFT JOIN users u ON u.id=e.created_by_user_id
         WHERE e.work_order_id=$1 AND e.company_id=$2 ORDER BY e.created_at DESC`, [id,req.user!.companyId],
      ),
    ]);
    if (!order.rows.length) return sendError(reply, 404, 'أمر الإنتاج غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: { order: order.rows[0], allocations: allocations.rows, events: events.rows } });
  });

  app.post('/', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.work_orders.manage')) return sendError(reply, 403, 'ليست لديك صلاحية إنشاء أمر إنتاج', 'FORBIDDEN');
    const parsed = workOrderInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || 'بيانات أمر الإنتاج غير صالحة', 'VALIDATION');
    const allocationError = validateWorkOrderAllocations({ targetLengthM: parsed.data.targetLengthM, allocations: parsed.data.allocations });
    if (allocationError) return sendError(reply, 400, allocationError, 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const specification = await client.query<{ specification_id: string }>(
        `SELECT v.specification_id FROM manufacturing_specification_versions v
         JOIN manufacturing_specifications s ON s.id=v.specification_id AND s.company_id=v.company_id
         WHERE v.id=$1 AND v.company_id=$2 AND s.is_active`,
        [parsed.data.specificationVersionId, req.user!.companyId],
      );
      if (!specification.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'إصدار المواصفة غير موجود أو البطاقة غير فعالة', 'NOT_FOUND');
      }
      const referenceError = await validateAllocationReferences(client, req.user!.companyId, parsed.data.allocations);
      if (referenceError) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, referenceError, 'VALIDATION');
      }
      const workOrderNo = await generateManufacturingWorkOrderNo(client, req.user!.companyId);
      const order = await client.query<{ id: string }>(
        `INSERT INTO manufacturing_work_orders(
           company_id,work_order_no,specification_id,specification_version_id,priority,target_length_m,
           planned_start_date,planned_end_date,notes,created_by_user_id,updated_by_user_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
        [req.user!.companyId,workOrderNo,specification.rows[0].specification_id,parsed.data.specificationVersionId,
          parsed.data.priority,parsed.data.targetLengthM,parsed.data.plannedStartDate ?? null,parsed.data.plannedEndDate ?? null,
          parsed.data.notes ?? null,req.user!.sub],
      );
      for (const allocation of parsed.data.allocations) {
        await client.query(
          `INSERT INTO manufacturing_work_order_allocations(
             company_id,work_order_id,customer_order_id,customer_order_line_id,allocated_length_m,notes,created_by_user_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [req.user!.companyId,order.rows[0].id,allocation.customerOrderId,allocation.customerOrderLineId,
            allocation.allocatedLengthM,allocation.notes ?? null,req.user!.sub],
        );
      }
      await client.query(
        `INSERT INTO manufacturing_work_order_events(company_id,work_order_id,event_type,new_status,details,created_by_user_id)
         VALUES($1,$2,'CREATED','DRAFT',$3::jsonb,$4)`,
        [req.user!.companyId,order.rows[0].id,JSON.stringify({ workOrderNo }),req.user!.sub],
      );
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: { id: order.rows[0].id, workOrderNo, status: 'DRAFT' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return handleDbError(reply,error);
    } finally { client.release(); }
  });

  app.put('/:id', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.work_orders.manage')) return sendError(reply, 403, 'ليست لديك صلاحية تعديل أمر الإنتاج', 'FORBIDDEN');
    const { id } = req.params as { id: string };
    const parsed = workOrderInputSchema.safeParse(req.body);
    if (!z.string().uuid().safeParse(id).success || !parsed.success || !parsed.data.version) {
      return sendError(reply, 400, 'بيانات أمر الإنتاج ورقم النسخة مطلوبة', 'VALIDATION');
    }
    const allocationError = validateWorkOrderAllocations({ targetLengthM: parsed.data.targetLengthM, allocations: parsed.data.allocations });
    if (allocationError) return sendError(reply, 400, allocationError, 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: ManufacturingWorkOrderStatus; version: number }>(
        `SELECT status,version FROM manufacturing_work_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id,req.user!.companyId],
      );
      if (!current.rows.length) { await client.query('ROLLBACK'); return sendError(reply,404,'أمر الإنتاج غير موجود','NOT_FOUND'); }
      if (current.rows[0].status !== 'DRAFT') { await client.query('ROLLBACK'); return sendError(reply,409,'لا يمكن تعديل أمر الإنتاج بعد إصداره','INVALID_STATE'); }
      if (current.rows[0].version !== parsed.data.version) { await client.query('ROLLBACK'); return sendError(reply,409,'تم تعديل أمر الإنتاج من مستخدم آخر','VERSION_CONFLICT'); }
      const specification = await client.query<{ specification_id: string }>(
        `SELECT v.specification_id FROM manufacturing_specification_versions v JOIN manufacturing_specifications s ON s.id=v.specification_id AND s.company_id=v.company_id
         WHERE v.id=$1 AND v.company_id=$2 AND s.is_active`, [parsed.data.specificationVersionId,req.user!.companyId],
      );
      if (!specification.rows.length) { await client.query('ROLLBACK'); return sendError(reply,404,'إصدار المواصفة غير موجود','NOT_FOUND'); }
      const referenceError = await validateAllocationReferences(client, req.user!.companyId, parsed.data.allocations);
      if (referenceError) { await client.query('ROLLBACK'); return sendError(reply,400,referenceError,'VALIDATION'); }
      await client.query(
        `UPDATE manufacturing_work_orders SET specification_id=$3,specification_version_id=$4,priority=$5,target_length_m=$6,
           planned_start_date=$7,planned_end_date=$8,notes=$9,version=version+1,updated_by_user_id=$10,updated_at=now()
         WHERE id=$1 AND company_id=$2`,
        [id,req.user!.companyId,specification.rows[0].specification_id,parsed.data.specificationVersionId,parsed.data.priority,
          parsed.data.targetLengthM,parsed.data.plannedStartDate ?? null,parsed.data.plannedEndDate ?? null,parsed.data.notes ?? null,req.user!.sub],
      );
      await client.query(
        `UPDATE manufacturing_work_order_allocations SET is_active=false
         WHERE work_order_id=$1 AND company_id=$2 AND is_active`, [id,req.user!.companyId],
      );
      for (const allocation of parsed.data.allocations) {
        await client.query(
          `INSERT INTO manufacturing_work_order_allocations(company_id,work_order_id,customer_order_id,customer_order_line_id,allocated_length_m,notes,created_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [req.user!.companyId,id,allocation.customerOrderId,allocation.customerOrderLineId,allocation.allocatedLengthM,allocation.notes ?? null,req.user!.sub],
        );
      }
      await client.query(
        `INSERT INTO manufacturing_work_order_events(company_id,work_order_id,event_type,old_status,new_status,details,created_by_user_id)
         VALUES($1,$2,'UPDATED','DRAFT','DRAFT',$3::jsonb,$4)`, [req.user!.companyId,id,JSON.stringify({ version: parsed.data.version + 1 }),req.user!.sub],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: 'DRAFT', version: parsed.data.version + 1 } });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return handleDbError(reply,error); }
    finally { client.release(); }
  });

  app.post('/:id/release', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.work_orders.release')) return sendError(reply, 403, 'ليست لديك صلاحية إصدار أمر الإنتاج', 'FORBIDDEN');
    const { id } = req.params as { id: string };
    const parsed = z.object({ version: z.number().int().positive() }).safeParse(req.body);
    if (!z.string().uuid().safeParse(id).success || !parsed.success) return sendError(reply,400,'معرف الأمر ورقم النسخة مطلوبان','VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: ManufacturingWorkOrderStatus; version: number; specification_id: string; specification_version_id: string }>(
        `SELECT status,version,specification_id,specification_version_id FROM manufacturing_work_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id,req.user!.companyId],
      );
      if (!current.rows.length) { await client.query('ROLLBACK'); return sendError(reply,404,'أمر الإنتاج غير موجود','NOT_FOUND'); }
      if (current.rows[0].status !== 'DRAFT') { await client.query('ROLLBACK'); return sendError(reply,409,'يمكن إصدار أمر إنتاج مسودة فقط','INVALID_STATE'); }
      if (current.rows[0].version !== parsed.data.version) { await client.query('ROLLBACK'); return sendError(reply,409,'تم تعديل أمر الإنتاج من مستخدم آخر','VERSION_CONFLICT'); }
      const invalidAllocations = await client.query<{ invalid_count: number }>(
        `SELECT COUNT(*)::int AS invalid_count
         FROM manufacturing_work_order_allocations a
         JOIN customer_orders o ON o.id=a.customer_order_id AND o.company_id=a.company_id
         WHERE a.work_order_id=$1 AND a.company_id=$2 AND a.is_active AND o.status IN ('cancelled','completed')`,
        [id,req.user!.companyId],
      );
      if (invalidAllocations.rows[0]?.invalid_count > 0) {
        await client.query('ROLLBACK');
        return sendError(reply,409,'أحد أوردرات العملاء المخصصة أصبح ملغى أو مكتملًا؛ عدّل التخصيص قبل الإصدار','CUSTOMER_ORDER_CONFLICT');
      }
      const spec = await client.query<{ version_no: number; status: string; approved_at: string; parsed_data: unknown; code: string; name: string }>(
        `SELECT v.version_no,v.status,v.approved_at,v.parsed_data,s.code,s.name
         FROM manufacturing_specification_versions v JOIN manufacturing_specifications s ON s.id=v.specification_id AND s.company_id=v.company_id
         WHERE v.id=$1 AND v.specification_id=$2 AND v.company_id=$3 FOR UPDATE`,
        [current.rows[0].specification_version_id,current.rows[0].specification_id,req.user!.companyId],
      );
      if (!spec.rows.length || spec.rows[0].status !== 'APPROVED') { await client.query('ROLLBACK'); return sendError(reply,409,'يجب اعتماد إصدار المواصفة قبل إصدار أمر الإنتاج','SPECIFICATION_NOT_APPROVED'); }
      const snapshot = { specificationId: current.rows[0].specification_id, specificationVersionId: current.rows[0].specification_version_id, ...spec.rows[0] };
      await client.query(
        `UPDATE manufacturing_work_orders SET status='RELEASED',specification_snapshot=$3::jsonb,released_by_user_id=$4,
           released_at=now(),version=version+1,updated_by_user_id=$4,updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id,req.user!.companyId,JSON.stringify(snapshot),req.user!.sub],
      );
      await client.query(
        `INSERT INTO manufacturing_work_order_events(company_id,work_order_id,event_type,old_status,new_status,details,created_by_user_id)
         VALUES($1,$2,'RELEASED','DRAFT','RELEASED',$3::jsonb,$4)`,
        [req.user!.companyId,id,JSON.stringify({ specificationVersionId: current.rows[0].specification_version_id }),req.user!.sub],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: 'RELEASED', version: parsed.data.version + 1 } });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return handleDbError(reply,error); }
    finally { client.release(); }
  });

  app.post('/:id/transition', async (req, reply) => {
    if (!hasPermission(req.user, 'manufacturing.work_orders.manage')) return sendError(reply,403,'ليست لديك صلاحية تحديث أمر الإنتاج','FORBIDDEN');
    const { id } = req.params as { id: string };
    const parsed = z.object({ targetStatus: z.enum(['IN_PROGRESS','CANCELLED']), version: z.number().int().positive(), reason: z.string().trim().max(2000).nullable().optional() }).safeParse(req.body);
    if (!z.string().uuid().safeParse(id).success || !parsed.success) return sendError(reply,400,'بيانات الانتقال غير صالحة','VALIDATION');
    if (parsed.data.targetStatus === 'CANCELLED' && !parsed.data.reason) return sendError(reply,400,'سبب الإلغاء مطلوب','VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: ManufacturingWorkOrderStatus; version: number }>(
        `SELECT status,version FROM manufacturing_work_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id,req.user!.companyId],
      );
      if (!current.rows.length) { await client.query('ROLLBACK'); return sendError(reply,404,'أمر الإنتاج غير موجود','NOT_FOUND'); }
      if (current.rows[0].version !== parsed.data.version) { await client.query('ROLLBACK'); return sendError(reply,409,'تم تعديل أمر الإنتاج من مستخدم آخر','VERSION_CONFLICT'); }
      if (parsed.data.targetStatus === 'CANCELLED' && current.rows[0].status !== 'DRAFT' && !hasPermission(req.user, 'manufacturing.work_orders.release')) {
        await client.query('ROLLBACK');
        return sendError(reply,403,'إلغاء أمر صادر أو قيد التشغيل يتطلب صلاحية إصدار أوامر الإنتاج','FORBIDDEN');
      }
      if (!canTransitionManufacturingWorkOrder(current.rows[0].status, parsed.data.targetStatus)) { await client.query('ROLLBACK'); return sendError(reply,409,'انتقال حالة أمر الإنتاج غير مسموح','INVALID_STATE'); }
      const eventType = parsed.data.targetStatus === 'IN_PROGRESS' ? 'STARTED' : 'CANCELLED';
      await client.query(
        `UPDATE manufacturing_work_orders SET status=$3,version=version+1,updated_by_user_id=$4,updated_at=now(),
           cancelled_by_user_id=CASE WHEN $3='CANCELLED' THEN $4 ELSE cancelled_by_user_id END,
           cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE cancelled_at END,
           cancellation_reason=CASE WHEN $3='CANCELLED' THEN $5 ELSE cancellation_reason END
         WHERE id=$1 AND company_id=$2`, [id,req.user!.companyId,parsed.data.targetStatus,req.user!.sub,parsed.data.reason ?? null],
      );
      await client.query(
        `INSERT INTO manufacturing_work_order_events(company_id,work_order_id,event_type,old_status,new_status,details,created_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [req.user!.companyId,id,eventType,current.rows[0].status,parsed.data.targetStatus,JSON.stringify({ reason: parsed.data.reason ?? null }),req.user!.sub],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: parsed.data.targetStatus, version: parsed.data.version + 1 } });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return handleDbError(reply,error); }
    finally { client.release(); }
  });
};
