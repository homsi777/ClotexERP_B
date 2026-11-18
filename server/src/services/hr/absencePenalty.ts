/**
 * TASK 011 (بشير) — جزاء الغياب بدون إذن «غ»، دالة صِرفة بلا قاعدة بيانات.
 *
 * القواعد المعتمدة (أجوبة بشير 2026-11-18):
 *  - أجر اليوم للخصومات = الأجر الشامل ÷ 30 (ثابت 30 يوماً) — انظر dayWageFromComprehensive.
 *  - الخصم عن كل يوم غياب = أجر اليوم × (1 + معامل الجزاء)، والمعامل حسب ترتيب
 *    يوم الغياب بدون إذن داخل الشهر الميلادي:
 *        الأول 0.25، الثاني 0.50، الثالث 1.00، الرابع 2.00.
 *  - من اليوم الخامس فصاعداً (كل ما زاد عن 4): الخصم = يومان ثابتان عن كل يوم
 *    غياب (أي أجر اليوم × 2) — تأكيد بشير: «أي حاجة تزيد عن خمس أيام تُضرب بيومين».
 *  - العدّ لكل موظف على حدة، ويبدأ من جديد («يُرَسِّت») في أول كل شهر ميلادي.
 *
 * ملاحظة صريحة للمراجعة: اليوم الخامس تحديداً عامَلناه بقاعدة «اليومين الثابتين»
 * (×2) مثل ما بعده، لأن الجدول الأصلي عرّف 1–4 فقط وبشير اعتمد «يومين» لما زاد.
 */

/** معاملات الجزاء للأيام 1–4 (الترتيب داخل الشهر). */
const GRADUATED_FACTORS: Record<number, number> = {
  1: 0.25,
  2: 0.5,
  3: 1.0,
  4: 2.0,
};

/** الخصم الثابت (بعدد أيام الأجر) لليوم الخامس فصاعداً. */
const FLAT_DAYS_FROM_FIFTH = 2;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** أجر اليوم = الأجر الشامل ÷ 30 (ثابت 30، باعتماد بشير). */
export function dayWageFromComprehensive(comprehensiveSalary: number): number {
  const s = Number(comprehensiveSalary);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return round2(s / 30);
}

/** معامل الجزاء لترتيب يوم غياب واحد داخل الشهر (للعرض/التفصيل). */
export function absencePenaltyFactor(rankInMonth: number): number {
  if (rankInMonth <= 0) return 0;
  if (rankInMonth <= 4) return GRADUATED_FACTORS[rankInMonth];
  // اليوم الخامس فصاعداً: خصم يومين ثابتين ⇒ أجر اليوم × 2 ⇒ (1 + 1).
  return FLAT_DAYS_FROM_FIFTH - 1;
}

/** خصم يوم غياب واحد = أجر اليوم × (1 + معامل الجزاء). */
export function absenceDayDeduction(dayWage: number, rankInMonth: number): number {
  if (rankInMonth <= 0 || dayWage <= 0) return 0;
  return round2(dayWage * (1 + absencePenaltyFactor(rankInMonth)));
}

export type AbsenceMonthBreakdownRow = {
  rank: number;
  factor: number;
  dayWage: number;
  wageDay: number;
  penaltyExtra: number;
  totalDeduction: number;
};

export type AbsenceMonthResult = {
  dayWage: number;
  absentDays: number;
  rows: AbsenceMonthBreakdownRow[];
  totalWageDeduction: number;
  totalPenaltyDeduction: number;
  totalDeduction: number;
};

/**
 * يحسب خصم كامل أيام الغياب بدون إذن لموظف خلال شهر واحد.
 * absentDays = عدد أيام الغياب بدون إذن في هذا الشهر (تُحسب بترتيبها 1..n).
 * يفصل أجر يوم الغياب نفسه (wageDay) عن الجزاء الإضافي (penaltyExtra) كبندين
 * واضحين كما طلب بشير.
 */
export function computeMonthlyAbsencePenalty(
  comprehensiveSalary: number,
  absentDays: number,
): AbsenceMonthResult {
  const dayWage = dayWageFromComprehensive(comprehensiveSalary);
  const n = Math.max(0, Math.floor(absentDays));
  const rows: AbsenceMonthBreakdownRow[] = [];
  let totalWage = 0;
  let totalPenalty = 0;
  for (let rank = 1; rank <= n; rank++) {
    const factor = absencePenaltyFactor(rank);
    const wageDay = dayWage;
    const penaltyExtra = round2(dayWage * factor);
    const totalDeduction = round2(wageDay + penaltyExtra);
    rows.push({ rank, factor, dayWage, wageDay, penaltyExtra, totalDeduction });
    totalWage = round2(totalWage + wageDay);
    totalPenalty = round2(totalPenalty + penaltyExtra);
  }
  return {
    dayWage,
    absentDays: n,
    rows,
    totalWageDeduction: totalWage,
    totalPenaltyDeduction: totalPenalty,
    totalDeduction: round2(totalWage + totalPenalty),
  };
}
