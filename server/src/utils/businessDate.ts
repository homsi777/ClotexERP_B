/**
 * منظومة الوقت: تاريخ «اليوم» بتوقيت العمل لا بتوقيت UTC (بعد التاسعة مساءً بتوقيت دمشق كان اليوم يُحسب بالأمس).
 * المنطقة الزمنية من BUSINESS_TIMEZONE (الافتراضي Asia/Damascus).
 */
const TZ = process.env.BUSINESS_TIMEZONE?.trim() || 'Asia/Damascus';

export function todayYmd(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** الأيام المتبقية حتى تاريخ YYYY-MM-DD (سالب = متأخر) بحسب تاريخ اليوم بتوقيت العمل. */
export function daysUntilYmd(ymd: string, now: Date = new Date()): number {
  const a = Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${todayYmd(now)}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}
