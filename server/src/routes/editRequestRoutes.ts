import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, canEditDirect } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  createEditRequest,
  decideEditRequest,
  listMyRequests,
  listPendingFor,
  listSupervisorAssignments,
  setSupervisor,
} from '../services/editRequestService.js';

const uuid = z.string().uuid();
const entityType = z.enum(['CUSTOMER', 'SUPPLIER', 'SALES_INVOICE', 'PURCHASE_INVOICE']);

function handle(reply: Parameters<typeof sendError>[0], e: unknown) {
  const err = e as { code?: string; message?: string };
  const map: Record<string, number> = { VALIDATION: 400, NOT_FOUND: 404, INVALID_STATE: 409, FORBIDDEN: 403 };
  if (err?.code && map[err.code]) return sendError(reply, map[err.code], err.message || 'خطأ', err.code);
  throw e;
}

/** المعتمِد الشامل: مدير/محاسب/مدير تشغيلي (يرى كل الطلبات). المسؤول المعيَّن يرى طلبات موظفيه فقط. */
const seesAll = (user: Parameters<typeof canEditDirect>[0]) => canEditDirect(user, 'sales.invoices');

export const editRequestRoutes: FastifyPluginAsync = async (app) => {
  // الموظف يطلب إذن تعديل عنصر.
  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    const parsed = z.object({ entityType, entityId: uuid, reason: z.string().min(3).max(500) }).safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'اكتب سبب التعديل (3 أحرف على الأقل)', 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const data = await createEditRequest(client, { companyId, userId: sub, ...parsed.data });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data });
    } catch (e) {
      await client.query('ROLLBACK');
      return handle(reply, e);
    } finally {
      client.release();
    }
  });

  // حالة طلباتي لعنصر معيّن (للواجهة: معلّق/معتمد/مرفوض).
  app.get('/mine', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    const q = req.query as Record<string, string>;
    if (!entityType.safeParse(q.entityType).success || !uuid.safeParse(q.entityId).success) return sendError(reply, 400, 'عنصر غير صالح', 'VALIDATION');
    return reply.send({ ok: true, data: await listMyRequests(getPool(), companyId, sub, q.entityType, q.entityId) });
  });

  // الطلبات المعلّقة للمعتمِد (الجرس).
  app.get('/pending', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    return reply.send({ ok: true, data: await listPendingFor(getPool(), companyId, sub, seesAll(req.user)) });
  });

  app.put('/:id/decision', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = z.object({ approve: z.boolean(), note: z.string().max(300).optional().nullable() }).safeParse(req.body);
    if (!uuid.safeParse(id).success || !parsed.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const data = await decideEditRequest(client, { companyId, approverId: sub, approverSeesAll: seesAll(req.user), requestId: id, approve: parsed.data.approve, note: parsed.data.note });
      await client.query('COMMIT');
      return reply.send({ ok: true, data });
    } catch (e) {
      await client.query('ROLLBACK');
      return handle(reply, e);
    } finally {
      client.release();
    }
  });

  // ---- مركز الإعدادات: ربط الموظف بمسؤوله (لمن يملك إدارة المستخدمين)
  const canManageUsers = (u: { role: string; permissions: string[] } | undefined) => Boolean(u && (u.role === 'admin' || u.permissions.includes('users.manage')));

  app.get('/supervisors', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canManageUsers(req.user)) return sendError(reply, 403, 'ليست لديك صلاحية', 'FORBIDDEN');
    return reply.send({ ok: true, data: await listSupervisorAssignments(getPool(), req.user!.companyId) });
  });

  app.put('/supervisors/:userId', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!canManageUsers(req.user)) return sendError(reply, 403, 'ليست لديك صلاحية', 'FORBIDDEN');
    const { companyId, sub } = req.user!;
    const { userId } = req.params as { userId: string };
    const parsed = z.object({ supervisorId: uuid.nullable() }).safeParse(req.body);
    if (!uuid.safeParse(userId).success || !parsed.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await setSupervisor(client, { companyId, actorId: sub, userId, supervisorId: parsed.data.supervisorId });
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      return handle(reply, e);
    } finally {
      client.release();
    }
  });
};
