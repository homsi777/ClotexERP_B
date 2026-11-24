import type { Pool, PoolClient } from 'pg';
import { getBranchMetrics, resolvePeriod, type BranchMetrics, type Period, type PeriodKind } from './managementMetricsService.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export interface BranchOverview {
  id: string; code: string; name: string; isActive: boolean;
  metrics: BranchMetrics;
  lastActivityAt: string | null;
  users: { custom: number };
}
export interface ActivityRow { at: string; branch: string | null; username: string; action: string; entity_type: string | null }
export interface PlatformOverview { generatedAt: string; period: Period; branches: BranchOverview[]; recentActivity: ActivityRow[] }

export function periodFromQuery(q: Record<string, string | undefined>): Period {
  const kind = (['today', 'yesterday', 'week', 'month', 'year', 'custom'] as const).find((k) => k === q.period) ?? 'month';
  return resolvePeriod(kind as PeriodKind, { from: q.from, to: q.to });
}

async function branchOf(db: Db, c: { id: string; code: string; name: string; is_active: boolean }, period: Period): Promise<BranchOverview> {
  const metrics = await getBranchMetrics(db, c.id, period);
  const last = (await db.query<{ t: string | null }>('SELECT max(created_at)::text AS t FROM audit_logs WHERE company_id=$1', [c.id])).rows[0];
  const custom = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM users WHERE company_id=$1 AND is_active AND perm_mode='CUSTOM'`, [c.id])).rows[0];
  return { id: c.id, code: c.code, name: c.name, isActive: c.is_active, metrics, lastActivityAt: last.t, users: { custom: Number(custom.n) } };
}

/** لوحة المالك: كل الفروع (قراءة فقط). المبالغ لكل عملة على حدة دون تحويل أو جمع بين عملتين. */
export async function getPlatformOverview(db: Db, period: Period): Promise<PlatformOverview> {
  const companies = await db.query<{ id: string; code: string; name: string; is_active: boolean }>('SELECT id, code, name, is_active FROM companies ORDER BY code');
  const branches: BranchOverview[] = [];
  for (const c of companies.rows) branches.push(await branchOf(db, c, period));
  const recent = await db.query<ActivityRow>(
    `SELECT a.created_at::text AS at, c.name AS branch, COALESCE(u.username,'—') AS username, a.action, a.entity_type
       FROM audit_logs a LEFT JOIN companies c ON c.id=a.company_id LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 25`);
  return { generatedAt: new Date().toISOString(), period, branches, recentActivity: recent.rows };
}

/** لوحة إدارة فرع واحد (لمدير الفرع) — بياناته وحده، ولا تكشف فرعاً آخر. */
export async function getBranchOverview(db: Db, companyId: string, period: Period): Promise<PlatformOverview> {
  const c = (await db.query<{ id: string; code: string; name: string; is_active: boolean }>('SELECT id, code, name, is_active FROM companies WHERE id=$1', [companyId])).rows[0];
  const recent = await db.query<ActivityRow>(
    `SELECT a.created_at::text AS at, c.name AS branch, COALESCE(u.username,'—') AS username, a.action, a.entity_type
       FROM audit_logs a LEFT JOIN companies c ON c.id=a.company_id LEFT JOIN users u ON u.id=a.user_id WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT 25`, [companyId]);
  return { generatedAt: new Date().toISOString(), period, branches: c ? [await branchOf(db, c, period)] : [], recentActivity: recent.rows };
}
