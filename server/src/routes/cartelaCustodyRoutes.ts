import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  CustodyError,
  createDeliveryVoucher,
  custodySummary,
  extendDueDate,
  generateCopies,
  listCustody,
  listDueChanges,
  listStock,
  listStockColors,
  resolveScan,
  returnCopies,
  setStockLevel,
  type CustodyFilter,
} from '../services/cartelaCustodyService.js';

/** عهدة الكارتيلات: لا تمسّ الرصيد المالي ولا المخزون. الكتابة لمن يملك customers.manage أو inventory.manage. */
function canWrite(req: FastifyRequest): boolean {
  const u = req.user;
  return !!u && (u.role === 'admin' || u.permissions.includes('customers.manage') || u.permissions.includes('inventory.manage'));
}

function mapErr(reply: FastifyReply, e: unknown) {
  if (e instanceof CustodyError) {
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFLICT' ? 409 : 400;
    return sendError(reply, status, e.message, e.code);
  }
  const err = e as { code?: string; constraint?: string };
  // 23505 على الفهرس الفريد للعهدة المفتوحة = سباق تسليم متزامن لنفس النسخة.
  if (err?.code === '23505') return sendError(reply, 409, 'تعارض: النسخة سُلّمت أو سُجّلت للتو — أعد المحاولة', 'CONFLICT');
  throw e;
}

async function inTx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const cartelaCustodyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/scan', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const barcode = String((req.query as Record<string, string>).barcode ?? '');
    try {
      const r = await resolveScan(getPool(), companyId, userId, barcode, false);
      return reply.send({ ok: true, data: r });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.post('/vouchers', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canWrite(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    try {
      const data = await inTx((c) => createDeliveryVoucher(c, companyId, userId, req.body));
      return reply.status(201).send({ ok: true, data });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.get('/vouchers/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const v = await getPool().query(
      `SELECT v.id, v.voucher_no, v.delivery_date::text AS delivery_date, v.notes, v.customer_id, c.name AS customer_name
         FROM cartela_custody_vouchers v JOIN customers c ON c.id = v.customer_id
        WHERE v.id = $1 AND v.company_id = $2`,
      [id, companyId],
    );
    if (!v.rows.length) return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
    const lines = await listCustody(getPool(), companyId, { customerId: v.rows[0].customer_id, status: 'ALL', limit: 2000 });
    return reply.send({ ok: true, data: { voucher: v.rows[0], lines: lines.filter((l) => l.voucherId === id) } });
  });

  app.post('/returns', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canWrite(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    try {
      const data = await inTx((c) => returnCopies(c, companyId, userId, req.body));
      return reply.send({ ok: true, data });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.post('/extend', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canWrite(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    try {
      const data = await inTx((c) => extendDueDate(c, companyId, userId, req.body));
      return reply.send({ ok: true, data });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.get('/rows', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const filter: CustodyFilter = {
      customerId: q.customerId || undefined,
      search: q.search || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      status: (['HELD', 'LATE', 'RETURNED', 'OPEN', 'ALL'].includes(q.status) ? q.status : 'ALL') as CustodyFilter['status'],
    };
    return reply.send({ ok: true, data: await listCustody(getPool(), companyId, filter) });
  });

  app.get('/customers/:customerId/statement', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { customerId } = req.params as { customerId: string };
    const q = req.query as Record<string, string>;
    const db = getPool();
    const cust = await db.query(`SELECT id, name FROM customers WHERE id = $1 AND company_id = $2`, [customerId, companyId]);
    if (!cust.rows.length) return sendError(reply, 404, 'العميل غير موجود', 'NOT_FOUND');
    const rows = await listCustody(db, companyId, {
      customerId,
      from: q.from || undefined,
      to: q.to || undefined,
      status: (['HELD', 'LATE', 'RETURNED', 'OPEN', 'ALL'].includes(q.status) ? q.status : 'ALL') as CustodyFilter['status'],
    });
    const summary = await custodySummary(db, companyId, customerId);
    return reply.send({ ok: true, data: { customer: cust.rows[0], summary, rows } });
  });

  app.get('/lines/:id/changes', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    return reply.send({ ok: true, data: await listDueChanges(getPool(), companyId, id) });
  });

  app.post('/copies/generate', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canWrite(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    try {
      const data = await inTx((c) => generateCopies(c, companyId, userId, req.body));
      return reply.status(201).send({ ok: true, data });
    } catch (e) {
      return mapErr(reply, e);
    }
  });
  // مخزون الكارتيلات بالعدد (ملاحظة بشير): عرض الأعداد وتعديلها يدوياً.
  app.get('/stock', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const search = String((req.query as Record<string, string>).search ?? '');
    return reply.send({ ok: true, data: await listStock(getPool(), companyId, search) });
  });

  app.get('/stock/:cartelaId/colors', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { cartelaId } = req.params as { cartelaId: string };
    if (!/^[0-9a-f-]{36}$/i.test(cartelaId)) return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
    return reply.send({ ok: true, data: await listStockColors(getPool(), companyId, cartelaId) });
  });

  app.put('/stock', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canWrite(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    try {
      const data = await inTx((c) => setStockLevel(c, companyId, userId, req.body));
      return reply.send({ ok: true, data });
    } catch (e) {
      return mapErr(reply, e);
    }
  });
};
