import type { FastifyPluginAsync } from 'fastify';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { getPool } from '../db/pool.js';
import { manufacturingOverview, receiveManufacturingBatch, settleManufacturingShortage,
  resolveManufacturingDefect, priceManufacturingServices, closeManufacturingJob,
  replaceManufacturingServices } from '../services/externalManufacturingLifecycle.js';

export const externalManufacturingRoutes: FastifyPluginAsync = async app => {
  app.get('/:id/lifecycle', { preHandler: authenticateRequest }, async (req, reply) => {
    try {
      const data = await manufacturingOverview(getPool(), req.user!.companyId, (req.params as { id: string }).id);
      const canPrice = ['admin', 'accountant'].includes(req.user!.role);
      if (!canPrice) { for (const s of data.services) { delete s.unit_price; delete s.currency_code; delete s.approved_quantity; delete s.total_usd; } }
      return reply.send({ ok: true, data, canPrice, canManage: canPrice, canReceive: req.user!.role === 'admin' || req.user!.permissions.includes('inventory.manage') });
    } catch (e) { return handle(e, reply, req); }
  });
  const actions = {
    returns: { privileged: false, run: receiveManufacturingBatch },
    services: { privileged: false, run: async (db, company, _user, job, body) => replaceManufacturingServices(db, company, job, body) },
    settlements: { privileged: true, run: settleManufacturingShortage },
    'resolve-defect': { privileged: true, run: resolveManufacturingDefect },
    'service-pricing': { privileged: true, run: priceManufacturingServices },
    close: { privileged: true, run: async (db, company, _user, job) => closeManufacturingJob(db, company, job) },
  } satisfies Record<string, { privileged: boolean; run: (db: import('pg').PoolClient, company: string, user: string, job: string, body: unknown) => Promise<unknown> }>;
  for (const [action, spec] of Object.entries(actions)) {
    app.post(`/:id/lifecycle/${action}`, { preHandler: authenticateRequest }, async (req, reply) => {
      const user = req.user!;
      const privileged = ['admin', 'accountant'].includes(user.role);
      if (spec.privileged ? !privileged : user.role !== 'admin' && !user.permissions.includes('inventory.manage')) return sendError(reply, 403, 'ليست لديك صلاحية هذا الإجراء', 'FORBIDDEN');
      const db = await getPool().connect();
      try {
        await db.query('BEGIN');
        const data = await spec.run(db, user.companyId, user.sub, (req.params as { id: string }).id, req.body);
        await db.query('COMMIT'); return reply.send({ ok: true, data });
      } catch (e) { await db.query('ROLLBACK'); return handle(e, reply, req); }
      finally { db.release(); }
    });
  }
};

function handle(e: unknown, reply: import('fastify').FastifyReply, req: import('fastify').FastifyRequest) {
  const err = e as { code?: string; message?: string; issues?: unknown };
  if (err.issues) return sendError(reply, 400, 'تحقق من الحقول المطلوبة والكميات ودقة الأرقام', 'VALIDATION');
  if (['VALIDATION', 'INVALID_STATE', 'INVALID_STOCK', 'DUPLICATE', 'NOT_FOUND'].includes(err.code || '')) return sendError(reply, err.code === 'NOT_FOUND' ? 404 : err.code === 'DUPLICATE' ? 409 : 400, err.message!, err.code);
  if (['23505', '23514', '23503', '40P01', '40001'].includes(err.code || '')) return sendError(reply, 409, 'تعارض في البيانات أو الحجز؛ حدّث المهمة وراجع الكميات قبل إعادة المحاولة', 'CONFLICT');
  req.log.error({ code: err.code || 'UNKNOWN', requestId: req.id }, 'External manufacturing operation failed');
  return sendError(reply, 500, 'تعذر حفظ عملية المصنعية؛ راجع المسؤول برقم الطلب', 'SERVER');
}
