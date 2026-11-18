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

export type OvertimeEntry = { actualHours: number; kind: OvertimeDayKind };

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
