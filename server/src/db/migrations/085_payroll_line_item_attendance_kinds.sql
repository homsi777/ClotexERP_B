-- TASK 014: نوعان جديدان لبنود الراتب يأتيان من حالات الحضور (يعبّئهما المحاسب ويحفظهما بنفسه):
--   ATTENDANCE_ABSENCE_DEDUCTION    خصم الغياب بدون إذن (أجر + جزاء)
--   ATTENDANCE_HALF_PAY_DEDUCTION   خصم نصف الأجر للإجازة المرضية/الزواج
-- تعديل قيد CHECK فقط (يوسّع القيم المسموحة)؛ لا يغيّر أي سجل قائم.
ALTER TABLE payroll_run_line_items DROP CONSTRAINT IF EXISTS payroll_run_line_items_kind_check;
ALTER TABLE payroll_run_line_items ADD CONSTRAINT payroll_run_line_items_kind_check CHECK (kind IN (
  'BONUS', 'TRANSPORT', 'ANNUAL_INCREASE', 'SALARY_ADJUSTMENT', 'SETTLEMENT_ADD',
  'PURCHASE_DEDUCTION', 'SETTLEMENT_DEDUCT',
  'ATTENDANCE_ABSENCE_DEDUCTION', 'ATTENDANCE_HALF_PAY_DEDUCTION'
));
