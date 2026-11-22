import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  createItemCreationSlip,
  createPurchaseInvoiceFromDispatchSlip,
  getDispatchSlipWithLines,
  listDispatchSlips,
  updateDispatchSlipLinePrices,
  voidIntakeDispatchSlip,
} from '../services/intakeDispatchSlipService.js';

function handleServiceError(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string; issues?: unknown };
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
  if (err.code === 'INVALID_STATE') return sendError(reply, 400, err.message || 'حالة غير صالحة', 'INVALID_STATE');
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || 'بيانات غير صالحة', 'VALIDATION');
  if (err.issues) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
  throw e;
}

export const intakeDispatchSlipRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const rows = await listDispatchSlips(getPool(), companyId);
    return reply.send({ ok: true, data: rows });
  });

  // إنشاء مادة جديدة: بعد إضافة الأتواب تُنشأ إرسالية قابلة للطباعة بها.
  app.post('/item-creation', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = z.object({ rollIds: z.array(z.string().uuid()).min(1).max(1000) }).safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'أتواب غير صالحة', 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const data = await createItemCreationSlip(client, { companyId, userId, rollIds: parsed.data.rollIds });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data });
    } catch (e) {
      await client.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      if (err.code === 'VALIDATION') return sendError(reply, 400, err.message || 'غير صالح', 'VALIDATION');
      if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const result = await getDispatchSlipWithLines(getPool(), companyId, id);
    if (!result) return sendError(reply, 404, 'الإرسالية غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: result });
  });

  app.patch('/:id/lines', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    try {
      await updateDispatchSlipLinePrices(getPool(), companyId, id, req.body);
      return reply.send({ ok: true });
    } catch (e: unknown) {
      return handleServiceError(reply, e);
    }
  });

  app.post('/:id/void', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await voidIntakeDispatchSlip(client, companyId, id);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post('/:id/create-purchase-invoice', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invoice = await createPurchaseInvoiceFromDispatchSlip(client, companyId, userId, id);
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: invoice });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return handleServiceError(reply, e);
    } finally {
      client.release();
    }
  });
};
