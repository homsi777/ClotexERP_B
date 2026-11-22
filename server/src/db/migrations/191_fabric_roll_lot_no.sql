-- اللوط (رقم دفعة التصنيع/الصباغة) لكل توب — منفصل عن batch_no (وسم الاستيراد) الذي تعتمد عليه فلاتر المشتريات.
-- إضافية بحتة: الأتواب القائمة تبقى بلا لوط (NULL).
ALTER TABLE fabric_rolls ADD COLUMN IF NOT EXISTS lot_no text;
CREATE INDEX IF NOT EXISTS idx_fabric_rolls_lot ON fabric_rolls(company_id, lot_no) WHERE lot_no IS NOT NULL;
