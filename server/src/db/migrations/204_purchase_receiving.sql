-- ربط فواتير الشراء باستلام المخازن: فاتورة المورد مالية مرة واحدة، والاستلام حركة مخزنية مرتبطة بها بلا قيد مالي مكرر.
-- «استلام عبر المخزن»: الفاتورة المؤكدة لا تُنشئ أتواباً/دفعات خيط؛ يُنشئها المخزن عند الاستلام (كامل أو دفعات).
-- الفواتير القديمة (الافتراضي false) تبقى بسلوكها الحالي تماماً.
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS receive_via_warehouse boolean NOT NULL DEFAULT false;

-- وحدات إضافية للمواد غير القماش (طرد/قطعة) إلى جانب المتر والياردة والكيلو.
ALTER TABLE purchase_invoice_lines DROP CONSTRAINT IF EXISTS purchase_invoice_lines_unit_check;
ALTER TABLE purchase_invoice_lines ADD CONSTRAINT purchase_invoice_lines_unit_check CHECK (unit IN ('meter', 'yard', 'kg', 'package', 'piece'));
ALTER TABLE purchase_invoice_lines ADD COLUMN IF NOT EXISTS material_kind text CHECK (material_kind IN ('FABRIC', 'YARN', 'OTHER'));

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  receipt_no text NOT NULL,
  -- بلا فاتورة = استلام معلّق (وصلت البضاعة قبل فاتورتها): لا قيد مالي ولا قيمة افتراضية، ويُربط لاحقاً.
  invoice_id uuid REFERENCES purchase_invoices(id),
  supplier_id uuid REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PENDING_INVOICE', 'CANCELLED')),
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  linked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  linked_at timestamptz,
  UNIQUE (company_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_invoice ON purchase_receipts(company_id, invoice_id);

CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  invoice_line_id uuid REFERENCES purchase_invoice_lines(id),
  description text NOT NULL DEFAULT '',
  material_kind text NOT NULL CHECK (material_kind IN ('FABRIC', 'YARN', 'OTHER')),
  -- وحدة الاستلام الفعلية؛ إن خالفت وحدة الفاتورة يُسجَّل معامل التحويل المعتمد أو الكمية الفعلية بوضوح.
  unit text NOT NULL CHECK (unit IN ('meter', 'yard', 'kg', 'package', 'piece')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  -- الكمية بوحدة الفاتورة بعد التحويل (تُقارن بكمية البند)
  quantity_in_invoice_unit numeric(14,3) NOT NULL CHECK (quantity_in_invoice_unit >= 0),
  conversion_factor numeric(14,6),
  package_count numeric(14,3),
  location_id uuid REFERENCES warehouse_locations(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  roll_ids uuid[] NOT NULL DEFAULT '{}',
  yarn_lot_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines_inv ON purchase_receipt_lines(company_id, invoice_line_id);
