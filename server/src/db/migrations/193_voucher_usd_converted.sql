-- بند بشير (سعر الصرف الاختياري): عند إطفاء زر سعر الصرف يُسجَّل السند بعملته فقط،
-- دون معادل بالدولار (amount_usd = 0) ودون دخوله في إجماليات الدولار.
-- usd_converted = true للسندات القائمة كلها (لا تغيير في سلوكها).
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS usd_converted boolean NOT NULL DEFAULT true;
