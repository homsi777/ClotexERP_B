import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { listActiveSessions } from '../services/activeSessionsService.js';
import { listMessages, listPeers, markRead, sendMessage } from '../services/chatService.js';

const peerSchema = z.string().min(1).max(64);
const sendBody = z.object({ peer: peerSchema, body: z.string().min(1).max(2000) });
const readBody = z.object({ peer: peerSchema });

function handle(reply: Parameters<typeof sendError>[0], e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || 'بيانات غير صالحة', 'VALIDATION');
  if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
  // معرّف مستخدم بصيغة غير صالحة يرمي خطأ uuid من القاعدة.
  if (err?.code === '22P02') return sendError(reply, 400, 'محادثة غير صالحة', 'VALIDATION');
  throw e;
}

/** دردشة داخلية على مستوى الفرع (company_id) — تتبع المستخدم المسجَّل فقط، بلا صلاحية وحدة (متاحة لكل مستخدم). */
export const chatRoutes: FastifyPluginAsync = async (app) => {
  // المحادثات + غير المقروء + من هو متصل الآن.
  app.get('/peers', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    try {
      const peers = await listPeers(getPool(), companyId, sub);
      const online = new Set(listActiveSessions(companyId).map((s) => s.userId));
      return reply.send({
        ok: true,
        data: {
          peers: peers.map((p) => ({ ...p, online: p.kind === 'user' ? online.has(p.key) : undefined })),
          unreadTotal: peers.reduce((s, p) => s + p.unread, 0),
        },
      });
    } catch (e) {
      return handle(reply, e);
    }
  });

  app.get('/messages', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    const q = req.query as { peer?: string; after?: string; limit?: string };
    const peer = peerSchema.safeParse(q.peer);
    if (!peer.success) return sendError(reply, 400, 'محادثة غير محدّدة', 'VALIDATION');
    try {
      const data = await listMessages(getPool(), companyId, sub, peer.data, {
        afterId: q.after ? Number(q.after) || 0 : 0,
        limit: q.limit ? Number(q.limit) || 100 : 100,
      });
      return reply.send({ ok: true, data });
    } catch (e) {
      return handle(reply, e);
    }
  });

  app.post('/messages', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    const parsed = sendBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'الرسالة فارغة أو طويلة (الحد 2000 حرف)', 'VALIDATION');
    try {
      const data = await sendMessage(getPool(), companyId, sub, parsed.data.peer, parsed.data.body);
      return reply.status(201).send({ ok: true, data });
    } catch (e) {
      return handle(reply, e);
    }
  });

  app.post('/read', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub } = req.user!;
    const parsed = readBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'محادثة غير محدّدة', 'VALIDATION');
    try {
      await markRead(getPool(), companyId, sub, parsed.data.peer);
      return reply.send({ ok: true });
    } catch (e) {
      return handle(reply, e);
    }
  });
};
