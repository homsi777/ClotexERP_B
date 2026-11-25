import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { createReceipt, linkReceiptToInvoice, listReceipts, listReceivingInvoices } from '../services/purchaseReceivingService.js';

const has = (u: { role: string; permissions: string[]; customPerms?: boolean }, codes: string[], roles: string[] = []) =>
  u.role === 'admin' || Boolean(u.customPerms) || roles.includes(u.role) || codes.some((c) => u.permissions.includes(c));
// وضع الدور: المحاسب والمدير يعاينان ويربطان الاستلام المعلّق بالفاتورة؛ تسجيل الاستلام للمخزن والمدير.
const VIEW_ROLES = ['manager', 'accountant', 'inventory', 'warehouse'], WRITE_ROLES = ['manager', 'inventory', 'warehouse'], LINK_ROLES = [...WRITE_ROLES, 'accountant'];
function handle(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message ?? 'بيانات غير صالحة', 'VALIDATION');
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message ?? 'غير موجود', 'NOT_FOUND');
  if (err.code === 'FORBIDDEN') return sendError(reply, 403, err.message ?? ArabicErrors.forbidden, 'FORBIDDEN');
  throw e;
}

/**
 * استلام المشتريات في المخازن. هذا المسار لا يُرجع أي بيانات مالية إطلاقاً (سعر/تكلفة/إجمالي/خصم/ضريبة/دفع/ذمم):
 * الاستعلامات لا تقرأ الأعمدة المالية أصلاً، فلا يمكن تسريبها من الواجهة. القيد المالي يخص فاتورة المورد وحدها (مرة واحدة).
 */
export const purchaseReceivingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticateRequest);
  app.addHook('preHandler', async (req, reply) => {
    const u = req.user!;
    const isWrite = req.method !== 'GET';
    const isLink = isWrite && /\/link$/.test(req.url.split('?')[0]);
    const ok = isWrite
      ? has(u, ['inventory.manage', 'purchases.manage'], isLink ? LINK_ROLES : WRITE_ROLES)
      : has(u, ['inventory.view', 'inventory.manage', 'purchases.view', 'purchases.manage'], VIEW_ROLES);
    if (!ok) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    reply.header('Cache-Control', 'no-store');
  });

  app.get('/invoices', async (req, reply) => {
    const q = z.object({
      search: z.string().max(100).optional(), supplierId: z.string().uuid().optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      warehouseId: z.string().uuid().optional(), materialKind: z.enum(['FABRIC', 'YARN', 'OTHER']).optional(), status: z.enum(['NOT_RECEIVED', 'PARTIAL', 'COMPLETE', 'OVER']).optional(), invoiceStatus: z.enum(['DRAFT', 'CONFIRMED']).optional(),
    }).safeParse(req.query);
    if (!q.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    return { ok: true, data: await listReceivingInvoices(getPool(), req.user!.companyId, q.data) };
  });
  app.get('/invoices/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const [inv] = await listReceivingInvoices(getPool(), req.user!.companyId, { id });
    if (!inv) return sendError(reply, 404, 'الفاتورة غير موجودة', 'NOT_FOUND');
    return { ok: true, data: { invoice: inv, receipts: await listReceipts(getPool(), req.user!.companyId, { invoiceId: id }) } };
  });
  app.get('/receipts', async (req) => {
    const q = req.query as Record<string, string>;
    return { ok: true, data: await listReceipts(getPool(), req.user!.companyId, { pending: q.pending === '1', invoiceId: z.string().uuid().safeParse(q.invoiceId).success ? q.invoiceId : undefined }) };
  });

  app.post('/receipts', async (req, reply) => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const r = await createReceipt(client, req.user!.companyId, req.user!.sub, req.body, { warehouseScope: req.user!.warehouseIds });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: r });
    } catch (e) { await client.query('ROLLBACK'); return handle(reply, e); } finally { client.release(); }
  });

  app.post('/receipts/:id/link', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ invoiceId: z.string().uuid(), map: z.array(z.object({ receiptLineId: z.string().uuid(), invoiceLineId: z.string().uuid(), conversionFactor: z.coerce.number().positive().optional(), quantityInInvoiceUnit: z.coerce.number().nonnegative().optional() }).strict()).min(1).max(100) }).strict().safeParse(req.body);
    if (!z.string().uuid().safeParse(id).success || !body.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await linkReceiptToInvoice(client, req.user!.companyId, req.user!.sub, id, body.data.invoiceId, body.data.map);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK'); return handle(reply, e); } finally { client.release(); }
  });
};
