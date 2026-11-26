-- ملاحظة بشير: العملة الافتراضية بفرع مصر هي الجنيه (تسعير/شراء/بيع/مرتجع…) مع بقاء تغييرها ممكناً في النموذج.
-- تُضبط فقط إن لم يكن للفرع إعداد سابق؛ لا تمسّ أي فرع آخر ولا أي مستند قائم.
UPDATE companies
   SET default_currency_code = 'EGP'
 WHERE (code = 'مصر' OR name = 'فرع مصر')
   AND default_currency_code IS NULL
   AND EXISTS (SELECT 1 FROM currencies WHERE code = 'EGP');
