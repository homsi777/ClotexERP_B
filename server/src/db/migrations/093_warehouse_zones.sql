-- إدارة العنابر داخل المستودع: العنبر = warehouse_locations الموجودة، وموقع التوب = fabric_rolls.location_id
-- (NULL = «غير محدد»). هذه الهجرة تضيف خيار التفعيل لكل مستودع (معطّل افتراضياً) ونوع حركة «تغيير الموقع».
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS zones_enabled boolean NOT NULL DEFAULT false;

-- حركة تغيير موقع داخل المستودع: delta=0، لا تمس الأمتار ولا الحالة ولا التكلفة.
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN (
  'OPENING','PURCHASE_RECEIPT','MANUAL_CREATE',
  'TRANSFER_OUT','TRANSFER_IN',
  'RESERVE','RELEASE_RESERVATION',
  'SALE','RETURN',
  'ADJUSTMENT','DAMAGE','STATUS_CHANGE',
  'EXTERNAL_JOB_SENT','EXTERNAL_JOB_RETURNED',
  'CUT',
  'LOCATION_MOVE'
));

-- تسريع قائمة «بانتظار تحديد العنبر» (أتواب بلا موقع).
CREATE INDEX IF NOT EXISTS idx_rolls_unassigned
  ON fabric_rolls(company_id, warehouse_id) WHERE location_id IS NULL;
