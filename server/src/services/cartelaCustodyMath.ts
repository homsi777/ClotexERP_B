/** حساب حالة ومدة نسخة كارتيلة بعهدة عميل — دالة صِرفة بلا قاعدة بيانات (تواريخ YYYY-MM-DD). */

export type CustodyStatus = 'HELD' | 'LATE' | 'RETURNED';

export type CustodyLineTimes = {
  deliveredOn: string;
  dueDate: string | null;
  returnedOn: string | null;
};

export type CustodyComputed = {
  status: CustodyStatus;
  /** من تاريخ التسليم حتى اليوم (أو حتى تاريخ الإرجاع الفعلي للمُرجَعة). */
  daysHeld: number;
  /** أيام التأخير ابتداءً من اليوم التالي للموعد؛ 0 لغير المتأخرة. */
  daysLate: number;
  dueUndefined: boolean;
};

const MS_DAY = 86_400_000;

export function parseYmd(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new Error(`تاريخ غير صالح: ${s}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function diffDays(fromYmd: string, toYmd: string): number {
  return Math.round((parseYmd(toYmd) - parseYmd(fromYmd)) / MS_DAY);
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(parseYmd(ymd) + days * MS_DAY).toISOString().slice(0, 10);
}

export function computeCustody(line: CustodyLineTimes, todayYmd: string): CustodyComputed {
  if (line.returnedOn) {
    return {
      status: 'RETURNED',
      daysHeld: Math.max(0, diffDays(line.deliveredOn, line.returnedOn)),
      daysLate: 0,
      dueUndefined: line.dueDate == null,
    };
  }
  const daysHeld = Math.max(0, diffDays(line.deliveredOn, todayYmd));
  if (line.dueDate == null) return { status: 'HELD', daysHeld, daysLate: 0, dueUndefined: true };
  const daysLate = Math.max(0, diffDays(line.dueDate, todayYmd));
  return { status: daysLate > 0 ? 'LATE' : 'HELD', daysHeld, daysLate, dueUndefined: false };
}

/** موعد الإرجاع من عدد أيام أو تاريخ مباشر (التاريخ المباشر يغلب)، وإلا null. */
export function resolveDueDate(deliveredOn: string, input: { days?: number | null; dueDate?: string | null }): string | null {
  if (input.dueDate) {
    if (diffDays(deliveredOn, input.dueDate) < 0) throw new Error('موعد الإرجاع قبل تاريخ التسليم');
    return input.dueDate.slice(0, 10);
  }
  if (input.days != null && Number.isFinite(input.days)) {
    if (!Number.isInteger(input.days) || input.days <= 0) throw new Error('عدد الأيام يجب أن يكون عدداً صحيحاً موجباً');
    return addDaysYmd(deliveredOn, input.days);
  }
  return null;
}
