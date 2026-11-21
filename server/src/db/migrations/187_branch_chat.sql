-- دردشة بين مستخدمي الفرع الواحد: غرفة عامة للفرع (recipient_id NULL) + محادثات فردية.
-- كل شيء مقيَّد بـ company_id (الفرع) — لا يرى أحد رسائل فرع آخر.
CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_not_self CHECK (recipient_id IS NULL OR recipient_id <> sender_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(company_id, id) WHERE recipient_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_dm ON chat_messages(company_id, sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON chat_messages(company_id, recipient_id, id);

-- آخر رسالة مقروءة لكل مستخدم في كل محادثة: peer_key = 'room' أو معرّف المستخدم الآخر.
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  peer_key text NOT NULL,
  last_read_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, peer_key)
);
