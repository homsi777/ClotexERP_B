-- TASK 015 (HR): بيانات تفعيل شريحة الإجازة 30 يوماً (عمر > 50 أو 10 سنوات تأمينات).
-- عمودان اختياريان على payroll_employees؛ لا تغيير على أي سجل قائم ولا أثر مالي.
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS insurance_start_date date;
