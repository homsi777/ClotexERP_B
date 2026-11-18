import { computeMonthlyAbsencePenalty, dayWageFromComprehensive } from './absencePenalty.js';

/**
 * TASK 013 (بشير/HR) — حالات الحضور وأثرها، دالة صِرفة بلا قاعدة بيانات.
 *
 * الحالات وأثرها (من جدول HR المعتمد):
 *  غ  غياب بدون إذن      ⇒ جزاء متدرّج (أو يومان ثابتان قبل 1-11-2026)
 *  س  إجازة سنوية        ⇒ خصم يوم من رصيد الإجازات
 *  ع  إجازة عارضة        ⇒ خصم يوم من رصيد الإجازات
 *  م  إجازة مرضية        ⇒ خصم 50% من أجر اليوم (والشركة تتحمل الباقي)
 *  ز  إجازة زواج         ⇒ خصم 50% من أجر اليوم
 *  ج  غياب بإذن          ⇒ خصم يوم من رصيد الإجازات
 *  حظر / مأمورية / إجازة مأمورية / إجازة رسمية ⇒ تتحملها الشركة (بلا أثر)
 *  راحة                  ⇒ يوم عطلة (بلا أثر)
 *  إجازة بدل             ⇒ تعويض إضافي بأجر أو بيوم: لا أثر آلي (يُحدَّد بالحركة)
 *
 * أجر اليوم = الأجر الشامل ÷ 30. لا تُرحَّل هذه النتائج لأي راتب هنا؛ هي معاينة أثر فقط.
 */

export const ATTENDANCE_STATUSES = [
  { code: 'UNAUTH_ABSENCE', symbol: 'غ', label: 'غياب بدون إذن', effect: 'ABSENCE_PENALTY' },
  { code: 'ANNUAL', symbol: 'س', label: 'إجازة سنوية', effect: 'LEAVE_BALANCE' },
  { code: 'CASUAL', symbol: 'ع', label: 'إجازة عارضة', effect: 'LEAVE_BALANCE' },
  { code: 'SICK', symbol: 'م', label: 'إجازة مرضية', effect: 'HALF_PAY' },
  { code: 'MARRIAGE', symbol: 'ز', label: 'إجازة زواج', effect: 'HALF_PAY' },
  { code: 'PERMITTED_ABSENCE', symbol: 'ج', label: 'غياب بإذن', effect: 'LEAVE_BALANCE' },
  { code: 'BAN', symbol: '', label: 'حظر', effect: 'COMPANY' },
  { code: 'COMP_LEAVE', symbol: '', label: 'إجازة بدل', effect: 'MANUAL' },
  { code: 'MISSION_LEAVE', symbol: '', label: 'إجازة مأمورية', effect: 'COMPANY' },
  { code: 'OFFICIAL_HOLIDAY', symbol: '', label: 'إجازة رسمية', effect: 'COMPANY' },
  { code: 'REST', symbol: '', label: 'راحة', effect: 'DAY_OFF' },
  { code: 'MISSION', symbol: '', label: 'مأمورية', effect: 'COMPANY' },
] as const;

export type AttendanceStatusCode = (typeof ATTENDANCE_STATUSES)[number]['code'];
export type AttendanceEffect = (typeof ATTENDANCE_STATUSES)[number]['effect'];

export const ATTENDANCE_STATUS_CODES = ATTENDANCE_STATUSES.map((s) => s.code) as AttendanceStatusCode[];

const BY_CODE = new Map(ATTENDANCE_STATUSES.map((s) => [s.code as string, s]));

export function attendanceEffectOf(code: string): AttendanceEffect | null {
  return BY_CODE.get(code)?.effect ?? null;
}

/** قاعدة الغياب المتدرّج تسري من هذا الشهر (1 نوفمبر 2026)؛ قبله يومان ثابتان. */
export const GRADUATED_RULE_FROM = { year: 2026, month: 11 } as const;

export function usesGraduatedAbsenceRule(year: number, month: number): boolean {
  return year > GRADUATED_RULE_FROM.year || (year === GRADUATED_RULE_FROM.year && month >= GRADUATED_RULE_FROM.month);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type AttendanceStatusRecord = { date: string; status: string | null };

export type MonthlyStatusSummary = {
  year: number;
  month: number;
  dayWage: number;
  counts: Record<string, number>;
  /** أيام تُخصم من رصيد الإجازات (س + ع + ج). */
  leaveDaysUsed: number;
  /** أيام الإجازة بنصف أجر (م + ز) وخصمها. */
  halfPayDays: number;
  halfPayDeduction: number;
  unauthorizedAbsenceDays: number;
  absenceRule: 'GRADUATED' | 'LEGACY_FLAT_2';
  absenceWageDeduction: number;
  absencePenaltyDeduction: number;
  absenceDeduction: number;
  /** إجمالي خصم الراتب من هذه الحالات (غياب + نصف أجر). لا يشمل خصم رصيد الإجازات. */
  totalPayrollDeduction: number;
  /** حالات غير معروفة تُتجاهل بدل أن تُفسد الحساب. */
  unknownStatuses: string[];
};

/**
 * يلخّص أثر حالات شهر واحد لموظف واحد. السجلات المطلوبة هي سجلات هذا الشهر فقط
 * (الترتيب داخل الشهر للغياب بدون إذن يُحسب بتاريخ اليوم تصاعدياً).
 */
export function summarizeMonthlyStatuses(
  records: AttendanceStatusRecord[],
  comprehensiveWage: number,
  year: number,
  month: number,
): MonthlyStatusSummary {
  const dayWage = dayWageFromComprehensive(comprehensiveWage);
  const counts: Record<string, number> = {};
  const unknown = new Set<string>();

  for (const r of records) {
    if (!r.status) continue;
    if (!BY_CODE.has(r.status)) {
      unknown.add(r.status);
      continue;
    }
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  const leaveDaysUsed = (counts.ANNUAL ?? 0) + (counts.CASUAL ?? 0) + (counts.PERMITTED_ABSENCE ?? 0);
  const halfPayDays = (counts.SICK ?? 0) + (counts.MARRIAGE ?? 0);
  const halfPayDeduction = round2(halfPayDays * dayWage * 0.5);

  const absentDays = counts.UNAUTH_ABSENCE ?? 0;
  const graduated = usesGraduatedAbsenceRule(year, month);
  let wagePart: number;
  let penaltyPart: number;
  if (graduated) {
    const r = computeMonthlyAbsencePenalty(comprehensiveWage, absentDays);
    wagePart = r.totalWageDeduction;
    penaltyPart = r.totalPenaltyDeduction;
  } else {
    // القاعدة القديمة: يومان ثابتان عن كل يوم غياب = أجر اليوم + جزاء يوم.
    wagePart = round2(absentDays * dayWage);
    penaltyPart = round2(absentDays * dayWage);
  }
  const absenceDeduction = round2(wagePart + penaltyPart);

  return {
    year,
    month,
    dayWage,
    counts,
    leaveDaysUsed,
    halfPayDays,
    halfPayDeduction,
    unauthorizedAbsenceDays: absentDays,
    absenceRule: graduated ? 'GRADUATED' : 'LEGACY_FLAT_2',
    absenceWageDeduction: wagePart,
    absencePenaltyDeduction: penaltyPart,
    absenceDeduction,
    totalPayrollDeduction: round2(absenceDeduction + halfPayDeduction),
    unknownStatuses: Array.from(unknown),
  };
}
