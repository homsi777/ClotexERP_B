/**
 * TASK 011 (بشير) — رصيد الإجازات السنوي، دالة صِرفة بلا قاعدة بيانات.
 *
 * القواعد المعتمدة (أجوبة بشير/HR بتاريخ 2026-11-18):
 *  - الاستحقاق يبدأ من تاريخ التعيين، والاستخدام يُتاح بعد إكمال 3 أشهر
 *    (الأشهر الثلاثة محسوبة ضمن الرصيد).
 *  - أول 12 شهر خدمة: 15 يوماً سنوياً بالتناسب. من إكمال سنة الخدمة: 21 يوماً سنوياً.
 *  - المعيّنون قبل 1 أيلول 2025: 21 يوماً سنوياً.
 *  - من تجاوز عمره 50 سنة أو أكمل 10 سنوات تأمينات فأكثر: 30 يوماً سنوياً.
 *  - إذا تغيّر المعدل خلال السنة التقويمية تُحسب كل فترة بمعدلها ثم تُجمع،
 *    ويُقرَّب كسر اليوم للأعلى مرة واحدة فقط على المجموع.
 *
 * طريقة التناسب: كل شهر تقويمي يساوي 1/12 من المعدل السنوي، وللشهر الجزئي
 * تُوزَّع قيمته على أيامه — فتخرج الأمثلة الكاملة بالأشهر بدقة (9 أشهر × 15 ÷ 12 = 11.25).
 *
 * ملاحظة صريحة للمراجعة: «تجاوز 50 سنة» عُدَّ العمر > 50 بالتاريخ الفعلي لكل يوم.
 */

export type LeaveBalanceInput = {
  /** تاريخ التعيين (YYYY-MM-DD). */
  hireDate: string;
  /** السنة التقويمية المطلوب رصيدها (مثلاً 2026). */
  year: number;
  /** تاريخ الميلاد (YYYY-MM-DD) إن وُجد، لتحديد العمر > 50. */
  birthDate?: string | null;
  /** تاريخ إكمال 10 سنوات تأمينات إن وُجد (YYYY-MM-DD) — أو أقدم تاريخ تأمين. */
  tenYearsInsuranceDate?: string | null;
};

export type LeaveBalanceResult = {
  /** الرصيد المستحق للسنة بعد التقريب للأعلى. */
  days: number;
  /** الرصيد قبل التقريب (للتدقيق). */
  rawDays: number;
  /** أول تاريخ يُتاح فيه الاستخدام (تعيين + 3 أشهر). */
  usableFrom: string;
};

const LEGACY_CUTOFF = '2025-09-01'; // المعيّنون قبله = 21 يوماً
const RATE_FIRST_YEAR = 15;
const RATE_STANDARD = 21;
const RATE_SENIOR = 30;
const EPS = 1e-9;

function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** المعدل السنوي الساري في يوم معيّن لموظف معيّن. */
export function leaveRateOnDate(date: Date, input: LeaveBalanceInput): number {
  const hire = parseDate(input.hireDate);
  const firstAnniversary = addMonths(hire, 12);

  // 30 يوماً: عمر > 50 أو إكمال 10 سنوات تأمينات (يسري من تاريخ تحقق الشرط).
  if (input.birthDate) {
    const fiftyOne = addMonths(parseDate(input.birthDate), 12 * 50 + 0);
    // العمر > 50 ⇒ بعد إكمال 50 سنة كاملة (يوم ميلاده الخمسين فما بعده + يوم).
    if (date.getTime() > fiftyOne.getTime()) return RATE_SENIOR;
  }
  if (input.tenYearsInsuranceDate && date.getTime() >= parseDate(input.tenYearsInsuranceDate).getTime()) {
    return RATE_SENIOR;
  }
  // قبل 1 أيلول 2025 ⇒ 21 يوماً دائماً.
  if (hire.getTime() < parseDate(LEGACY_CUTOFF).getTime()) return RATE_STANDARD;
  // أول 12 شهر خدمة 15، ثم 21.
  return date.getTime() < firstAnniversary.getTime() ? RATE_FIRST_YEAR : RATE_STANDARD;
}

export function computeAnnualLeaveBalance(input: LeaveBalanceInput): LeaveBalanceResult {
  const hire = parseDate(input.hireDate);
  const usableFrom = iso(addMonths(hire, 3));

  const yearStart = Date.UTC(input.year, 0, 1);
  const yearEnd = Date.UTC(input.year, 11, 31);
  let raw = 0;

  for (let m0 = 0; m0 < 12; m0++) {
    const dim = daysInMonth(input.year, m0);
    for (let day = 1; day <= dim; day++) {
      const t = Date.UTC(input.year, m0, day);
      if (t < hire.getTime() || t < yearStart || t > yearEnd) continue;
      const rate = leaveRateOnDate(new Date(t), input);
      // الشهر = 1/12 من السنة؛ اليوم = جزء من شهره.
      raw += rate / 12 / dim;
    }
  }

  const days = Math.max(0, Math.ceil(raw - EPS));
  return { days, rawDays: Math.round(raw * 10000) / 10000, usableFrom };
}
