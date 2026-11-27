-- الهوية البصرية: بيانات ترويسة/تذييل المطبوعات لكل فرع (العنوان والهاتف) — تبقى لكل فرع بياناته
ALTER TABLE companies ADD COLUMN IF NOT EXISTS print_location text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS print_phone_invoice text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS print_phone_voucher text;
-- فرع مصر (من التصاميم المعتمدة)؛ الفروع الأخرى تبقى فارغة فتستخدم القيم الافتراضية الحالية
UPDATE companies SET print_location = 'الجمهورية العربية المصرية / القاهرة', print_phone_invoice = '+201278518975', print_phone_voucher = '+201500231211'
 WHERE (code = 'مصر' OR name = 'فرع مصر') AND print_location IS NULL;
