import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  ZoneError,
  assignRolls,
  groupRollsByZone,
  itemDistribution,
  pendingAlerts,
  pickRolls,
  pickSchema,
  scopeSchema,
  setZonesEnabled,
  zoneContents,
  zoneSummary,
} from '../services/warehouseZoneService.js';

function canManage(req: FastifyRequest): boolean {
  const u = req.user;
  return !!u && (u.role === 'admin' || u.permissions.includes('inventory.manage'));
}

function mapErr(reply: FastifyReply, e: unknown) {
  if (e instanceof ZoneError) {
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFLICT' ? 409 : 400;
    return reply.status(status).send({ ok: false, error: { code: e.code, message: e.message, barcodes: e.barcodes ?? [] } });
  }
  const err = e as { code?: string; message?: string };
  // 23514 = حارس حجز الجودة على التوب (external_job_quality_hold_guard)
  if (err?.code === '23514') return sendError(reply, 409, err.message || 'التوب محجوز للفحص', 'CONFLICT');
  throw e;
}

async function inTx<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const warehouseZoneRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: authenticateRequest };

  app.get('/alerts', auth, async (req, reply) => {
    return reply.send({ ok: true, data: await pendingAlerts(getPool(), req.user!.companyId) });
  });

  app.post('/group-rolls', auth, async (req, reply) => {
    const body = z.object({ rollIds: z.array(z.string().uuid()).max(5000) }).safeParse(req.body);
    if (!body.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    return reply.send({ ok: true, data: await groupRollsByZone(getPool(), req.user!.companyId, body.data.rollIds) });
  });

  app.post('/assign', auth, async (req, reply) => {
    if (!canManage(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    try {
      return reply.send({ ok: true, data: await inTx((c) => assignRolls(c, companyId, userId, req.body)) });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.get('/:warehouseId/summary', auth, async (req, reply) => {
    const { warehouseId } = req.params as { warehouseId: string };
    try {
      return reply.send({ ok: true, data: await zoneSummary(getPool(), req.user!.companyId, warehouseId) });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.put('/:warehouseId/enabled', auth, async (req, reply) => {
    if (!canManage(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { warehouseId } = req.params as { warehouseId: string };
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION');
    try {
      return reply.send({ ok: true, data: await setZonesEnabled(getPool(), req.user!.companyId, warehouseId, body.data.enabled) });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.get('/:warehouseId/contents', auth, async (req, reply) => {
    const { warehouseId } = req.params as { warehouseId: string };
    const z0 = (req.query as Record<string, string>).zoneId;
    const zoneId = z0 && z0 !== 'none' ? z0 : null;
    try {
      return reply.send({ ok: true, data: await zoneContents(getPool(), req.user!.companyId, warehouseId, zoneId) });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.get('/:warehouseId/items/:itemId/distribution', auth, async (req, reply) => {
    const { warehouseId, itemId } = req.params as { warehouseId: string; itemId: string };
    return reply.send({ ok: true, data: await itemDistribution(getPool(), req.user!.companyId, warehouseId, itemId) });
  });

  app.post('/:warehouseId/pick', auth, async (req, reply) => {
    const { warehouseId } = req.params as { warehouseId: string };
    const body = z.object({ scope: scopeSchema, pick: pickSchema }).safeParse(req.body);
    if (!body.success) return sendError(reply, 400, 'بيانات التحديد غير صالحة', 'VALIDATION');
    try {
      return reply.send({ ok: true, data: await pickRolls(getPool(), req.user!.companyId, warehouseId, body.data.scope, body.data.pick) });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  // إضافة عنبر بالاسم فقط؛ الكود يُولَّد تلقائياً (Z001…) داخل المستودع.
  app.post('/:warehouseId/zones', auth, async (req, reply) => {
    if (!canManage(req)) return sendError(reply, 403, 'ليس لديك صلاحية', 'FORBIDDEN');
    const { companyId } = req.user!;
    const { warehouseId } = req.params as { warehouseId: string };
    const body = z.object({ name: z.string().trim().min(1, 'اسم العنبر مطلوب').max(80) }).safeParse(req.body);
    if (!body.success) return sendError(reply, 400, body.error.issues[0]?.message ?? 'بيانات غير صالحة', 'VALIDATION');
    try {
      const row = await inTx(async (c) => {
        const wh = await c.query(`SELECT id FROM warehouses WHERE id = $1 AND company_id = $2`, [warehouseId, companyId]);
        if (!wh.rows.length) throw new ZoneError('المستودع غير موجود', 'NOT_FOUND');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${warehouseId}:zone_code`]);
        const dup = await c.query(`SELECT 1 FROM warehouse_locations WHERE warehouse_id = $1 AND lower(name) = lower($2)`, [warehouseId, body.data.name]);
        if (dup.rows.length) throw new ZoneError('اسم العنبر مستخدم في هذا المستودع', 'VALIDATION');
        const n = await c.query(
          `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM warehouse_locations WHERE warehouse_id = $1 AND code ~ '^Z[0-9]+$'`,
          [warehouseId],
        );
        const code = `Z${String(n.rows[0].n).padStart(3, '0')}`;
        const ins = await c.query(
          `INSERT INTO warehouse_locations (company_id, warehouse_id, code, name) VALUES ($1,$2,$3,$4) RETURNING id, code, name, is_active`,
          [companyId, warehouseId, code, body.data.name],
        );
        return ins.rows[0];
      });
      return reply.status(201).send({ ok: true, data: row });
    } catch (e) {
      return mapErr(reply, e);
    }
  });
};
