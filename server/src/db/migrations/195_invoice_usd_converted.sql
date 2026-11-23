-- سعر الصرف الاختياري (بشير N-0022): فاتورة بلا سعر صرف تبقى بعملتها (بلا معادل دولار)
-- وتُرحَّل إلى دفتر الأستاذ بعملتها. true للفواتير القائمة (لا تغيير في سلوكها).
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS usd_converted boolean NOT NULL DEFAULT true;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS usd_converted boolean NOT NULL DEFAULT true;
