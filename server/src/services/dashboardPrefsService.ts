import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export type PrefScope = 'owner' | 'branch';

/** تخصيص عرض اللوحة لكل مستخدم: إخفاء/ترتيب/تبويب وفترة افتراضيان. للعرض فقط ولا يغيّر أي صلاحية. */
const schema = z.object({
  hidden: z.array(z.string().max(60)).max(200).default([]),
  order: z.array(z.string().max(60)).max(200).default([]),
  defaultTab: z.string().max(40).optional(),
  defaultPeriod: z.enum(['today', 'yesterday', 'week', 'month', 'year']).optional(),
}).strict();
export type DashboardPrefs = z.infer<typeof schema>;
export const parsePrefs = (body: unknown): DashboardPrefs | null => { const r = schema.safeParse(body); return r.success ? r.data : null; };

export async function getPrefs(db: Db, userId: string, scope: PrefScope): Promise<DashboardPrefs | null> {
  const r = (await db.query<{ prefs: unknown }>('SELECT prefs FROM dashboard_preferences WHERE user_id=$1 AND scope=$2', [userId, scope])).rows[0];
  return r ? parsePrefs(r.prefs) : null;
}
export async function savePrefs(db: Db, userId: string, scope: PrefScope, prefs: DashboardPrefs): Promise<void> {
  await db.query(`INSERT INTO dashboard_preferences (user_id, scope, prefs, updated_at) VALUES ($1,$2,$3::jsonb,now())
                  ON CONFLICT (user_id, scope) DO UPDATE SET prefs=EXCLUDED.prefs, updated_at=now()`, [userId, scope, JSON.stringify(prefs)]);
}
export async function resetPrefs(db: Db, userId: string, scope: PrefScope): Promise<void> {
  await db.query('DELETE FROM dashboard_preferences WHERE user_id=$1 AND scope=$2', [userId, scope]);
}
