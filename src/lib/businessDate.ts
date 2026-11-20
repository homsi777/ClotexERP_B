/**
 * منظومة الوقت في الواجهة: «اليوم» بتوقيت جهاز المستخدم (لا UTC)، وتنسيق موحّد للتواريخ،
 * وحساب الأيام المتبقية. أي تاريخ قادم من الخادم يكون نصاً YYYY-MM-DD أو ISO كامل؛ كلاهما يُعرض هنا بالشكل نفسه.
 */
const pad = (n: number) => String(n).padStart(2, '0');

export function todayYmd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** يحوّل أي قيمة تاريخ (YYYY-MM-DD أو ISO) إلى YYYY-MM-DD ثابت بلا انزياح منطقة زمنية للتواريخ البسيطة. */
export function toYmd(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return todayYmd(value);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : todayYmd(d);
}

/** الأيام المتبقية حتى تاريخ (سالب = متأخر). */
export function daysUntil(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  const ymd = toYmd(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const a = Date.parse(`${ymd}T00:00:00Z`);
  const b = Date.parse(`${todayYmd(now)}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}
