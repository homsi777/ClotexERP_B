-- N-0034 (بشير): تقييد المستخدم بمستودعات معيّنة داخل فرعه.
-- لا صفوف = بلا تقييد (السلوك الحالي لكل المستخدمين). صفوف = لا يرى ولا ينفّذ إلا على هذه المستودعات.
CREATE TABLE IF NOT EXISTS user_warehouses (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_user_warehouses_user ON user_warehouses(user_id);
