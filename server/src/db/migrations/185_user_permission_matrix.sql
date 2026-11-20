-- صلاحيات تفصيلية لكل مستخدم (مصفوفة وحدة × إجراء).
-- perm_mode = 'ROLE' (الافتراضي): يسلك المستخدم حسب دوره كما كان. 'CUSTOM': تُحصر صلاحياته بالمصفوفة المخزّنة فقط.
ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_mode text NOT NULL DEFAULT 'ROLE' CHECK (perm_mode IN ('ROLE', 'CUSTOM'));

CREATE TABLE IF NOT EXISTS user_permission_grants (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  permission_code text NOT NULL,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_code)
);

CREATE TABLE IF NOT EXISTS user_permission_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  mode text NOT NULL,
  granted_count integer NOT NULL,
  added text[] NOT NULL DEFAULT '{}',
  removed text[] NOT NULL DEFAULT '{}',
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_permission_audit_user ON user_permission_audit(user_id, changed_at DESC);
