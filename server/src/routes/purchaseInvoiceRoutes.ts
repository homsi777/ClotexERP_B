import type { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest, canPrice } from '../middleware/auth.js';
import { listPricingQueue, maskMoneyRow, unpricedInvoiceBody } from '../services/pricingQueueService.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  confirmPurchaseInvoice,
  createPurchaseInvoice,
  deletePurchaseInvoiceDraft,
  purgeVoidedPurchaseInvoice,
  getPurchaseInvoiceById,
  listPurchaseInvoices,
  updatePurchaseInvoiceDraft,
  updatePurchaseInvoiceConfirmed,
  getPurchaseInvoiceEditEligibility,
  voidPurchaseInvoice,
  repairStalePurchaseInvoiceRolls,
} from '../services/purchaseInvoiceService.js';

export const purchaseInvoiceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const pool = getPool();
    const result = await listPurchaseInvoices(pool, companyId, {
      search: q.search,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      supplierId: q.supplierId,
      documentStatus: q.documentStatus,
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
    const rows = canPrice(req.user, 'purchases.invoices') ? result.rows : (result.rows as Record<string, unknown>[]).map((r) => maskMoneyRow(r, 'header'));
    return reply.send({ ok: true, ...result, rows });
  });

  // مسودات شراء بحاجة إلى تسعير (إشعارات المحاسب/المدير).
  app.get('/pricing-queue', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!canPrice(req.user, 'purchases.invoices')) return reply.send({ ok: true, data: { total: 0, items: [] } });
    return reply.send({ ok: true, data: await listPricingQueue(getPool(), companyId) });
  });

  app.post('/repair-stale-rolls', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const body = (req.body as Record<string, unknown>) || {};
    const invoiceNos = Array.isArray(body.invoiceNos)
      ? body.invoiceNos.filter((v): v is string => typeof v === 'string')
      : undefined;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await repairStalePurchaseInvoiceRolls(client, companyId, userId, { invoiceNos });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: result });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const data = await getPurchaseInvoiceById(pool, companyId, id);
    if (!data) return sendError(reply, 404, 'فاتورة الشراء غير موجودة', 'NOT_FOUND');
    if (!canPrice(req.user, 'purchases.invoices')) return reply.send({ ok: true, data: { header: maskMoneyRow(data.header, 'header'), lines: data.lines.map((l) => maskMoneyRow(l, 'line')) } });
    return reply.send({ ok: true, data });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // موظف بلا صلاحية تسعير: تُحفظ مسودة بلا أسعار يسعّرها المحاسب/المدير لاحقاً.
      const body = canPrice(req.user, 'purchases.invoices') ? req.body : unpricedInvoiceBody({ ...(req.body as Record<string, unknown>), confirm: false });
      const result = await createPurchaseInvoice(client, companyId, userId, body);
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'DUPLICATE') return sendError(reply, 409, err.message || 'تعارض', 'DUPLICATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || 'مخزون', 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/:id/edit-eligibility', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      const data = await getPurchaseInvoiceEditEligibility(client, companyId, id);
      return reply.send({ ok: true, data });
    } finally {
      client.release();
    }
  });

  app.put('/:id/confirmed', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    if (!canPrice(req.user, 'purchases.invoices')) return sendError(reply, 403, 'تعديل فاتورة مرحّلة يتطلب صلاحية التسعير', 'FORBIDDEN');
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await updatePurchaseInvoiceConfirmed(client, companyId, userId, id, req.body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || '', 'VALIDATION');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || '', 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let body = req.body;
      if (!canPrice(req.user, 'purchases.invoices')) {
        const priced = await client.query(`SELECT 1 FROM purchase_invoice_lines WHERE invoice_id=$1 AND company_id=$2 AND unit_cost > 0 LIMIT 1`, [id, companyId]);
        if (priced.rows.length) {
          await client.query('ROLLBACK');
          return sendError(reply, 403, 'سعّر المحاسب هذه الفاتورة؛ تعديلها من صلاحية التسعير', 'FORBIDDEN');
        }
        body = unpricedInvoiceBody(body);
      }
      await updatePurchaseInvoiceDraft(client, companyId, userId, id, body);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'DUPLICATE') return sendError(reply, 409, err.message || '', 'DUPLICATE');
      throw e;
    } finally {
      client.release();
    }
  });

  app.delete('/:id/purge', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await purgeVoidedPurchaseInvoice(client, companyId, userId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true, data: result });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || '', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      throw e;
    } finally {
      client.release();
    }
  });

  app.delete('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deletePurchaseInvoiceDraft(client, companyId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || '', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    if (!canPrice(req.user, 'purchases.invoices')) return sendError(reply, 403, 'ترحيل فاتورة الشراء من صلاحية المحاسب أو المدير', 'FORBIDDEN');
    const { id } = req.params as { id: string };
    const body = (req.body as Record<string, unknown>) || {};
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await confirmPurchaseInvoice(client, companyId, userId, id, {
        cashboxId: typeof body.cashboxId === 'string' ? body.cashboxId : null,
        partyNameForVoucher: typeof body.partyNameForVoucher === 'string' ? body.partyNameForVoucher : null,
      });
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || '', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || '', 'VALIDATION');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || '', 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/:id/void', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await voidPurchaseInvoice(client, companyId, userId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || '', 'NOT_FOUND');
      if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || '', 'INVALID_STATE');
      if (err.code === 'INVALID_STOCK') return sendError(reply, 400, err.message || '', 'INVALID_STOCK');
      throw e;
    } finally {
      client.release();
    }
  });
};
