/**
 * TASK 011 (بشير) — احتساب ساعات الإضافي، دالة صِرفة بلا قاعدة بيانات.
 *
 * القاعدة المعتمدة (أجوبة بشير 2026-11-18):
 *  - أيام العمل العادية: الساعة تُحتسب بساعة ونصف (×1.5).
 *  - الجمعة والعطلات الرسمية: الساعة تُحتسب بساعتين (×2).
 * الإضافي يُكلَّف به الموظف (ليس تلقائياً) — هذه الدالة تحوِّل ساعات فعلية إلى
 * ساعات مدفوعة فقط؛ ربطها بقيمة الساعة والراتب يتم في طبقة الرواتب لاحقاً.
 */

export type OvertimeDayKind = 'NORMAL' | 'FRIDAY_OR_HOLIDAY';

export const OVERTIME_MULTIPLIER: Record<OvertimeDayKind, number> = {
  NORMAL: 1.5,
  FRIDAY_OR_HOLIDAY: 2,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ساعات مدفوعة = ساعات فعلية × معامل اليوم. */
export function overtimePaidHours(actualHours: number, kind: OvertimeDayKind): number {
  const h = Number(actualHours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return round2(h * OVERTIME_MULTIPLIER[kind]);
}

/**
 * قيمة ساعة الأجر العادية = الأجر الشامل ÷ 30 ÷ ساعات يوم العمل.
 * ساعات يوم العمل من صيغ الملف: صالة النسيج ÷10 على كسر يوم ⇒ 8 ساعات؛ الإدارة ÷11.25 ⇒ 9 ساعات.
 * مستخرجة ومتحقَّق منها من ملف مرتبات أكتوبر 2026: 8 ساعات ليلية لموظف شامله 13,800 = 690
 * (57.5 × 8 × 1.5)، و7 ساعات عطلة ×2 لموظف شامله 11,000 = 641.67 (45.83 × 7 × 2).
 */
export function hourlyRateFromComprehensive(comprehensiveWage: number, workdayHours = 8): number {
  const w = Number(comprehensiveWage);
  const h = Number(workdayHours);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return 0;
  return w / 30 / h;
}

export type OvertimeEntry = { actualHours: number; kind: OvertimeDayKind };

/**
 * فئات الإضافي الأربع بورقة «الانتظام» وصيغها (ملف مرتبات أكتوبر 2026):
 *  ع.ساعات النهارية ×1.5 ، ع.ساعات الليلية ×1.5 ، العطلات ×1 (بدل/تعويض) ، العطلات ×2.
 * يُدخلها HR يدوياً لكل يوم (لا صيغة تشتقها من البصمة)، وتُجمع شهرياً.
 */
export const OVERTIME_CATEGORY_MULTIPLIERS = {
  DAY: 1.5,
  NIGHT: 1.5,
  HOLIDAY_X1: 1,
  HOLIDAY_X2: 2,
} as const;
export type OvertimeCategory = keyof typeof OVERTIME_CATEGORY_MULTIPLIERS;
export type OvertimeHoursByCategory = Partial<Record<OvertimeCategory, number>>;

export type OvertimeMonthResult = {
  hourlyRate: number;
  totalActualHours: number;
  totalPaidHours: number;
  amountByCategory: Record<OvertimeCategory, number>;
  totalAmount: number;
};

/** قيمة إضافي شهر لموظف: لكل فئة الساعات × أجر الساعة × معاملها، ثم الجمع (كعمود «قيمة الاضافى المستحق»). */
export function computeMonthlyOvertime(
  hours: OvertimeHoursByCategory,
  comprehensiveWage: number,
  workdayHours = 8,
): OvertimeMonthResult {
  const hourlyRate = hourlyRateFromComprehensive(comprehensiveWage, workdayHours);
  const amountByCategory = { DAY: 0, NIGHT: 0, HOLIDAY_X1: 0, HOLIDAY_X2: 0 } as Record<OvertimeCategory, number>;
  let totalActual = 0;
  let totalPaid = 0;
  for (const cat of Object.keys(OVERTIME_CATEGORY_MULTIPLIERS) as OvertimeCategory[]) {
    const h = Number(hours[cat]);
    if (!Number.isFinite(h) || h <= 0) continue;
    totalActual += h;
    totalPaid += h * OVERTIME_CATEGORY_MULTIPLIERS[cat];
    amountByCategory[cat] = round2(h * OVERTIME_CATEGORY_MULTIPLIERS[cat] * hourlyRate);
  }
  const totalAmount = round2(Object.values(amountByCategory).reduce((a, b) => a + b, 0));
  return { hourlyRate: round2(hourlyRate), totalActualHours: round2(totalActual), totalPaidHours: round2(totalPaid), amountByCategory, totalAmount };
}

/** قيمة الإضافي لموظف = ساعات مدفوعة × (الشامل ÷ 30 ÷ 8)، مقرَّبة لمنزلتين. */
export function overtimeAmountForWage(entries: OvertimeEntry[], comprehensiveWage: number, workdayHours = 8): number {
  return round2(totalOvertimePaidHours(entries) * hourlyRateFromComprehensive(comprehensiveWage, workdayHours));
}

/** إجمالي الساعات المدفوعة لعدة إدخالات إضافي. */
export function totalOvertimePaidHours(entries: OvertimeEntry[]): number {
  return round2(entries.reduce((sum, e) => sum + overtimePaidHours(e.actualHours, e.kind), 0));
}

/** قيمة الإضافي النقدية = ساعات مدفوعة × قيمة ساعة الأجر العادية. */
export function overtimeAmount(entries: OvertimeEntry[], hourlyRate: number): number {
  const rate = Number(hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return round2(totalOvertimePaidHours(entries) * rate);
}
