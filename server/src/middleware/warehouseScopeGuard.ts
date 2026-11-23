import type { FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from '../db/pool.js';
import { sendError } from './errorHandler.js';
import { warehouseAllowed, WAREHOUSE_FORBIDDEN_MSG } from '../services/warehouseAccess.js';

/** مسارات /:id على الأتواب: يُخفى الثوب (404) إن كان خارج مستودعات المستخدم المسموحة. */
export async function rollParamScopeGuard(req: FastifyRequest, reply: FastifyReply) {
  const scope = req.user?.warehouseIds;
  if (!scope) return;
  const id = (req.params as { id?: string } | undefined)?.id;
  if (!id) return;
  const r = await getPool().query<{ warehouse_id: string | null }>(
    'SELECT warehouse_id FROM fabric_rolls WHERE id=$1 AND company_id=$2',
    [id, req.user!.companyId],
  );
  if (r.rows[0] && !warehouseAllowed(scope, r.rows[0].warehouse_id)) {
    return sendError(reply, 404, 'الثوب غير موجود', 'NOT_FOUND');
  }
}

/** فاتورة بيع/شراء: جسم الطلب (مستودع الرأس + مستودعات الأسطر + مستودعات الأتواب المختارة) يجب أن يقع بالمسموح. */
export async function invoiceBodyScopeGuard(req: FastifyRequest, reply: FastifyReply) {
  const scope = req.user?.warehouseIds;
  if (!scope) return;
  const body = (req.body ?? {}) as { warehouseId?: unknown; lines?: Array<{ warehouseId?: unknown; fabricRollId?: unknown }> };
  const wh: string[] = [];
  if (typeof body.warehouseId === 'string' && body.warehouseId) wh.push(body.warehouseId);
  const rollIds: string[] = [];
  for (const ln of Array.isArray(body.lines) ? body.lines : []) {
    if (typeof ln.warehouseId === 'string' && ln.warehouseId) wh.push(ln.warehouseId);
    if (typeof ln.fabricRollId === 'string' && ln.fabricRollId) rollIds.push(ln.fabricRollId);
  }
  if (wh.some((w) => !warehouseAllowed(scope, w))) return sendError(reply, 403, WAREHOUSE_FORBIDDEN_MSG, 'FORBIDDEN');
  if (rollIds.length) {
    const r = await getPool().query<{ warehouse_id: string | null }>(
      'SELECT warehouse_id FROM fabric_rolls WHERE company_id=$1 AND id = ANY($2::uuid[])', [req.user!.companyId, rollIds]);
    if (r.rows.some((x) => !warehouseAllowed(scope, x.warehouse_id))) return sendError(reply, 403, WAREHOUSE_FORBIDDEN_MSG, 'FORBIDDEN');
  }
}

/** فاتورة موجودة (/:id): تُخفى (404) إن كان مستودعها خارج المسموح. */
export function invoiceParamScopeGuard(table: 'sales_invoices' | 'purchase_invoices') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const scope = req.user?.warehouseIds;
    if (!scope) return;
    const id = (req.params as { id?: string } | undefined)?.id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    const r = await getPool().query<{ warehouse_id: string | null }>(
      `SELECT warehouse_id FROM ${table} WHERE id=$1 AND company_id=$2`, [id, req.user!.companyId]);
    if (r.rows[0] && r.rows[0].warehouse_id && !warehouseAllowed(scope, r.rows[0].warehouse_id)) {
      return sendError(reply, 404, 'الفاتورة غير موجودة', 'NOT_FOUND');
    }
  };
}

/** يتحقق من مستودع مُرسَل بجسم الطلب (مثل مستودع الهدف أو مستودع إنشاء ثوب). */
export function bodyWarehouseGuard(...fields: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const scope = req.user?.warehouseIds;
    if (!scope) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const f of fields) {
      const v = body[f];
      if (typeof v === 'string' && v && !warehouseAllowed(scope, v)) {
        return sendError(reply, 403, WAREHOUSE_FORBIDDEN_MSG, 'FORBIDDEN');
      }
    }
  };
}
