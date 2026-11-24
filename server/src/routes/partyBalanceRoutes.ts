import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, canSeeFinance } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { addPartyNote, getPartyBalances, listPartyNotes, savePartyProfile, type PartyKind } from '../services/partyBalancesService.js';

/** أرصدة العملاء والموردين: بيانات مالية، فتلزم «الأمور المالية» للعملاء/الموردين (يطبّقها الخادم لا الواجهة). */
const KINDS: Record<string, { kind: PartyKind; module: 'customers' | 'suppliers' }> = {
  customers: { kind: 'CUSTOMER', module: 'customers' },
  suppliers: { kind: 'SUPPLIER', module: 'suppliers' },
};

function handle(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message ?? 'بيانات غير صالحة', 'VALIDATION');
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message ?? 'غير موجود', 'NOT_FOUND');
  throw e;
}

export const partyBalanceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticateRequest);
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const seg = (req.url.split('?')[0].split('/').filter(Boolean)[2] ?? '');
    const cfg = KINDS[seg];
    if (!cfg) return sendError(reply, 404, 'مسار غير معروف', 'NOT_FOUND');
    if (!canSeeFinance(req.user, cfg.module)) return sendError(reply, 403, 'ليست لديك صلاحية على الأمور المالية لهذه الأرصدة', 'FORBIDDEN');
    const id = (req.params as { id?: string } | undefined)?.id;
    if (id && !z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'معرف غير صالح', 'VALIDATION');
  });

  // مسارات حرفية لكل نوع (لا :kind) كي يطابقها الحارس المركزي بوحدتها (customers.balances / suppliers.balances).
  for (const [seg, cfg] of Object.entries(KINDS)) {
    const kind = cfg.kind;

    app.get(`/${seg}`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      const sort = (['name', 'balance', 'lastPayment', 'lastOperation'] as const).find((s) => s === q.sort);
      reply.header('Cache-Control', 'no-store');
      return {
        ok: true,
        data: await getPartyBalances(getPool(), req.user!.companyId, kind, {
          search: q.search, currency: q.currency?.toUpperCase() || undefined,
          onlyWithBalance: q.onlyWithBalance === 'true', onlyAlerts: q.onlyAlerts === 'true',
          sort, dir: q.dir === 'asc' ? 'asc' : 'desc',
        }),
      };
    });

    app.put(`/${seg}/:id/profile`, async (req, reply) => {
      const parsed = z.object({
        ownerUserId: z.string().uuid().nullable().optional(),
        creditLimit: z.number().nonnegative().nullable().optional(), creditLimitCurrency: z.string().min(1).max(8).nullable().optional(),
        expectedCollectionDate: z.string().nullable().optional(),
        promisedAmount: z.number().nonnegative().nullable().optional(), promisedCurrency: z.string().min(1).max(8).nullable().optional(),
      }).strict().safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, 'بيانات المتابعة غير صالحة', 'VALIDATION');
      try {
        await savePartyProfile(getPool(), req.user!.companyId, req.user!.sub, kind, (req.params as { id: string }).id, parsed.data);
        return { ok: true };
      } catch (e) { return handle(reply, e); }
    });

    app.get(`/${seg}/:id/notes`, async (req) => ({ ok: true, data: await listPartyNotes(getPool(), req.user!.companyId, kind, (req.params as { id: string }).id) }));

    app.post(`/${seg}/:id/notes`, async (req, reply) => {
      const parsed = z.object({ note: z.string().min(1).max(2000) }).strict().safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, 'نص الملاحظة غير صالح', 'VALIDATION');
      try {
        await addPartyNote(getPool(), req.user!.companyId, req.user!.sub, kind, (req.params as { id: string }).id, parsed.data.note);
        return reply.code(201).send({ ok: true });
      } catch (e) { return handle(reply, e); }
    });
  }
};
