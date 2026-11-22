import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  addCheckImage,
  deleteCheckImage,
  getCheckImageData,
  getPrintData,
  listCheckImages,
  resetCheckImageEdit,
  saveCheckImageEdit,
} from '../services/checkImagesService.js';

const uuid = z.string().uuid();
const sideSchema = z.enum(['FRONT', 'BACK', 'OTHER']);
const addBody = z.object({ side: sideSchema.default('FRONT'), data: z.string().min(20) });
const editBody = z.object({ editedData: z.string().min(20), editParams: z.unknown().optional(), side: sideSchema.optional() });

function handle(reply: Parameters<typeof sendError>[0], e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || 'بيانات غير صالحة', 'VALIDATION');
  if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
  throw e;
}

/**
 * صور الشيكات — وحدة صلاحيات مستقلة (`treasury.check_images`): عرض / رفع (إنشاء) / تعديل (قص-تدوير) / حذف.
 * لا شيء هنا يغيّر قيمة الشيك أو حالته أو قيوده؛ التعديل يُحفظ بجانب الأصل ويُسجَّل في سجل التدقيق.
 */
export const checkImagesRoutes: FastifyPluginAsync = async (app) => {
  // صور شيك: بيانات وصفية فقط (بلا محتوى) لعرض الصور وأدواتها.
  app.get('/by-check/:checkId', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { checkId } = req.params as { checkId: string };
    if (!uuid.safeParse(checkId).success) return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
    try {
      return reply.send({ ok: true, data: await listCheckImages(getPool(), companyId, checkId) });
    } catch (e) {
      return handle(reply, e);
    }
  });

  // بيانات الطباعة لعدة شيكات: ?ids=a,b,c (حتى 60).
  app.get('/print-data', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const ids = String((req.query as Record<string, string>).ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length || ids.length > 60 || !ids.every((i) => uuid.safeParse(i).success)) return sendError(reply, 400, 'قائمة شيكات غير صالحة (حتى 60)', 'VALIDATION');
    return reply.send({ ok: true, data: await getPrintData(getPool(), companyId, ids) });
  });

  // محتوى صورة: ?variant=original|effective (الافتراضي الفعّالة).
  app.get('/:imageId/data', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { imageId } = req.params as { imageId: string };
    const variant = (req.query as Record<string, string>).variant === 'original' ? 'original' : 'effective';
    if (!uuid.safeParse(imageId).success) return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
    try {
      const r = await getCheckImageData(getPool(), companyId, imageId, variant);
      return reply.send({ ok: true, data: { image: r.data, checkId: r.checkId } });
    } catch (e) {
      return handle(reply, e);
    }
  });

  app.post('/by-check/:checkId', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { checkId } = req.params as { checkId: string };
    const parsed = addBody.safeParse(req.body);
    if (!uuid.safeParse(checkId).success || !parsed.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const meta = await addCheckImage(client, { companyId, userId, checkId, side: parsed.data.side, data: parsed.data.data });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: meta });
    } catch (e) {
      await client.query('ROLLBACK');
      return handle(reply, e);
    } finally {
      client.release();
    }
  });

  // حفظ تعديل (قص/تدوير) كنسخة معدَّلة بجانب الأصل.
  app.put('/:imageId', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { imageId } = req.params as { imageId: string };
    const parsed = editBody.safeParse(req.body);
    if (!uuid.safeParse(imageId).success || !parsed.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const meta = await saveCheckImageEdit(client, { companyId, userId, imageId, editedData: parsed.data.editedData, editParams: parsed.data.editParams, side: parsed.data.side });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: meta });
    } catch (e) {
      await client.query('ROLLBACK');
      return handle(reply, e);
    } finally {
      client.release();
    }
  });

  // العودة للصورة الأصلية (PUT ⇒ إجراء «تعديل»، لا «إنشاء»).
  app.put('/:imageId/reset', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { imageId } = req.params as { imageId: string };
    if (!uuid.safeParse(imageId).success) return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const meta = await resetCheckImageEdit(client, { companyId, userId, imageId });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: meta });
    } catch (e) {
      await client.query('ROLLBACK');
      return handle(reply, e);
    } finally {
      client.release();
    }
  });

  // حذف صورة (يشمل أصلها): للمحاسب/المدير بوضع الدور، أو لمن مُنح «حذف» بالمصفوفة.
  app.delete('/:imageId', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId, role } = req.user!;
    const { imageId } = req.params as { imageId: string };
    if (!uuid.safeParse(imageId).success) return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
    if (!req.user!.customPerms && role !== 'admin' && role !== 'accountant') {
      return sendError(reply, 403, 'حذف صورة الشيك من صلاحية المحاسب أو المدير', 'FORBIDDEN');
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await deleteCheckImage(client, { companyId, userId, imageId });
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
