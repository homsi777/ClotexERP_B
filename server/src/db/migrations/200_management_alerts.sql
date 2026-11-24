-- مركز التنبيهات الإداري: حالة كل تنبيه (مفتاح فريد = لا تكرار) وعتبات التنبيه لكل فرع.
-- التنبيهات نفسها تُحسب حيّةً من بيانات النظام؛ هنا تُحفظ حالتها (إقرار/تأجيل/إسناد/محلول) فقط.
CREATE TABLE IF NOT EXISTS alert_states (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alert_key text NOT NULL,
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
  title text NOT NULL,
  detail text,
  href text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED')),
  assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  snoozed_until date,
  note text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, alert_key)
);
CREATE INDEX IF NOT EXISTS idx_alert_states_status ON alert_states(company_id, status);

CREATE TABLE IF NOT EXISTS alert_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  inactive_customer_days integer NOT NULL DEFAULT 60 CHECK (inactive_customer_days BETWEEN 7 AND 730),
  slow_stock_days integer NOT NULL DEFAULT 90 CHECK (slow_stock_days BETWEEN 7 AND 730),
  external_late_days integer NOT NULL DEFAULT 30 CHECK (external_late_days BETWEEN 3 AND 365),
  draft_age_days integer NOT NULL DEFAULT 3 CHECK (draft_age_days BETWEEN 1 AND 60),
  cheque_due_soon_days integer NOT NULL DEFAULT 7 CHECK (cheque_due_soon_days BETWEEN 1 AND 60),
  disabled_types text[] NOT NULL DEFAULT '{}',
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
