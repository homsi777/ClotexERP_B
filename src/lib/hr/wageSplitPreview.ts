/**
 * TASK 016: معاينة تقسيم الأجر الشامل في نموذج الموظف (مرآة لـ server/src/services/hr/wageSplit.ts).
 * أساسي = الشامل × النسبة، والحوافز = الباقي، وتنقسم 35% انتظام / 65% جودة (من صيغ ملفات المرتبات).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export function previewWageSplit(comprehensive: number, baseSharePercent: number) {
  if (!(comprehensive > 0) || !(baseSharePercent > 0) || baseSharePercent > 100) return null;
  const base = r2(comprehensive * (baseSharePercent / 100));
  const incentives = r2(comprehensive - base);
  const regularity = r2(incentives * 0.35);
  return { base, incentives, regularity, quality: r2(incentives - regularity) };
}
