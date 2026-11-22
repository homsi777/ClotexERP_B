-- طلبات إذن التعديل: موظف بلا حق تعديل مباشر (عميل/فاتورة…) يطلب إذناً من مسؤوله، فإن وُوفق يعدّل مرة واحدة.
-- + ربط الموظف بمسؤوله (مركز الإعدادات). لا أثر على أي بيانات قائمة.
CREATE TABLE IF NOT EXISTS user_supervisors (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supervisor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_supervisors_not_self CHECK (user_id <> supervisor_id)
);
CREATE INDEX IF NOT EXISTS idx_user_supervisors_supervisor ON user_supervisors(company_id, supervisor_id);

CREATE TABLE IF NOT EXISTS edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('CUSTOMER', 'SUPPLIER', 'SALES_INVOICE', 'PURCHASE_INVOICE')),
  entity_id uuid NOT NULL,
  entity_label text NOT NULL DEFAULT '',
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- المسؤول المباشر وقت الطلب (null = لا مسؤول معيّن: يراه كل مدير/محاسب).
  supervisor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'USED', 'CANCELLED')),
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edit_requests_entity ON edit_requests(company_id, entity_type, entity_id, requested_by);
CREATE INDEX IF NOT EXISTS idx_edit_requests_pending ON edit_requests(company_id, status) WHERE status = 'PENDING';
