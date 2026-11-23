import { transferBodySchema } from '../services/inventoryTransferValidation.js';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { globalErrorHandler, sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { requireInventoryTransferAccess } from '../services/inventoryTransferAccess.js';
import { warehouseAllowed, WAREHOUSE_FORBIDDEN_MSG } from '../services/warehouseAccess.js';
import { cancelTransfer, confirmTransfer, saveTransfer, transferTransaction, TransferError } from '../services/inventoryTransferService.js';


export const inventoryTransferRoutes: FastifyPluginAsync = async (app) => {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return sendError(reply, 413, 'حجم طلب المناقلة أكبر من الحد المسموح؛ قلّل عدد الرولات في المستند', 'TRANSFER_TOO_LARGE');
    return globalErrorHandler(error, request, reply);
  });
  app.get('/eligible-rolls', { preHandler: authenticateRequest }, async (req, reply) => {
    const parsed = z.object({
      warehouseId: z.string().uuid(), locationId: z.string().uuid().optional(),
      search: z.string().max(200).optional(), barcode: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100),
    }).safeParse(req.query);
    if (!parsed.success) return sendError(reply, 400, 'بيانات البحث عن رولات المناقلة غير صالحة', 'VALIDATION');
    const q = parsed.data;
    if (!warehouseAllowed(req.user!.warehouseIds, q.warehouseId)) return sendError(reply, 403, WAREHOUSE_FORBIDDEN_MSG, 'FORBIDDEN');
    const params: unknown[] = [req.user!.companyId, q.warehouseId];
    const conds = ["fr.company_id=$1", "fr.warehouse_id=$2", "fr.status='AVAILABLE'", 'fr.length_m>0', 'wh.is_active=true'];
    if (q.locationId) { params.push(q.locationId); conds.push(`fr.location_id=$${params.length}`); }
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`); const p = params.length; conds.push(`(fr.barcode ILIKE $${p} OR fi.name ILIKE $${p} OR fi.internal_code ILIKE $${p} OR fc.name_ar ILIKE $${p} OR fc.name_tr ILIKE $${p} OR fc.color_code ILIKE $${p})`); }
    if (q.barcode?.trim()) { params.push(q.barcode.trim()); const p = params.length; conds.push(`(lower(fr.barcode)=lower($${p}) OR lower(fr.roll_no)=lower($${p}))`); }
    const from = `FROM fabric_rolls fr JOIN fabric_items fi ON fi.id=fr.item_id AND fi.company_id=fr.company_id
      JOIN warehouses wh ON wh.id=fr.warehouse_id AND wh.company_id=fr.company_id
      LEFT JOIN fabric_colors fc ON fc.id=fr.color_id AND fc.company_id=fr.company_id
      LEFT JOIN warehouse_locations wl ON wl.id=fr.location_id AND wl.company_id=fr.company_id
      WHERE ${conds.join(' AND ')}`;
    const pool = getPool();
    const [rows, count] = await Promise.all([
      pool.query(`SELECT fr.*, fi.name AS item_name,fi.internal_code,fc.name_ar AS color_name_ar,fc.name_tr AS color_name_tr,
        fc.color_code,wh.name AS warehouse_name,wl.name AS location_name ${from} ORDER BY fr.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize]),
      pool.query(`SELECT count(*)::int AS total ${from}`, params),
    ]);
    return reply.send({ ok: true, data: rows.rows, total: count.rows[0].total, page: q.page, pageSize: q.pageSize });
  });
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    for (const field of ['fromWarehouseId', 'toWarehouseId']) {
      if (q[field] && !z.string().uuid().safeParse(q[field]).success) return sendError(reply, 400, 'معرّف المستودع غير صالح', 'VALIDATION');
    }
    for (const field of ['dateFrom', 'dateTo']) {
      if (q[field] && !z.string().date().safeParse(q[field]).success) return sendError(reply, 400, 'تاريخ البحث غير صالح', 'VALIDATION');
    }
    const search = q.search?.trim() || '';
    const status = q.status?.trim();
    const fromWarehouseId = q.fromWarehouseId?.trim();
    const toWarehouseId = q.toWarehouseId?.trim();
    const dateFrom = q.dateFrom?.trim();
    const dateTo = q.dateTo?.trim();
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['t.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;
    // N-0034: يرى المقيَّد المناقلات التي يكون أحد طرفيها مستودعاً مسموحاً له.
    if (req.user!.warehouseIds) {
      conditions.push(`(t.from_warehouse_id = ANY($${p}::uuid[]) OR t.to_warehouse_id = ANY($${p}::uuid[]))`);
      params.push(req.user!.warehouseIds);
      p++;
    }

    if (search) {
      conditions.push(`(t.transfer_no ILIKE $${p} OR t.notes ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) {
      conditions.push(`t.status = $${p}`);
      params.push(status);
      p++;
    }
    if (fromWarehouseId) {
      conditions.push(`t.from_warehouse_id = $${p}`);
      params.push(fromWarehouseId);
      p++;
    }
    if (toWarehouseId) {
      conditions.push(`t.to_warehouse_id = $${p}`);
      params.push(toWarehouseId);
      p++;
    }
    if (dateFrom) {
      conditions.push(`t.transfer_date >= $${p}::date`);
      params.push(dateFrom);
      p++;
    }
    if (dateTo) {
      conditions.push(`t.transfer_date <= $${p}::date`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT t.*,
                fw.name AS from_warehouse_name,
                tw.name AS to_warehouse_name,
                (SELECT COUNT(*)::int FROM inventory_transfer_lines l WHERE l.transfer_id = t.id AND l.company_id = t.company_id) AS line_count
         FROM inventory_transfers t
         JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
         JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
         WHERE ${where}
         ORDER BY t.transfer_date DESC, t.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM inventory_transfers t WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'معرّف المناقلة غير صالح', 'VALIDATION');
    const pool = getPool();

    const head = await pool.query(
      `SELECT t.*,
              fw.name AS from_warehouse_name,
              tw.name AS to_warehouse_name
       FROM inventory_transfers t
       JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.company_id = t.company_id
       JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.company_id = t.company_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [id, companyId],
    );
    if (!head.rows.length) return sendError(reply, 404, 'المناقلة غير موجودة', 'NOT_FOUND');

    const lines = await pool.query(
      `SELECT l.id, l.company_id, l.transfer_id, l.fabric_roll_id, l.barcode AS line_barcode, l.quantity, l.notes,
              fr.roll_no, fr.barcode AS roll_barcode, fr.length_m, fr.status AS roll_status,
              fi.name AS item_name,
              to_jsonb(fr) || jsonb_build_object(
                'item_name', fi.name, 'internal_code', fi.internal_code,
                'color_name_ar', fc.name_ar, 'color_name_tr', fc.name_tr, 'color_code', fc.color_code,
                'warehouse_name', wh.name, 'location_name', wl.name
              ) AS roll
       FROM inventory_transfer_lines l
       JOIN fabric_rolls fr ON fr.id = l.fabric_roll_id AND fr.company_id = l.company_id
       JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
       LEFT JOIN fabric_colors fc ON fc.id = fr.color_id AND fc.company_id = fr.company_id
       JOIN warehouses wh ON wh.id = fr.warehouse_id AND wh.company_id = fr.company_id
       LEFT JOIN warehouse_locations wl ON wl.id = fr.location_id AND wl.company_id = fr.company_id
       WHERE l.transfer_id = $1 AND l.company_id = $2
       ORDER BY l.id ASC`,
      [id, companyId],
    );

    return reply.send({ ok: true, data: { ...head.rows[0], lines: lines.rows } });
  });

  const write = (action: 'create' | 'update' | 'confirm' | 'cancel') =>
    async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      const { companyId, sub: userId } = req.user!;
      const id = (req.params as { id?: string } | undefined)?.id;
      if (action !== 'create' && !z.string().uuid().safeParse(id).success) {
        return sendError(reply, 400, 'معرّف المناقلة غير صالح', 'VALIDATION');
      }
      // N-0034: لا حركة على مستودع خارج المسموح (الطرفان معاً).
      const scope = req.user!.warehouseIds;
      if (scope) {
        if (action === 'confirm' || action === 'cancel') {
          const t = await getPool().query<{ from_warehouse_id: string; to_warehouse_id: string }>(
            'SELECT from_warehouse_id, to_warehouse_id FROM inventory_transfers WHERE id=$1 AND company_id=$2', [id, companyId]);
          const row = t.rows[0];
          if (row && (!warehouseAllowed(scope, row.from_warehouse_id) || !warehouseAllowed(scope, row.to_warehouse_id))) {
            return sendError(reply, 403, WAREHOUSE_FORBIDDEN_MSG, 'FORBIDDEN');
          }
        } else {
          const b = (req.body ?? {}) as { fromWarehouseId?: string; toWarehouseId?: string };
          if (!warehouseAllowed(scope, b.fromWarehouseId) || !warehouseAllowed(scope, b.toWarehouseId)) {
            return sendError(reply, 403, WAREHOUSE_FORBIDDEN_MSG, 'FORBIDDEN');
          }
        }
      }
      const parsed = action === 'create' || action === 'update' ? transferBodySchema.safeParse(req.body) : null;
      if (parsed && !parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message ?? ArabicErrors.validation, 'VALIDATION');
      const input = parsed?.success ? parsed.data : undefined;
      const confirmation = action === 'confirm' ? z.object({ expectedUpdatedAt: z.string().datetime().optional() }).safeParse(req.body ?? {}) : null;
      if (confirmation && !confirmation.success) return sendError(reply, 400, 'بيانات مراجعة المناقلة غير صالحة', 'VALIDATION');
      const expectedUpdatedAt = confirmation?.success ? confirmation.data.expectedUpdatedAt : undefined;
      try {
        const data = await transferTransaction(getPool(), async (client) => {
          if (action === 'create' || action === 'update') return saveTransfer(client, companyId, userId, input!, id);
          if (action === 'confirm') return confirmTransfer(client, companyId, userId, id!, expectedUpdatedAt);
          return cancelTransfer(client, companyId, id!);
        });
        return reply.status(action === 'create' ? 201 : 200).send({ ok: true, data });
      } catch (error) {
        if (error instanceof TransferError) return sendError(reply, error.statusCode, error.message, error.code);
        const e = error as { code?: string };
        // Whitelist metadata only; never log bodies, connection strings, SQL values, or tokens.
        req.log.error({ requestId: req.id, action, code: e.code ?? 'UNKNOWN' }, 'inventory transfer failed');
        if (e.code === '23505') return sendError(reply, 409, 'تعارض أو تكرار في المناقلة؛ حدّث السجل قبل المحاولة', 'DUPLICATE');
        if (e.code === '40P01' || e.code === '40001' || e.code === '55P03') return sendError(reply, 409, 'تغيّر المخزون أثناء العملية؛ حدّث البيانات وأعد المحاولة', 'CONCURRENT_TRANSFER');
        if (e.code === '23503') return sendError(reply, 409, 'إحدى بيانات المستودع أو الرولات تغيرت؛ حدّث الاختيار', 'REFERENCE_CHANGED');
        if (e.code === '42703') return sendError(reply, 503, 'إعداد قاعدة البيانات غير مكتمل؛ يلزم تحديث مخطط المناقلات', 'SCHEMA_NOT_READY');
        return sendError(reply, 500, `تعذّر إتمام المناقلة. راجع المسؤول برقم المتابعة ${req.id}`, 'TRANSFER_FAILED');
      }
    };

  const guards = [authenticateRequest, requireInventoryTransferAccess];
  app.post('/', { preHandler: guards, bodyLimit: 16 * 1024 * 1024 }, write('create'));
  app.put('/:id', { preHandler: guards, bodyLimit: 16 * 1024 * 1024 }, write('update'));
  app.patch('/:id/confirm', { preHandler: guards }, write('confirm'));
  app.patch('/:id/cancel', { preHandler: guards }, write('cancel'));
};
