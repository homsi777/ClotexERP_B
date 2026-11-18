/**
 * TASK 011 (بشير) — تركيب الأجر الشامل والصافي، دالة صِرفة شفّافة بلا افتراضات
 * وبلا قاعدة بيانات. تجمع البنود كما عرّفها بشير (2026-11-18) فقط:
 *
 *   الأجر الشامل = الأجر الأساسي + الزيادات السنوية (استحقاق كل سنة)
 *                 + تعديل الراتب (لأي سبب: ترقية…) + بدل المواصلات + بدلات أخرى.
 *
 *   الأجر الصافي = الأجر الشامل + الاستحقاقات (إضافات) − الاستقطاعات (خصومات).
 *
 * الاستحقاقات (إضافات): الإضافي، المكافأة، تسويات موجبة، وأي إضافة أخرى.
 * الاستقطاعات (خصومات): خصم الغياب، خصومات المشتريات، تسويات سالبة، وأي خصم آخر.
 *
 * ملاحظة: قاعدة «70% راتب / 30% بدلات» لم تُعتمَد هنا لأنها تمسّ بنية الراتب
 * المخزّنة وتحتاج تثبيتاً نهائياً — تبقى خارج هذه الدالة حتى اعتمادها.
 */

export type ComprehensiveWageInput = {
  baseSalary: number;
  annualIncreases?: number;
  salaryAdjustment?: number;
  transportAllowance?: number;
  otherAllowances?: number;
};

export type NetWageInput = {
  comprehensiveWage: number;
  // استحقاقات (تُضاف)
  overtime?: number;
  bonus?: number;
  settlementsAdd?: number;
  otherAdditions?: number;
  // استقطاعات (تُخصم)
  absenceDeduction?: number;
  purchaseDeductions?: number;
  settlementsDeduct?: number;
  otherDeductions?: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function val(n: number | undefined): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export function computeComprehensiveWage(input: ComprehensiveWageInput): number {
  return round2(
    val(input.baseSalary) +
      val(input.annualIncreases) +
      val(input.salaryAdjustment) +
      val(input.transportAllowance) +
      val(input.otherAllowances),
  );
}

export type NetWageResult = {
  comprehensiveWage: number;
  totalAdditions: number;
  totalDeductions: number;
  netWage: number;
};

export function computeNetWage(input: NetWageInput): NetWageResult {
  const additions = round2(
    val(input.overtime) + val(input.bonus) + val(input.settlementsAdd) + val(input.otherAdditions),
  );
  const deductions = round2(
    val(input.absenceDeduction) +
      val(input.purchaseDeductions) +
      val(input.settlementsDeduct) +
      val(input.otherDeductions),
  );
  const comprehensive = round2(val(input.comprehensiveWage));
  return {
    comprehensiveWage: comprehensive,
    totalAdditions: additions,
    totalDeductions: deductions,
    netWage: round2(comprehensive + additions - deductions),
  };
}
