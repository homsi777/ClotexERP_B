-- حظر المستخدم وحذفه (حذف منطقي يحفظ التاريخ) وسجل جلسات الدخول والخروج.
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- اسم المستخدم المحذوف يمكن إعادة استخدامه؛ الفريد يسري على غير المحذوفين فقط.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_live_uq ON users (username) WHERE deleted_at IS NULL;

-- سجل الجلسات: وقت الدخول وآخر نشاط ووقت الخروج وسببه، والمدة تُحسب منهما.
CREATE TABLE IF NOT EXISTS user_session_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  ip text,
  user_agent text,
  client_platform text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('LOGOUT', 'REVOKED', 'BLOCKED', 'DELETED')),
  UNIQUE (company_id, session_key)
);
CREATE INDEX IF NOT EXISTS idx_user_session_log_user ON user_session_log (company_id, user_id, connected_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_session_log_time ON user_session_log (company_id, connected_at DESC);
