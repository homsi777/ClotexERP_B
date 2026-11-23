import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { archiveSpecCard, createSpecCard, getSpecCard, listSpecCards, parseSpecCardWorkbook, updateSpecCard } from '../services/specCardService.js';

/** صلاحيات الأدوار القديمة (وضع ROLE): العرض/الطباعة/التصدير = عرض المواصفات، الإضافة والتعديل = استيراد المواصفات، الأرشفة = اعتمادها. */
const LEGACY = { read: 'manufacturing.specifications.view', write: 'manufacturing.specifications.import', remove: 'manufacturing.specifications.approve' } as const;

function handle(reply: FastifyReply, e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'VALIDATION') return sendError(reply, 400, err.message ?? 'بيانات غير صالحة', 'VALIDATION');
  if (err.code === 'NOT_FOUND') return sendError(reply, 404, err.message ?? 'غير موجود', 'NOT_FOUND');
  throw e;
}

export const specCardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticateRequest);
  app.addHook('preHandler', async (req, reply) => {
    const u = req.user!;
    const verb = req.method.toUpperCase();
    const need = verb === 'GET' ? LEGACY.read : verb === 'DELETE' ? LEGACY.remove : LEGACY.write;
    if (u.role !== 'admin' && !u.permissions.includes(need)) return sendError(reply, 403, 'ليست لديك صلاحية على بطاقات المواصفات', 'FORBIDDEN');
    const ids = Object.values((req.params ?? {}) as Record<string, string>);
    if (ids.some((id) => !z.string().uuid().safeParse(id).success)) return sendError(reply, 400, 'معرف غير صالح', 'VALIDATION');
  });

  app.get('/', async (req) => {
    const q = req.query as Record<string, string>;
    return { ok: true, data: await listSpecCards(getPool(), req.user!.companyId, { search: q.search, sort: q.sort, dir: q.dir, fabricItemId: q.fabricItemId }) };
  });

  app.get('/:id', async (req, reply) => {
    const card = await getSpecCard(getPool(), req.user!.companyId, (req.params as { id: string }).id);
    if (!card) return sendError(reply, 404, 'البطاقة غير موجودة', 'NOT_FOUND');
    return { ok: true, data: card };
  });

  // قراءة ملف Excel إلى شبكة أوراق للمعاينة قبل الحفظ (لا يُحفظ شيء هنا).
  app.post('/parse-workbook', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const parsed = z.object({ contentBase64: z.string().min(8) }).strict().safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'ملف غير صالح', 'VALIDATION');
    try {
      return { ok: true, data: parseSpecCardWorkbook(parsed.data.contentBase64) };
    } catch (e) { return handle(reply, e); }
  });

  app.post('/', { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    try {
      const data = await createSpecCard(getPool(), req.user!.companyId, req.user!.sub, req.body);
      return reply.code(201).send({ ok: true, data });
    } catch (e) { return handle(reply, e); }
  });

  app.put('/:id', { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    try {
      const data = await updateSpecCard(getPool(), req.user!.companyId, req.user!.sub, (req.params as { id: string }).id, req.body);
      return { ok: true, data };
    } catch (e) { return handle(reply, e); }
  });

  app.delete('/:id', async (req, reply) => {
    const ok = await archiveSpecCard(getPool(), req.user!.companyId, req.user!.sub, (req.params as { id: string }).id);
    return ok ? { ok: true } : sendError(reply, 404, 'البطاقة غير موجودة', 'NOT_FOUND');
  });
};
