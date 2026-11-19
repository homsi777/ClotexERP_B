-- ملاحظة مدير بشير: العملة الافتراضية للمعاملات المالية لكل فرع (فرع مصر = الجنيه) مع السماح بتغييرها يدوياً.
-- عمود اختياري على companies (مثل default_language)؛ NULL = غير مضبوط ⇒ USD كما هو الحال اليوم لكل الفروع.
-- لا يُغيّر أي فرع قائم ولا أي معاملة ولا عملة الأساس المحاسبية (USD).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_currency_code text;

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_default_currency_code_chk;
ALTER TABLE companies ADD CONSTRAINT companies_default_currency_code_chk
  CHECK (default_currency_code IS NULL OR default_currency_code IN ('USD', 'EGP', 'TRY', 'SYP'));
