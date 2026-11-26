-- N-0076..N-0080: تسعير بالكيلو، كتالوج بنود المشتريات المرجعي، المستودعات التشغيلية (للمواد فقط، منفصلة عن مستودعات الأقمشة)

-- 1) أساس تسعير سطر الإرسالية: METER (الافتراضي) أو KG
ALTER TABLE intake_dispatch_slip_lines ADD COLUMN IF NOT EXISTS price_basis text NOT NULL DEFAULT 'METER';
DO $$ BEGIN
  ALTER TABLE intake_dispatch_slip_lines ADD CONSTRAINT intake_dispatch_slip_lines_price_basis_chk CHECK (price_basis IN ('METER','KG'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) المستودعات التشغيلية
CREATE TABLE IF NOT EXISTS operating_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS operating_warehouses_company_name_uq ON operating_warehouses (company_id, lower(name));

-- 3) كتالوج بنود المشتريات (مرجع ثابت يمنع التكرار)
CREATE TABLE IF NOT EXISTS purchase_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  material_kind text NOT NULL CHECK (material_kind IN ('FABRIC','YARN','OTHER')),
  name text NOT NULL,
  default_unit text NOT NULL DEFAULT 'meter' CHECK (default_unit IN ('meter','yard','kg','package','piece')),
  design_code text,
  color_name text,
  color_code text,
  width_cm numeric(10,2),
  gsm numeric(10,2),
  operating_warehouse_id uuid REFERENCES operating_warehouses(id),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_catalog_items_uq ON purchase_catalog_items (company_id, material_kind, lower(name), lower(coalesce(design_code,'')), lower(coalesce(color_code,'')));

-- 4) رصيد وحركات المستودع التشغيلي
CREATE TABLE IF NOT EXISTS operating_stock (
  company_id uuid NOT NULL REFERENCES companies(id),
  warehouse_id uuid NOT NULL REFERENCES operating_warehouses(id),
  catalog_item_id uuid NOT NULL REFERENCES purchase_catalog_items(id),
  quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, catalog_item_id)
);

CREATE TABLE IF NOT EXISTS operating_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  warehouse_id uuid NOT NULL REFERENCES operating_warehouses(id),
  catalog_item_id uuid NOT NULL REFERENCES purchase_catalog_items(id),
  movement_type text NOT NULL CHECK (movement_type IN ('RECEIPT','CONSUMPTION','WASTE','GIFT','OTHER_OUT','ADJUST_IN')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  receipt_id uuid,
  notes text,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operating_stock_movements_wh_idx ON operating_stock_movements (company_id, warehouse_id, created_at DESC);

-- 5) ربط بند الفاتورة/الاستلام بالكتالوج
ALTER TABLE purchase_invoice_lines ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES purchase_catalog_items(id);
ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES purchase_catalog_items(id);
ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS operating_warehouse_id uuid REFERENCES operating_warehouses(id);

-- 6) استلام المواد التشغيلية لا يتطلب مستودع أقمشة
ALTER TABLE purchase_receipts ALTER COLUMN warehouse_id DROP NOT NULL;
ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS operating_warehouse_id uuid REFERENCES operating_warehouses(id);

-- 7) طريقة الدفع على فاتورة الشراء
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS payment_method text;
