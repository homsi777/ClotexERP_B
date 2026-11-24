-- لوحة الإدارة v2: تسعير إداري بالكيلو، تفعيل التنبيهات الاختيارية لكل فرع، وتخصيص اللوحة لكل مستخدم.
ALTER TABLE admin_cost_rates ADD COLUMN IF NOT EXISTS unit_basis text NOT NULL DEFAULT 'METER' CHECK (unit_basis IN ('METER', 'KG'));
ALTER TABLE sales_line_admin_cost ADD COLUMN IF NOT EXISTS unit_basis text NOT NULL DEFAULT 'METER' CHECK (unit_basis IN ('METER', 'KG'));
ALTER TABLE sales_line_admin_cost ADD COLUMN IF NOT EXISTS basis_quantity numeric(14,3);

-- تنبيهات اختيارية (مثل «أتواب بلا موقع») تبقى مطفأة حتى يفعّلها الفرع صراحةً.
ALTER TABLE alert_settings ADD COLUMN IF NOT EXISTS enabled_optional_types text[] NOT NULL DEFAULT '{}';

-- تخصيص العرض (إظهار/إخفاء/ترتيب/تبويب وفترة افتراضيين) لكل مستخدم ولكل لوحة؛ لا علاقة له بالصلاحيات.
CREATE TABLE IF NOT EXISTS dashboard_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('owner', 'branch')),
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);
