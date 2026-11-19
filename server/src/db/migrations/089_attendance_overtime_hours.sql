-- TASK 018 (HR): ساعات الإضافي اليومية بفئات ورقة «الانتظام» (يدخلها HR يدوياً لكل يوم):
--   نهاري ×1.5 ، ليلي ×1.5 ، عطلة ×1 ، عطلة ×2 — وتُجمع شهرياً لحساب الإضافي بصيغة الملف.
-- أعمدة إضافية افتراضيها 0 على attendance_daily_records؛ لا تغيير على أي سجل قائم ولا أثر مالي مباشر.
ALTER TABLE attendance_daily_records
  ADD COLUMN IF NOT EXISTS ot_day_hours numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_night_hours numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_holiday1_hours numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_holiday2_hours numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE attendance_daily_records DROP CONSTRAINT IF EXISTS attendance_daily_records_ot_chk;
ALTER TABLE attendance_daily_records ADD CONSTRAINT attendance_daily_records_ot_chk CHECK (
  ot_day_hours BETWEEN 0 AND 24 AND ot_night_hours BETWEEN 0 AND 24
  AND ot_holiday1_hours BETWEEN 0 AND 24 AND ot_holiday2_hours BETWEEN 0 AND 24
);

-- بند راتب جديد: إضافي من الحضور (يعبّئه المحاسب ويحفظه بنفسه).
ALTER TABLE payroll_run_line_items DROP CONSTRAINT IF EXISTS payroll_run_line_items_kind_check;
ALTER TABLE payroll_run_line_items ADD CONSTRAINT payroll_run_line_items_kind_check CHECK (kind IN (
  'BONUS', 'TRANSPORT', 'ANNUAL_INCREASE', 'SALARY_ADJUSTMENT', 'SETTLEMENT_ADD',
  'PURCHASE_DEDUCTION', 'SETTLEMENT_DEDUCT',
  'ATTENDANCE_ABSENCE_DEDUCTION', 'ATTENDANCE_HALF_PAY_DEDUCTION',
  'OVERTIME', 'ATTENDANCE_OVERTIME'
));
