/**
 * ترميز Code128 مضغوط (مجموعة C للأرقام المتتالية) وحساب العرض المناسب بالمليمتر.
 * مجموعة B (الافتراضية) تخصص 11 شريطاً لكل حرف؛ مجموعة C تُرمِّز رقمين بـ11 شريطاً، فيصير الباركود الرقمي بنصف العرض تقريباً.
 * كل ماسحات Code128 تقرأ C/B تلقائياً، والنص المقروء لا يتغير.
 */

const START_B = 104;
const START_C = 105;
const TO_B = 100;
const TO_C = 99;
const STOP = 106;
const MIN_RUN_FOR_C = 4;

function cleanValue(value: string): string {
  return String(value ?? '').replace(/[^ -~]/g, '').slice(0, 48) || '0';
}

/** القيم قبل الفحص والنهاية (تبدأ بحرف البداية). compact=false ← مجموعة B فقط كما كان سابقاً. */
export function code128DataCodes(value: string, compact: boolean): number[] {
  const clean = cleanValue(value);
  const bChar = (c: string) => c.charCodeAt(0) - 32;
  if (!compact) return [START_B, ...clean.split('').map(bChar)];
  const lead = clean.match(/^\d+/)?.[0].length ?? 0;
  const evenLead = lead - (lead % 2);
  if (lead >= MIN_RUN_FOR_C && evenLead >= MIN_RUN_FOR_C) {
    const codes: number[] = [START_C];
    for (let i = 0; i < evenLead; i += 2) codes.push(Number(clean.slice(i, i + 2)));
    const rest = clean.slice(evenLead);
    if (rest) codes.push(TO_B, ...rest.split('').map(bChar));
    return codes;
  }
  return [START_B, ...clean.split('').map(bChar)];
}

/** التسلسل الكامل: القيم + رقم الفحص + النهاية. */
export function code128Sequence(value: string, compact = false): number[] {
  const codes = code128DataCodes(value, compact);
  const checksum = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, checksum, STOP];
}

/** عدد الأشرطة (modules): 11 لكل رمز عدا النهاية (13). */
export function code128Modules(value: string, compact = false): number {
  const seq = code128Sequence(value, compact);
  return (seq.length - 1) * 11 + 13;
}

/** عرض الباركود بالمليمتر: أشرطة × 0.25 مم (شريطان على طابعة 203dpi)، بين 18 و44 مم. */
export function code128WidthMm(value: string, compact = true): number {
  return Math.min(44, Math.max(18, Math.round(code128Modules(value, compact) * 0.25 * 10) / 10));
}
