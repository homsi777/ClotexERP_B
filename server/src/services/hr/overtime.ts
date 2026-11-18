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
 * قيمة ساعة الأجر العادية = الأجر الشامل ÷ 30 ÷ 8.
 * مستخرجة ومتحقَّق منها من ملف مرتبات أكتوبر 2026: 8 ساعات ليلية لموظف شامله 13,800 = 690
 * (57.5 × 8 × 1.5)، و7 ساعات عطلة ×2 لموظف شامله 11,000 = 641.67 (45.83 × 7 × 2).
 */
export function hourlyRateFromComprehensive(comprehensiveWage: number): number {
  const w = Number(comprehensiveWage);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return w / 30 / 8;
}

export type OvertimeEntry = { actualHours: number; kind: OvertimeDayKind };

/** قيمة الإضافي لموظف = ساعات مدفوعة × (الشامل ÷ 30 ÷ 8)، مقرَّبة لمنزلتين. */
export function overtimeAmountForWage(entries: OvertimeEntry[], comprehensiveWage: number): number {
  return round2(totalOvertimePaidHours(entries) * hourlyRateFromComprehensive(comprehensiveWage));
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
