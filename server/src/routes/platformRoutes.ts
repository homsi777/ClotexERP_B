import type { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest, requirePlatformAdmin } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { getPlatformOverview, periodFromQuery } from '../services/platformOverviewService.js';

/** لوحة المالك (مدير المنصة فقط): كل الفروع، قراءة فقط. */
export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.get('/overview', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePlatformAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    let period;
    try { period = periodFromQuery(req.query as Record<string, string>); }
    catch (e) { return sendError(reply, 400, (e as Error).message, 'VALIDATION'); }
    reply.header('Cache-Control', 'no-store');
    return { ok: true, data: await getPlatformOverview(getPool(), period) };
  });
};
