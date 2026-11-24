-- التكلفة الإدارية السرّية وتحليل الربحية (للمالك فقط).
-- منفصلة تماماً عن المحاسبة والذمم وتقييم المخزون الرسمي: لا قيود ولا حركات ولا تأثير على unit_cost للأتواب.
-- السجل append-only: تغيير التكلفة يضيف سطراً جديداً ولا يعدّل القديم؛ ولقطة البيع ثابتة لا تتغير بتغيّر التكلفة لاحقاً.
CREATE TABLE IF NOT EXISTS admin_cost_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('ITEM', 'ITEM_COLOR', 'ROLL')),
  item_id uuid REFERENCES fabric_items(id),
  color_id uuid REFERENCES fabric_colors(id),
  roll_id uuid REFERENCES fabric_rolls(id),
  unit_cost_per_meter numeric(18,4) NOT NULL CHECK (unit_cost_per_meter > 0),
  currency_code text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  set_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  CHECK ((scope = 'ITEM' AND item_id IS NOT NULL AND color_id IS NULL AND roll_id IS NULL)
      OR (scope = 'ITEM_COLOR' AND item_id IS NOT NULL AND color_id IS NOT NULL AND roll_id IS NULL)
      OR (scope = 'ROLL' AND roll_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_admin_cost_rates_lookup ON admin_cost_rates(company_id, scope, item_id, color_id, roll_id, effective_from DESC);

-- تفويض صريح من المالك بكشف التكلفة الإدارية والربحية لمستخدم بعينه.
CREATE TABLE IF NOT EXISTS admin_cost_delegates (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

-- لقطة التكلفة الإدارية السارية وقت اعتماد البيع (سطر بيع واحد = لقطة واحدة).
CREATE TABLE IF NOT EXISTS sales_line_admin_cost (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sales_invoice_line_id uuid PRIMARY KEY REFERENCES sales_invoice_lines(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  quantity_m numeric(14,3) NOT NULL,
  unit_cost_per_meter numeric(18,4) NOT NULL,
  currency_code text NOT NULL,
  total_cost numeric(18,2) NOT NULL,
  source text NOT NULL CHECK (source IN ('ROLL', 'ITEM_COLOR', 'ITEM')),
  rate_id uuid REFERENCES admin_cost_rates(id),
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_line_admin_cost_invoice ON sales_line_admin_cost(company_id, invoice_id);
