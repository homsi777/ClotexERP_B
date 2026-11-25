import type { Pool, PoolClient } from 'pg';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
/** نعتبر الجلسة منتهية إن لم يصل منها نشاط خلال هذه المدة (نفس مهلة الجلسات الحية). */
export const SESSION_IDLE_MS = 5 * 60 * 1000;

export interface SessionStart { companyId: string; userId: string; sessionKey: string; ip: string; userAgent: string; platform: string }

/** يسجّل بداية الجلسة أو يحدّث آخر نشاط لها (upsert بمفتاح الجلسة). */
export async function recordSessionActivity(db: Db, s: SessionStart): Promise<void> {
  await db.query(
    `INSERT INTO user_session_log (company_id, user_id, session_key, ip, user_agent, client_platform) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (company_id, session_key) DO UPDATE SET last_seen_at = now(), ip = EXCLUDED.ip
       WHERE user_session_log.ended_at IS NULL`,
    [s.companyId, s.userId, s.sessionKey, s.ip, s.userAgent.slice(0, 300), s.platform]);
}

export type EndReason = 'LOGOUT' | 'REVOKED' | 'BLOCKED' | 'DELETED';
export async function endSession(db: Db, companyId: string, sessionKey: string, reason: EndReason): Promise<void> {
  await db.query('UPDATE user_session_log SET ended_at = now(), end_reason = $3 WHERE company_id=$1 AND session_key=$2 AND ended_at IS NULL', [companyId, sessionKey, reason]);
}
export async function endUserSessions(db: Db, companyId: string, userId: string, reason: EndReason): Promise<void> {
  await db.query('UPDATE user_session_log SET ended_at = now(), end_reason = $3 WHERE company_id=$1 AND user_id=$2 AND ended_at IS NULL', [companyId, userId, reason]);
}

export interface SessionLogRow {
  id: string; userId: string; username: string; fullName: string | null; ip: string | null; platform: string | null;
  connectedAt: string; lastSeenAt: string; endedAt: string | null; endReason: string | null;
  /** المدة بالثواني: من الدخول حتى الخروج، أو حتى آخر نشاط إن انتهت بمهلة الخمول، أو حتى الآن إن كانت حية. */
  durationSec: number; live: boolean;
}

export async function listSessionLog(db: Db, companyId: string, opts: { userId?: string; from?: string; to?: string; limit?: number } = {}): Promise<SessionLogRow[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT l.id, l.user_id, u.username, u.full_name, l.ip, l.client_platform, l.connected_at, l.last_seen_at, l.ended_at, l.end_reason,
            (l.ended_at IS NULL AND l.last_seen_at > now() - make_interval(secs => $5::int)) AS live,
            EXTRACT(EPOCH FROM (COALESCE(l.ended_at, l.last_seen_at) - l.connected_at))::int AS dur
       FROM user_session_log l JOIN users u ON u.id = l.user_id
      WHERE l.company_id=$1 AND ($2::uuid IS NULL OR l.user_id=$2) AND ($3::date IS NULL OR l.connected_at >= $3::date) AND ($4::date IS NULL OR l.connected_at < $4::date + 1)
      ORDER BY l.connected_at DESC LIMIT ${Math.min(Math.max(opts.limit ?? 200, 1), 1000)}`,
    [companyId, opts.userId ?? null, opts.from ?? null, opts.to ?? null, SESSION_IDLE_MS / 1000])).rows;
  return rows.map((r) => {
    const live = Boolean(r.live);
    const ended = r.ended_at ? String(r.ended_at) : null;
    return {
      id: String(r.id), userId: String(r.user_id), username: String(r.username), fullName: (r.full_name as string | null) ?? null, ip: (r.ip as string | null) ?? null, platform: (r.client_platform as string | null) ?? null,
      connectedAt: String(r.connected_at), lastSeenAt: String(r.last_seen_at), endedAt: ended,
      // جلسة انتهت بمهلة الخمول بلا خروج صريح: سبب TIMEOUT محسوب لا مخزَّن
      endReason: ended ? (r.end_reason as string) : live ? null : 'TIMEOUT',
      durationSec: Math.max(0, Number(r.dur ?? 0)), live,
    };
  });
}

export interface PresenceRow { id: string; username: string; fullName: string | null; role: string; isActive: boolean; blocked: boolean; blockReason: string | null; deleted: boolean; online: boolean; lastLoginAt: string | null; lastSeenAt: string | null; sessionsInPeriod: number; secondsInPeriod: number }

/** كل المستخدمين (نشط/موقوف/محظور/محذوف) مع حالة الاتصال وإجمالي وقت الاستخدام في الفترة. */
export async function listPresence(db: Db, companyId: string, p: { from?: string; to?: string; includeDeleted?: boolean }): Promise<PresenceRow[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.blocked_at, u.block_reason, u.deleted_at,
            (SELECT max(connected_at) FROM user_session_log l WHERE l.company_id=u.company_id AND l.user_id=u.id) AS last_login,
            (SELECT max(last_seen_at) FROM user_session_log l WHERE l.company_id=u.company_id AND l.user_id=u.id) AS last_seen,
            EXISTS (SELECT 1 FROM user_session_log l WHERE l.company_id=u.company_id AND l.user_id=u.id AND l.ended_at IS NULL AND l.last_seen_at > now() - make_interval(secs => $4::int)) AS online,
            (SELECT count(*) FROM user_session_log l WHERE l.company_id=u.company_id AND l.user_id=u.id AND ($2::date IS NULL OR l.connected_at >= $2::date) AND ($3::date IS NULL OR l.connected_at < $3::date + 1)) AS n,
            (SELECT COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(l.ended_at, l.last_seen_at) - l.connected_at))),0) FROM user_session_log l WHERE l.company_id=u.company_id AND l.user_id=u.id AND ($2::date IS NULL OR l.connected_at >= $2::date) AND ($3::date IS NULL OR l.connected_at < $3::date + 1)) AS secs
       FROM users u WHERE u.company_id=$1 AND ($5 OR u.deleted_at IS NULL) ORDER BY u.deleted_at NULLS FIRST, u.created_at DESC`,
    [companyId, p.from ?? null, p.to ?? null, SESSION_IDLE_MS / 1000, p.includeDeleted === true])).rows;
  return rows.map((r) => ({
    id: String(r.id), username: String(r.username), fullName: (r.full_name as string | null) ?? null, role: String(r.role), isActive: Boolean(r.is_active),
    blocked: r.blocked_at != null, blockReason: (r.block_reason as string | null) ?? null, deleted: r.deleted_at != null,
    online: Boolean(r.online) && r.blocked_at == null && r.deleted_at == null,
    lastLoginAt: r.last_login ? String(r.last_login) : null, lastSeenAt: r.last_seen ? String(r.last_seen) : null,
    sessionsInPeriod: Number(r.n), secondsInPeriod: Math.round(Number(r.secs)),
  }));
}
