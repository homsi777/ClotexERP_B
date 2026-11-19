/**
 * TASK 016 (HR) — تقسيم الأجر الشامل إلى أساسي + حوافز، مستخرج من صيغ ملفات المرتبات:
 *   صالة النسيج: الحوافز = الشامل × 25%،  الأساسي = الباقي (75/25).
 *   الإدارة:     الأساسي = الشامل ÷ 1.25 (= 80%)، الحوافز = الباقي (80/20).
 *   الحوافز تنقسم دائماً: 35% حافز انتظام + 65% حافز جودة.
 * المبلغ المُدخل هو الأجر الشامل؛ البدلات/الحوافز محسوبة ضمنه ولا تُضاف فوقه. أجر اليوم = الشامل ÷ 30.
 * نسبة الأساسي تختلف بالمجموعة، لذلك تُحفظ لكل موظف (payroll_employees.base_share_percent).
 */
export const REGULARITY_SHARE = 0.35;
export const QUALITY_SHARE = 0.65;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function splitComprehensiveWage(
  comprehensive: number,
  baseSharePercent: number,
): { comprehensive: number; base: number; allowances: number } {
  const total = round2(Number(comprehensive));
  const pct = Number(baseSharePercent);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return { comprehensive: 0, base: 0, allowances: 0 };
  }
  const base = round2(total * (pct / 100));
  // الحوافز/البدلات = الباقي حتى يبقى base + allowances = الشامل دائماً بلا ضياع هللة.
  const allowances = round2(total - base);
  return { comprehensive: total, base, allowances };
}

/** تقسيم الحوافز: 35% انتظام / 65% جودة (الجودة = الباقي لتبقى المجموع صحيحاً). */
export function splitIncentives(incentives: number): { regularity: number; quality: number } {
  const total = round2(Number(incentives));
  if (!Number.isFinite(total) || total <= 0) return { regularity: 0, quality: 0 };
  const regularity = round2(total * REGULARITY_SHARE);
  return { regularity, quality: round2(total - regularity) };
}
