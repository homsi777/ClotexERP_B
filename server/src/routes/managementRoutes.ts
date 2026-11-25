import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { getBranchOverview, periodFromQuery } from '../services/platformOverviewService.js';
import { ALERT_TYPES, actOnAlert, branchSummary, getAlertSettings, listAlerts, listPendingDecisions, liquidityForecast, saveAlertSettings, syncAlerts, type AlertStatus } from '../services/alertCenterService.js';
import { getPrefs, parsePrefs, resetPrefs, savePrefs } from '../services/dashboardPrefsService.js';
import { getBranchAnalytics } from '../services/managementAnalyticsService.js';
import { resolvePeriod } from '../services/managementMetricsService.js';
import { administrativeExceptions, listUsersOversight, permissionChangeLog } from '../services/oversightService.js';

/** من يرى لوحة إدارة الفرع: مدير النظام/المدير/المحاسب (وضع الدور)، أو من مُنح «عرض» وحدة الإدارة (وضع مخصّص يطبّقه الحارس المركزي). */
export function canSeeManagement(user: { role: string; customPerms?: boolean; permissions?: string[] } | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.customPerms) return true; // الحارس المركزي تحقق من مصفوفة «لوحة إدارة الفرع»
  // وضع الدور: لا أحد غير المدير يراها تلقائياً؛ يمنحها المالك صراحةً بصلاحية management.view
  return (user.permissions ?? []).includes('management.view');
}

const periodObj = (q: Record<string, string>) => resolvePeriod((q.period as 'month') || 'month', { from: q.from, to: q.to });

function handle(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message ?? 'بيانات غير صالحة', 'VALIDATION');
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message ?? 'غير موجود', 'NOT_FOUND');
  throw e;
}

/** لوحة إدارة الفرع ومركز تنبيهاته: بيانات فرع المستخدم وحده، ولا تكشف فرعاً آخر. */
export const managementRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticateRequest);
  app.addHook('preHandler', async (req, reply) => {
    if (!canSeeManagement(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    reply.header('Cache-Control', 'no-store');
  });

  app.get('/overview', async (req, reply) => {
    try { return { ok: true, data: await getBranchOverview(getPool(), req.user!.companyId, periodFromQuery(req.query as Record<string, string>)) }; }
    catch (e) { return handle(reply, e); }
  });

  // الرسوم البيانية: تُحمَّل عند الطلب
  app.get('/analytics', async (req, reply) => {
    try { return { ok: true, data: await getBranchAnalytics(getPool(), req.user!.companyId, periodObj(req.query as Record<string, string>)) }; }
    catch (e) { return handle(reply, e); }
  });

  // تفضيلات عرض اللوحة لهذا المستخدم (عرض فقط، لا صلاحيات)
  app.get('/preferences', async (req) => ({ ok: true, data: await getPrefs(getPool(), req.user!.sub, 'branch') }));
  app.put('/preferences', async (req, reply) => {
    const prefs = parsePrefs(req.body); if (!prefs) return sendError(reply, 400, 'تخصيص غير صالح', 'VALIDATION');
    await savePrefs(getPool(), req.user!.sub, 'branch', prefs); return { ok: true, data: prefs };
  });
  app.delete('/preferences', async (req) => { await resetPrefs(getPool(), req.user!.sub, 'branch'); return { ok: true }; });

  // ── مركز التنبيهات ──
  app.get('/alerts', async (req) => {
    const q = req.query as Record<string, string>;
    const db = getPool(), companyId = req.user!.companyId;
    await syncAlerts(db, companyId, await getAlertSettings(db, companyId));
    const status = (['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED', 'ACTIVE'] as const).find((s) => s === q.status) ?? 'ACTIVE';
    return { ok: true, data: { types: ALERT_TYPES, alerts: await listAlerts(db, companyId, { status: status as AlertStatus | 'ACTIVE', assignee: q.assignee && /^[0-9a-f-]{36}$/i.test(q.assignee) ? q.assignee : undefined }) } };
  });
  app.post('/alerts/action', async (req, reply) => {
    const parsed = z.object({ key: z.string().min(1).max(200), action: z.enum(['ack', 'snooze', 'assign', 'reopen', 'note']), until: z.string().optional(), assigneeUserId: z.string().uuid().nullable().optional(), note: z.string().max(1000).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'بيانات الإجراء غير صالحة', 'VALIDATION');
    try { await actOnAlert(getPool(), req.user!.companyId, req.user!.sub, parsed.data); return { ok: true }; }
    catch (e) { return handle(reply, e); }
  });
  app.get('/alert-settings', async (req) => ({ ok: true, data: { settings: await getAlertSettings(getPool(), req.user!.companyId), types: ALERT_TYPES } }));
  app.put('/alert-settings', async (req, reply) => {
    const parsed = z.object({ inactiveCustomerDays: z.number().int().optional(), slowStockDays: z.number().int().optional(), externalLateDays: z.number().int().optional(), draftAgeDays: z.number().int().optional(), chequeDueSoonDays: z.number().int().optional(), disabledTypes: z.array(z.string()).max(30).optional(), enabledOptionalTypes: z.array(z.string()).max(30).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    try { return { ok: true, data: await saveAlertSettings(getPool(), req.user!.companyId, req.user!.sub, parsed.data) }; }
    catch (e) { return handle(reply, e); }
  });

  // ── القرارات والموافقات المعلّقة (تجمع الآليات الموجودة؛ الاعتماد من شاشاتها) ──
  app.get('/decisions', async (req) => ({ ok: true, data: await listPendingDecisions(getPool(), req.user!.companyId) }));

  // ── السيولة والملخصات ──
  app.get('/liquidity', async (req) => ({ ok: true, data: await liquidityForecast(getPool(), req.user!.companyId) }));
  app.get('/summary', async (req, reply) => {
    const kind = (['daily', 'weekly', 'monthly'] as const).find((k) => k === (req.query as Record<string, string>).kind) ?? 'daily';
    try { return { ok: true, data: await branchSummary(getPool(), req.user!.companyId, kind) }; } catch (e) { return handle(reply, e); }
  });

  // ── المستخدمون والرقابة (فرع المستخدم وحده) ──
  app.get('/oversight', async (req) => {
    const db = getPool(), companyId = req.user!.companyId;
    return { ok: true, data: { users: await listUsersOversight(db, companyId), permissionLog: await permissionChangeLog(db, companyId), exceptions: await administrativeExceptions(db, companyId) } };
  });
};
