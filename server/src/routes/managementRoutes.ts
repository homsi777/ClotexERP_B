import type { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { getBranchOverview, periodFromQuery } from '../services/platformOverviewService.js';

/** من يرى لوحة إدارة الفرع: مدير النظام/المدير/المحاسب (وضع الدور)، أو من مُنح «عرض» وحدة الإدارة (وضع مخصّص يطبّقه الحارس المركزي). */
export function canSeeManagement(user: { role: string; customPerms?: boolean } | undefined): boolean {
  if (!user) return false;
  if (user.customPerms) return true; // الحارس المركزي تحقق من المصفوفة
  return ['admin', 'manager', 'accountant'].includes(user.role);
}

/** لوحة إدارة الفرع: بيانات فرع المستخدم وحده. */
export const managementRoutes: FastifyPluginAsync = async (app) => {
  app.get('/overview', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canSeeManagement(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    let period;
    try { period = periodFromQuery(req.query as Record<string, string>); }
    catch (e) { return sendError(reply, 400, (e as Error).message, 'VALIDATION'); }
    reply.header('Cache-Control', 'no-store');
    return { ok: true, data: await getBranchOverview(getPool(), req.user!.companyId, period) };
  });
};
