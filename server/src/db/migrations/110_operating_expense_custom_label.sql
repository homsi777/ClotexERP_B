-- ملاحظة بشير: تسمية خاصة اختيارية للمصروف (نص حر؛ لا تؤثر على التصنيف المحاسبي ولا القيود).
ALTER TABLE operating_expenses ADD COLUMN IF NOT EXISTS custom_label text;
