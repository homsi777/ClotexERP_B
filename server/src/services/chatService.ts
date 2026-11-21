import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export const ROOM = 'room';

export interface ChatMessage {
  id: number;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  body: string;
  createdAt: string;
}

export interface ChatPeerSummary {
  key: string; // 'room' أو معرّف المستخدم
  name: string;
  kind: 'room' | 'user';
  role?: string;
  unread: number;
  lastMessage: string | null;
  lastAt: string | null;
  lastId: number;
}

function fail(message: string, code = 'VALIDATION'): never {
  throw Object.assign(new Error(message), { code });
}

const rowToMessage = (r: {
  id: string;
  sender_id: string;
  sender_name: string | null;
  recipient_id: string | null;
  body: string;
  created_at: Date;
}): ChatMessage => ({
  id: Number(r.id),
  senderId: r.sender_id,
  senderName: r.sender_name ?? '',
  recipientId: r.recipient_id,
  body: r.body,
  createdAt: r.created_at.toISOString(),
});

/** يتأكد أن الطرف الآخر مستخدم فعّال بنفس الفرع وليس المرسل نفسه. */
async function assertPeer(db: Db, companyId: string, userId: string, peerKey: string): Promise<string | null> {
  if (peerKey === ROOM) return null;
  if (peerKey === userId) fail('لا يمكن مراسلة النفس');
  const r = await db.query(`SELECT 1 FROM users WHERE id = $1 AND company_id = $2 AND is_active = true`, [peerKey, companyId]);
  if (!r.rows.length) fail('المستخدم غير موجود في هذا الفرع', 'NOT_FOUND');
  return peerKey;
}

/** قائمة المحادثات: غرفة الفرع + كل مستخدم فعّال آخر، مع غير المقروء وآخر رسالة. */
export async function listPeers(db: Db, companyId: string, userId: string): Promise<ChatPeerSummary[]> {
  const users = await db.query<{ id: string; name: string; role: string }>(
    `SELECT id, COALESCE(NULLIF(btrim(full_name), ''), username) AS name, role
     FROM users WHERE company_id = $1 AND is_active = true AND id <> $2 ORDER BY name`,
    [companyId, userId],
  );
  const reads = await db.query<{ peer_key: string; last_read_id: string }>(
    `SELECT peer_key, last_read_id FROM chat_reads WHERE user_id = $1`,
    [userId],
  );
  const readMap = new Map(reads.rows.map((r) => [r.peer_key, Number(r.last_read_id)]));

  const room = await db.query<{ unread: string; last_id: string | null; body: string | null; created_at: Date | null }>(
    `SELECT
       (SELECT count(*) FROM chat_messages WHERE company_id = $1 AND recipient_id IS NULL AND sender_id <> $2 AND id > $3) AS unread,
       l.id AS last_id, l.body, l.created_at
     FROM (SELECT 1) x
     LEFT JOIN LATERAL (SELECT id, body, created_at FROM chat_messages WHERE company_id = $1 AND recipient_id IS NULL ORDER BY id DESC LIMIT 1) l ON true`,
    [companyId, userId, readMap.get(ROOM) ?? 0],
  );
  const out: ChatPeerSummary[] = [
    {
      key: ROOM,
      name: 'كل الفرع',
      kind: 'room',
      unread: Number(room.rows[0]?.unread ?? 0),
      lastMessage: room.rows[0]?.body ?? null,
      lastAt: room.rows[0]?.created_at?.toISOString() ?? null,
      lastId: Number(room.rows[0]?.last_id ?? 0),
    },
  ];

  const dms = await db.query<{ peer: string; unread: string; last_id: string; body: string; created_at: Date }>(
    `WITH mine AS (
       SELECT id, body, created_at, sender_id, CASE WHEN sender_id = $2 THEN recipient_id ELSE sender_id END AS peer
       FROM chat_messages
       WHERE company_id = $1 AND recipient_id IS NOT NULL AND (sender_id = $2 OR recipient_id = $2)
     )
     SELECT peer::text, count(*) FILTER (WHERE sender_id <> $2 AND id > COALESCE((SELECT last_read_id FROM chat_reads WHERE user_id = $2 AND peer_key = peer::text), 0)) AS unread,
            max(id) AS last_id,
            (array_agg(body ORDER BY id DESC))[1] AS body,
            (array_agg(created_at ORDER BY id DESC))[1] AS created_at
     FROM mine GROUP BY peer`,
    [companyId, userId],
  );
  const dmMap = new Map(dms.rows.map((r) => [r.peer, r]));
  for (const u of users.rows) {
    const d = dmMap.get(u.id);
    out.push({
      key: u.id,
      name: u.name,
      kind: 'user',
      role: u.role,
      unread: Number(d?.unread ?? 0),
      lastMessage: d?.body ?? null,
      lastAt: d?.created_at?.toISOString() ?? null,
      lastId: Number(d?.last_id ?? 0),
    });
  }
  return out;
}

/** رسائل محادثة: الأحدث آخراً. after = آخر معرّف وصل للعميل (استعلام تدرّجي). */
export async function listMessages(
  db: Db,
  companyId: string,
  userId: string,
  peerKey: string,
  opts: { afterId?: number; limit?: number } = {},
): Promise<ChatMessage[]> {
  const peer = await assertPeer(db, companyId, userId, peerKey);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const after = Math.max(opts.afterId ?? 0, 0);
  const rows = await db.query(
    `SELECT * FROM (
       SELECT m.id, m.sender_id, COALESCE(NULLIF(btrim(u.full_name), ''), u.username) AS sender_name, m.recipient_id, m.body, m.created_at
       FROM chat_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.company_id = $1 AND m.id > $4 AND (
         ($3::uuid IS NULL AND m.recipient_id IS NULL)
         OR ($3::uuid IS NOT NULL AND m.recipient_id IS NOT NULL AND (
              (m.sender_id = $2 AND m.recipient_id = $3) OR (m.sender_id = $3 AND m.recipient_id = $2)))
       )
       ORDER BY m.id DESC LIMIT $5
     ) t ORDER BY id ASC`,
    [companyId, userId, peer, after, limit],
  );
  return rows.rows.map(rowToMessage);
}

export async function sendMessage(db: Db, companyId: string, userId: string, peerKey: string, body: string): Promise<ChatMessage> {
  const text = String(body ?? '').trim();
  if (!text) fail('الرسالة فارغة');
  if (text.length > 2000) fail('الرسالة أطول من 2000 حرف');
  const peer = await assertPeer(db, companyId, userId, peerKey);
  const ins = await db.query<{ id: string }>(
    `INSERT INTO chat_messages (company_id, sender_id, recipient_id, body) VALUES ($1,$2,$3,$4) RETURNING id`,
    [companyId, userId, peer, text],
  );
  // ما أرسلتَه تعتبره مقروءاً عندك.
  await markRead(db, companyId, userId, peerKey, Number(ins.rows[0].id));
  const m = await db.query(
    `SELECT m.id, m.sender_id, COALESCE(NULLIF(btrim(u.full_name), ''), u.username) AS sender_name, m.recipient_id, m.body, m.created_at
     FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
    [ins.rows[0].id],
  );
  return rowToMessage(m.rows[0]);
}

/** يعلّم المحادثة مقروءة حتى أحدث رسالة (أو حتى upToId إن مُرّر). */
export async function markRead(db: Db, companyId: string, userId: string, peerKey: string, upToId?: number): Promise<void> {
  const peer = await assertPeer(db, companyId, userId, peerKey);
  let last = upToId ?? 0;
  if (upToId == null) {
    const r = peer
      ? await db.query<{ m: string | null }>(
          `SELECT max(id) AS m FROM chat_messages WHERE company_id = $1 AND recipient_id = $2 AND sender_id = $3`,
          [companyId, userId, peer],
        )
      : await db.query<{ m: string | null }>(`SELECT max(id) AS m FROM chat_messages WHERE company_id = $1 AND recipient_id IS NULL`, [companyId]);
    last = Number(r.rows[0]?.m ?? 0);
  }
  await db.query(
    `INSERT INTO chat_reads (user_id, company_id, peer_key, last_read_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, peer_key) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id), updated_at = now()`,
    [userId, companyId, peerKey, last],
  );
}
