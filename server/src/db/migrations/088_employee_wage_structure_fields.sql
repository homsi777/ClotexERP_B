-- TASK 016 (HR): بنية الأجر المستخرجة من ملفات المرتبات الفعلية، محفوظة لكل موظف:
--   base_share_percent : نسبة الأساسي من الأجر الشامل (صالة النسيج 75، الإدارة 80)
--   workday_hours      : ساعات يوم العمل لحساب أجر الساعة (صالة 8، إدارة 9)
-- عمودان اختياريان؛ NULL = غير محدد (يُعامَل 8 ساعات افتراضياً ولا يُحسب تقسيم). لا أثر على أي راتب قائم.
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS base_share_percent numeric(5,2);
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS workday_hours numeric(4,2);

ALTER TABLE payroll_employees DROP CONSTRAINT IF EXISTS payroll_employees_base_share_chk;
ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_base_share_chk
  CHECK (base_share_percent IS NULL OR (base_share_percent > 0 AND base_share_percent <= 100));
ALTER TABLE payroll_employees DROP CONSTRAINT IF EXISTS payroll_employees_workday_hours_chk;
ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_workday_hours_chk
  CHECK (workday_hours IS NULL OR (workday_hours >= 1 AND workday_hours <= 24));
