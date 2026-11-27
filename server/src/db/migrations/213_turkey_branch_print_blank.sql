-- فرع تركيا: بيانات العنوان/الهاتف غير متوفرة بعد — تُترك فارغة (نص فارغ = لا تعرض، بدل الرجوع لقيم فرع سوريا)
UPDATE companies
   SET print_location = '', print_phone_invoice = '', print_phone_voucher = ''
 WHERE default_language = 'tr' AND print_location IS NULL AND print_phone_invoice IS NULL AND print_phone_voucher IS NULL;
