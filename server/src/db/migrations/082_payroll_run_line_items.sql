-- TASK 011 (بشير): بنود تفصيل سطر الراتب (مشتريات، مكافأة، تسويات ±، مواصلات،
-- زيادة سنوية، تعديل راتب مع السبب). إضافية بحتة: لا تعديل على payroll_run_lines.
-- مجموع هذه البنود يُضاف إلى allowances/deductions الحاليَّين فتبقى القيود المحاسبية
-- تقرأ نفس الإجماليات دون أي تغيير. تُحذف تلقائياً مع سطر الراتب (مسودة فقط).
-- ملاحظة ترتيب: الرقم 081 محجوز لمهمة قص التوب (فرع task-009)؛ الفجوة غير ضارة
-- لأن المُشغِّل يرتّب بالاسم ويتتبّع المُطبَّق.
CREATE TABLE IF NOT EXISTS payroll_run_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_run_line_id uuid NOT NULL REFERENCES payroll_run_lines(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'BONUS', 'TRANSPORT', 'ANNUAL_INCREASE', 'SALARY_ADJUSTMENT', 'SETTLEMENT_ADD',
    'PURCHASE_DEDUCTION', 'SETTLEMENT_DEDUCT'
  )),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  note text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_line_items_line
  ON payroll_run_line_items(payroll_run_line_id);
CREATE INDEX IF NOT EXISTS idx_payroll_run_line_items_company
  ON payroll_run_line_items(company_id);
