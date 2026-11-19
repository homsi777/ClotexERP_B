-- عهدة الكارتيلات: تسليم/إرجاع نسخ الكارتيلات للعملاء بالباركود. حركات هذه الجداول لا تؤثر على
-- الرصيد المالي للعميل ولا على مخزون الأقمشة (لا مفاتيح إلى الفواتير/الحسابات/المخزون).
--
-- cartela_copies: نسخة فعلية واحدة من الكارتيلة بباركود فريد على مستوى الشركة. يُستخدم باركود الموديل/اللون
-- الحالي مباشرة إن لم تُسجَّل به نسخة من قبل، وإلا يُولَّد باركود مستقل للنسخة.
CREATE TABLE IF NOT EXISTS cartela_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cartela_label_id uuid NOT NULL REFERENCES cartela_labels(id) ON DELETE CASCADE,
  color_id uuid REFERENCES cartela_label_colors(id) ON DELETE SET NULL,
  barcode text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cartela_copies_company_barcode UNIQUE (company_id, barcode),
  CONSTRAINT cartela_copies_barcode_chk CHECK (char_length(trim(barcode)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_cartela_copies_label ON cartela_copies(company_id, cartela_label_id);

-- سند تسليم مرقّم (قابل للطباعة) لعميل واحد.
CREATE TABLE IF NOT EXISTS cartela_custody_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_no text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  delivery_date date NOT NULL,
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cartela_custody_vouchers_company_no UNIQUE (company_id, voucher_no)
);
CREATE INDEX IF NOT EXISTS idx_cartela_custody_vouchers_customer
  ON cartela_custody_vouchers(company_id, customer_id, delivery_date DESC);

-- سطر = نسخة بعهدة العميل بموعد إرجاع اختياري؛ returned_on يُملأ عند الإرجاع الفعلي.
CREATE TABLE IF NOT EXISTS cartela_custody_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES cartela_custody_vouchers(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  copy_id uuid NOT NULL REFERENCES cartela_copies(id),
  due_date date,
  returned_on date,
  returned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- نسخة واحدة فقط مفتوحة بعهدة أي عميل في أي وقت (تمنع التسليم المكرر والمتزامن).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cartela_custody_open_copy
  ON cartela_custody_lines(copy_id) WHERE returned_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_cartela_custody_lines_customer
  ON cartela_custody_lines(company_id, customer_id, returned_on);
CREATE INDEX IF NOT EXISTS idx_cartela_custody_lines_voucher ON cartela_custody_lines(voucher_id);

-- سجل تعديل مواعيد الإرجاع: الموعد السابق والجديد وتاريخ التعديل.
CREATE TABLE IF NOT EXISTS cartela_custody_due_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES cartela_custody_lines(id) ON DELETE CASCADE,
  old_due_date date,
  new_due_date date NOT NULL,
  reason text,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cartela_custody_due_changes_line ON cartela_custody_due_changes(line_id);
