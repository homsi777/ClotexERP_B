-- TASK 009 (بشير): قص التوب والبيع المباشر.
-- لا محرك مخزون/بيع جديد: القص = بيع جزئي على التوب الأصلي عبر محرك البيع
-- الحالي (يخصم المتر مرة واحدة ويُبقي باركود الأصل)، مع:
--  (1) سجل قص لكل عملية (fabric_roll_cuts) لإعادة الطباعة والتتبّع،
--  (2) "قطعة مقصوصة" كسطر توب جديد بباركود جديد بحالة SOLD (خارج المخزون
--      المتاح) مربوطة بالفاتورة — للستيكر والتتبّع فقط، لا تُحسب رصيداً.

-- عمود يربط القطعة المقصوصة بالتوب الأصلي الذي قُصّت منه (NULL لكل الأتواب العادية).
ALTER TABLE fabric_rolls
  ADD COLUMN IF NOT EXISTS cut_from_roll_id uuid REFERENCES fabric_rolls(id);

CREATE INDEX IF NOT EXISTS idx_fabric_rolls_cut_from
  ON fabric_rolls(cut_from_roll_id) WHERE cut_from_roll_id IS NOT NULL;

-- نوع حركة مخزون جديد للقطعة المقصوصة (إنشاء سطر مقصوص مباع).
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN (
  'OPENING','PURCHASE_RECEIPT','MANUAL_CREATE',
  'TRANSFER_OUT','TRANSFER_IN',
  'RESERVE','RELEASE_RESERVATION',
  'SALE','RETURN',
  'ADJUSTMENT','DAMAGE','STATUS_CHANGE',
  'EXTERNAL_JOB_SENT','EXTERNAL_JOB_RETURNED',
  'CUT'
));

CREATE TABLE IF NOT EXISTS fabric_roll_cuts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  original_roll_id     uuid        NOT NULL REFERENCES fabric_rolls(id),
  cut_piece_roll_id    uuid        NOT NULL REFERENCES fabric_rolls(id),
  sales_invoice_id     uuid        NOT NULL REFERENCES sales_invoices(id),
  sales_invoice_no     text        NOT NULL,
  customer_id          uuid        REFERENCES customers(id),
  original_barcode     text        NOT NULL,
  cut_barcode          text        NOT NULL,
  cut_length_m         numeric(14,3) NOT NULL CHECK (cut_length_m > 0),
  original_length_before_m numeric(14,3) NOT NULL,
  original_length_after_m  numeric(14,3) NOT NULL,
  notes                text,
  created_by_user_id   uuid        REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- منع تكرار تسجيل/تنفيذ القص لنفس الفاتورة (ضمان "خصم مرة واحدة فقط").
  CONSTRAINT uq_roll_cut_per_invoice UNIQUE (company_id, sales_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_fabric_roll_cuts_company_date
  ON fabric_roll_cuts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fabric_roll_cuts_original
  ON fabric_roll_cuts(original_roll_id);
