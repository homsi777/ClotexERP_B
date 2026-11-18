/**
 * TASK 011 (بشير) — تقسيم الأجر الشامل: 70% أساسي + 30% بدلات.
 * المبلغ المُدخل هو الأجر الشامل المتفق عليه؛ البدلات محسوبة ضمنه ولا تُضاف فوقه
 * (إضافتها مرة ثانية تكرّر احتسابها). أجر اليوم للخصومات = الشامل ÷ 30.
 */
export const BASE_SHARE = 0.7;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function splitComprehensiveWage(comprehensive: number): {
  comprehensive: number;
  base: number;
  allowances: number;
} {
  const total = round2(Number(comprehensive));
  if (!Number.isFinite(total) || total <= 0) return { comprehensive: 0, base: 0, allowances: 0 };
  const base = round2(total * BASE_SHARE);
  // البدلات = الباقي حتى لا يضيع هللة بالتقريب، فيبقى base + allowances = الشامل دائماً.
  const allowances = round2(total - base);
  return { comprehensive: total, base, allowances };
}
