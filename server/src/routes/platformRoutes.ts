import type { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest, requirePlatformAdmin } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { getPlatformOverview } from '../services/platformOverviewService.js';

/** لوحة المالك (مدير المنصة فقط): ملخص قراءة فقط لكل الفروع. */
export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.get('/overview', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePlatformAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    reply.header('Cache-Control', 'no-store');
    return { ok: true, data: await getPlatformOverview(getPool()) };
  });
};
