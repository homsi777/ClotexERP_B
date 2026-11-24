import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, requirePlatformAdmin } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { getPlatformOverview, periodFromQuery } from '../services/platformOverviewService.js';
import { canSeeAdminCost, listCostGroups, listCostRolls, listDelegates, profitability, rateHistory, setDelegates, setRates, type ProfitDimension } from '../services/adminCostService.js';
import { ALERT_TYPES, actOnAlert, branchSummary, getAlertSettings, listAlerts, listPendingDecisions, liquidityForecast, saveAlertSettings, syncAlerts } from '../services/alertCenterService.js';
import { getBranchAnalytics } from '../services/managementAnalyticsService.js';
import { getPrefs, parsePrefs, resetPrefs, savePrefs } from '../services/dashboardPrefsService.js';
import { resolvePeriod } from '../services/managementMetricsService.js';
import { administrativeExceptions, listUsersOversight, permissionChangeLog } from '../services/oversightService.js';

function handle(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message ?? 'بيانات غير صالحة', 'VALIDATION');
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message ?? 'غير موجود', 'NOT_FOUND');
  throw e;
}
const ownerOnly = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!requirePlatformAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
  reply.header('Cache-Control', 'no-store');
};

/** لوحة المالك (مدير المنصة فقط): كل الفروع، قراءة ومقارنة، مع قسم التكلفة الإدارية السرّية. */
export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticateRequest);

  app.get('/overview', { preHandler: ownerOnly }, async (req, reply) => {
    try { return { ok: true, data: await getPlatformOverview(getPool(), periodFromQuery(req.query as Record<string, string>)) }; }
    catch (e) { return handle(reply, e); }
  });

  // تنبيهات وقرارات وسيولة كل الفروع (مقروءة للمالك؛ كل فرع في قسمه ولا اختلاط)
  app.get('/alerts', { preHandler: ownerOnly }, async () => {
    const db = getPool();
    const branches = (await db.query<{ id: string; code: string; name: string }>('SELECT id, code, name FROM companies WHERE is_active ORDER BY code')).rows;
    const out = [];
    for (const b of branches) {
      await syncAlerts(db, b.id, await getAlertSettings(db, b.id));
      out.push({ branchId: b.id, branch: b.name, alerts: await listAlerts(db, b.id, { status: 'ACTIVE' }), decisions: await listPendingDecisions(db, b.id), liquidity: await liquidityForecast(db, b.id) });
    }
    return { ok: true, data: out };
  });

  // ── إدارة تنبيهات أي فرع مباشرةً من لوحة المالك (دون تبديل الفرع)؛ يُسجَّل المستخدم المنفِّذ والفرع في سجل التنبيه ──
  const branchOfOwner = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const id = (req.query as Record<string, string>).branchId;
    if (!z.string().uuid().safeParse(id).success) { sendError(reply, 400, 'معرّف الفرع غير صالح', 'VALIDATION'); return null; }
    if (!(await getPool().query('SELECT 1 FROM companies WHERE id=$1', [id])).rows.length) { sendError(reply, 404, 'الفرع غير موجود', 'NOT_FOUND'); return null; }
    return id;
  };
  app.post('/alerts/action', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOfOwner(req, reply); if (!id) return;
    const parsed = z.object({ key: z.string().min(1).max(200), action: z.enum(['ack', 'snooze', 'assign', 'reopen', 'note']), until: z.string().optional(), assigneeUserId: z.string().uuid().nullable().optional(), note: z.string().max(1000).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'بيانات الإجراء غير صالحة', 'VALIDATION');
    try { await actOnAlert(getPool(), id, req.user!.sub, parsed.data); return { ok: true }; } catch (e) { return handle(reply, e); }
  });
  app.get('/alert-settings', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOfOwner(req, reply); if (!id) return;
    return { ok: true, data: { settings: await getAlertSettings(getPool(), id), types: ALERT_TYPES } };
  });
  app.put('/alert-settings', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOfOwner(req, reply); if (!id) return;
    const parsed = z.object({ inactiveCustomerDays: z.number().int().optional(), slowStockDays: z.number().int().optional(), externalLateDays: z.number().int().optional(), draftAgeDays: z.number().int().optional(), chequeDueSoonDays: z.number().int().optional(), disabledTypes: z.array(z.string()).max(30).optional(), enabledOptionalTypes: z.array(z.string()).max(30).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    try { return { ok: true, data: await saveAlertSettings(getPool(), id, req.user!.sub, parsed.data) }; } catch (e) { return handle(reply, e); }
  });
  app.get('/branch-users', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOfOwner(req, reply); if (!id) return;
    return { ok: true, data: (await getPool().query('SELECT id, COALESCE(full_name, username) AS name FROM users WHERE company_id=$1 AND is_active ORDER BY 2', [id])).rows };
  });
  app.get('/summary', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOfOwner(req, reply); if (!id) return;
    const kind = (['daily', 'weekly', 'monthly'] as const).find((k) => k === (req.query as Record<string, string>).kind) ?? 'daily';
    try { return { ok: true, data: await branchSummary(getPool(), id, kind) }; } catch (e) { return handle(reply, e); }
  });
  app.get('/analytics', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOfOwner(req, reply); if (!id) return;
    const q = req.query as Record<string, string>;
    try { return { ok: true, data: await getBranchAnalytics(getPool(), id, resolvePeriod((q.period as 'month') || 'month', { from: q.from, to: q.to })) }; } catch (e) { return handle(reply, e); }
  });
  app.get('/preferences', { preHandler: ownerOnly }, async (req) => ({ ok: true, data: await getPrefs(getPool(), req.user!.sub, 'owner') }));
  app.put('/preferences', { preHandler: ownerOnly }, async (req, reply) => {
    const prefs = parsePrefs(req.body); if (!prefs) return sendError(reply, 400, 'تخصيص غير صالح', 'VALIDATION');
    await savePrefs(getPool(), req.user!.sub, 'owner', prefs); return { ok: true, data: prefs };
  });
  app.delete('/preferences', { preHandler: ownerOnly }, async (req) => { await resetPrefs(getPool(), req.user!.sub, 'owner'); return { ok: true }; });

  app.get('/users', { preHandler: ownerOnly }, async () => {
    const db = getPool();
    return { ok: true, data: { users: await listUsersOversight(db, null), permissionLog: await permissionChangeLog(db, null), exceptions: await administrativeExceptions(db, null) } };
  });

  // ── التكلفة الإدارية والربحية: المالك أو من فوّضه صراحةً فقط ──
  const costGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await canSeeAdminCost(getPool(), req.user))) return sendError(reply, 403, 'هذا القسم للمالك فقط أو لمن فوّضه صراحةً', 'FORBIDDEN');
    reply.header('Cache-Control', 'no-store');
  };
  const branchOf = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const id = (req.query as Record<string, string>).branchId ?? req.user!.companyId;
    // المفوَّض (غير المالك) يعمل على فرعه فقط؛ المالك على أي فرع.
    if (!requirePlatformAdmin(req.user) && id !== req.user!.companyId) { sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN'); return null; }
    if (!z.string().uuid().safeParse(id).success) { sendError(reply, 400, 'معرّف الفرع غير صالح', 'VALIDATION'); return null; }
    return id;
  };

  app.get('/admin-cost/groups', { preHandler: costGuard }, async (req, reply) => {
    const id = await branchOf(req, reply); if (!id) return;
    const q = req.query as Record<string, string>;
    return { ok: true, data: await listCostGroups(getPool(), id, { onlyMissing: q.onlyMissing === 'true', search: q.search }) };
  });
  app.get('/admin-cost/rolls', { preHandler: costGuard }, async (req, reply) => {
    const id = await branchOf(req, reply); if (!id) return;
    const q = req.query as Record<string, string>;
    if (!z.string().uuid().safeParse(q.itemId).success) return sendError(reply, 400, 'الخامة مطلوبة', 'VALIDATION');
    return { ok: true, data: await listCostRolls(getPool(), id, { itemId: q.itemId, colorId: z.string().uuid().safeParse(q.colorId).success ? q.colorId : null, onlyMissing: q.onlyMissing === 'true' }) };
  });
  app.get('/admin-cost/history', { preHandler: costGuard }, async (req, reply) => {
    const id = await branchOf(req, reply); if (!id) return;
    const q = req.query as Record<string, string>;
    const ok = (v: string | undefined) => (z.string().uuid().safeParse(v).success ? v : undefined);
    return { ok: true, data: await rateHistory(getPool(), id, { itemId: ok(q.itemId), rollId: ok(q.rollId) }) };
  });
  app.put('/admin-cost/rates', { preHandler: costGuard }, async (req, reply) => {
    const id = await branchOf(req, reply); if (!id) return;
    const parsed = z.object({ rates: z.array(z.object({ scope: z.enum(['ITEM', 'ITEM_COLOR', 'ROLL']), itemId: z.string().uuid().nullable().optional(), colorId: z.string().uuid().nullable().optional(), rollId: z.string().uuid().nullable().optional(), unitCostPerMeter: z.number().positive(), basis: z.enum(['METER', 'KG']).optional(), currency: z.string().min(2).max(8), note: z.string().max(300).nullable().optional() }).strict()).min(1).max(500) }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'بيانات التكلفة غير صالحة', 'VALIDATION');
    try { return { ok: true, data: { saved: await setRates(getPool(), id, req.user!.sub, parsed.data.rates) } }; } catch (e) { return handle(reply, e); }
  });
  app.get('/admin-cost/profitability', { preHandler: costGuard }, async (req, reply) => {
    const id = await branchOf(req, reply); if (!id) return;
    let p; try { p = periodFromQuery(req.query as Record<string, string>); } catch (e) { return handle(reply, e); }
    const by = (['item', 'color', 'roll', 'customer', 'invoice', 'creator'] as const).find((d) => d === (req.query as Record<string, string>).by) ?? 'item';
    return { ok: true, data: await profitability(getPool(), id, p.from, p.to, by as ProfitDimension) };
  });
  app.get('/admin-cost/delegates', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOf(req, reply); if (!id) return;
    return { ok: true, data: await listDelegates(getPool(), id) };
  });
  app.put('/admin-cost/delegates', { preHandler: ownerOnly }, async (req, reply) => {
    const id = await branchOf(req, reply); if (!id) return;
    const parsed = z.object({ userIds: z.array(z.string().uuid()).max(20) }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    try { await setDelegates(getPool(), id, req.user!.sub, parsed.data.userIds); return { ok: true }; } catch (e) { return handle(reply, e); }
  });
};
