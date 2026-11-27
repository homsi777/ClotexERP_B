-- بيانات ترويسة/تذييل المطبوعات لكل فرع — مستقلة تماماً وتُحدَّد بمعرّف الفرع الثابت (لا باللغة ولا بالاسم).
-- لا تُستعار بيانات فرع لفرع آخر: النص الفارغ = لا يُعرض شيء.
-- مصر (احتياط لـ212 إن لم تُطبَّق على الاسم/الرمز).
UPDATE companies
   SET print_location = 'الجمهورية العربية المصرية / القاهرة', print_phone_invoice = '+201278518975', print_phone_voucher = '+201500231211'
 WHERE id = '523a8dde-e656-48fd-b968-7e8e7c5d7015'::uuid AND print_location IS NULL;
-- سوريا: القيم المعمول بها حالياً مثبَّتة صراحةً (كانت قيماً افتراضية في الكود).
UPDATE companies
   SET print_location = 'الجمهورية العربية السورية / حلب', print_phone_invoice = '09 44 555 080', print_phone_voucher = '+963 944 555 080'
 WHERE id = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea'::uuid AND print_location IS NULL;
-- تركيا: العنوان والهاتف غير متوفرين بعد — فارغان مؤقتاً إلى حين تزويدنا بهما.
UPDATE companies
   SET print_location = '', print_phone_invoice = '', print_phone_voucher = ''
 WHERE id = '0be9e5b8-070c-4566-8959-99c06ef9efb7'::uuid AND print_location IS NULL AND print_phone_invoice IS NULL AND print_phone_voucher IS NULL;
