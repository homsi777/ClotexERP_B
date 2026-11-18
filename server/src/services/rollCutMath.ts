/**
 * TASK 009 (بشير) — تحقّق قص التوب، دالة صِرفة قابلة للاختبار بلا قاعدة بيانات.
 * لا تلمس أي رصيد؛ تتحقق فقط من صلاحية كمية القص وتحسب المتبقي.
 */

const EPS = 1e-6;

export type CutValidationInput = {
  currentLengthM: number;
  cutLengthM: number;
  status: string;
};

export type CutValidationResult =
  | { ok: true; remainingLengthM: number; fullRoll: boolean }
  | { ok: false; code: 'NOT_AVAILABLE' | 'INVALID_CUT' | 'EXCEEDS_LENGTH'; message: string };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function validateRollCut(input: CutValidationInput): CutValidationResult {
  const status = String(input.status || '').toUpperCase();
  // يُسمح بالقص من المتاح أو المحجوز (كالبيع الجزئي الحالي تماماً).
  if (status !== 'AVAILABLE' && status !== 'RESERVED') {
    return { ok: false, code: 'NOT_AVAILABLE', message: 'التوب غير متاح للقص والبيع' };
  }
  const len = Number(input.currentLengthM);
  const cut = Number(input.cutLengthM);
  if (!Number.isFinite(cut) || cut <= EPS) {
    return { ok: false, code: 'INVALID_CUT', message: 'كمية القص يجب أن تكون أكبر من صفر' };
  }
  if (!Number.isFinite(len) || len <= EPS) {
    return { ok: false, code: 'EXCEEDS_LENGTH', message: 'لا يوجد رصيد متر على هذا التوب' };
  }
  if (cut > len + EPS) {
    return { ok: false, code: 'EXCEEDS_LENGTH', message: 'كمية القص أكبر من رصيد المتر على التوب' };
  }
  const remaining = round3(Math.max(0, len - cut));
  // القص المساوي لكامل الطول = بيع التوب كاملاً (لا يبقى متبقٍّ للطباعة الثانية).
  const fullRoll = remaining <= EPS;
  return { ok: true, remainingLengthM: fullRoll ? 0 : remaining, fullRoll };
}
