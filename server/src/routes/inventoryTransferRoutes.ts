import { transferBodySchema } from '../services/inventoryTransferValidation.js';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { globalErrorHandler, sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { cancelTransfer, confirmTransfer, saveTransfer, transferTransaction, TransferError } from '../services/inventoryTransferService.js';


export const inventoryTransferRoutes: FastifyPluginAsync = async (app) => {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return sendError(reply, 413, 'حجم طلب المناقلة أكبر من الحد المسموح؛ قلّل عدد الرولات في المستند', 'TRANSFER_TOO_LARGE');
    return globalErrorHandler(error, request, reply);
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

  const guards = [authenticateRequest, requirePermission('inventory.manage')];
  app.post('/', { preHandler: guards, bodyLimit: 16 * 1024 * 1024 }, write('create'));
  app.put('/:id', { preHandler: guards, bodyLimit: 16 * 1024 * 1024 }, write('update'));
  app.patch('/:id/confirm', { preHandler: guards }, write('confirm'));
  app.patch('/:id/cancel', { preHandler: guards }, write('cancel'));
};
