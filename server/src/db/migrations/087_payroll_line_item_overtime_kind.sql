-- TASK 015: نوع بند 'OVERTIME' (إضافي): الساعات × (الأجر الشامل ÷ 30 ÷ 8) × (1.5 أو 2).
-- توسيع قيد CHECK فقط؛ لا يغيّر أي سجل قائم.
ALTER TABLE payroll_run_line_items DROP CONSTRAINT IF EXISTS payroll_run_line_items_kind_check;
ALTER TABLE payroll_run_line_items ADD CONSTRAINT payroll_run_line_items_kind_check CHECK (kind IN (
  'BONUS', 'TRANSPORT', 'ANNUAL_INCREASE', 'SALARY_ADJUSTMENT', 'SETTLEMENT_ADD',
  'PURCHASE_DEDUCTION', 'SETTLEMENT_DEDUCT',
  'ATTENDANCE_ABSENCE_DEDUCTION', 'ATTENDANCE_HALF_PAY_DEDUCTION',
  'OVERTIME'
));
