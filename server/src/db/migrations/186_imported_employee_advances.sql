-- سلف تاريخية مستوردة من Excel (سلف أكتوبر + السلف المقسطة): المبلغ دُفع قبل دخول النظام،
-- فلا سند صرف ولا حركة صندوق تُنشأ. إضافية بحتة: السلف اليدوية الحالية لا تتغير (cashbox_id يبقى مطلوباً لها في التطبيق).
ALTER TABLE payroll_employee_advances ALTER COLUMN cashbox_id DROP NOT NULL;
ALTER TABLE payroll_employee_advances ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE payroll_employee_advances ADD COLUMN IF NOT EXISTS source_file text;
ALTER TABLE payroll_employee_advances ADD COLUMN IF NOT EXISTS name_in_file text;
ALTER TABLE payroll_employee_advances DROP CONSTRAINT IF EXISTS payroll_employee_advances_source_chk;
ALTER TABLE payroll_employee_advances
  ADD CONSTRAINT payroll_employee_advances_source_chk CHECK (source IN ('MANUAL', 'EXCEL_IMPORT'));
-- سلفة يدوية لا بد لها من صندوق؛ المستوردة فقط بلا صندوق.
ALTER TABLE payroll_employee_advances DROP CONSTRAINT IF EXISTS payroll_employee_advances_cashbox_chk;
ALTER TABLE payroll_employee_advances
  ADD CONSTRAINT payroll_employee_advances_cashbox_chk CHECK (cashbox_id IS NOT NULL OR source = 'EXCEL_IMPORT');

-- النوع (ذكر/أنثى) من عمود «النوع» بملفات المرتبات.
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE payroll_employees DROP CONSTRAINT IF EXISTS payroll_employees_gender_chk;
ALTER TABLE payroll_employees
  ADD CONSTRAINT payroll_employees_gender_chk CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE'));
