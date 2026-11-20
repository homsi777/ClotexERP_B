-- تحويل اختياري بسعر الصرف على السند (معطّل افتراضياً): المبلغ الأصلي يبقى كما هو بعملته،
-- ويُحفظ مكافئه بعملة أخرى وسعر التحويل للعرض بالسند وكشف الحساب. لا يغيّر أرصدة الحسابات.
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS convert_to_currency_code text,
  ADD COLUMN IF NOT EXISTS convert_rate numeric(18,6) CHECK (convert_rate IS NULL OR convert_rate > 0),
  ADD COLUMN IF NOT EXISTS converted_amount numeric(18,2) CHECK (converted_amount IS NULL OR converted_amount >= 0);
