/**
 * TASK 019 — اشتقاق بيانات الموظف من سطر ملف المرتبات، دوال صِرفة بلا قاعدة بيانات.
 *
 * العيب الذي صُحِّح: مستورد الرواتب كان يسجّل «الأجر الأساسي» (75% أو 80% من الشامل) كأجر للموظف،
 * بينما قاعدة HR: الأجر المُدخَل = الأجر الشامل وأجر اليوم = الشامل ÷ 30 (غياب، مرضية، إضافي).
 * فكان خصم/إضافي كل موظف مُنشأ بالاستيراد أقل من الصحيح بنحو 20–25%.
 */

const EPS = 0.5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type DerivedEmployeeWage = {
  /** الأجر الذي يُسجَّل للموظف (الشامل إن وُجد، وإلا الأساسي كاحتياط). */
  employeeWage: number;
  /** نسبة الأساسي من الشامل (75/80…) مشتقة من الملف نفسه، أو null إن تعذّر. */
  baseSharePercent: number | null;
  source: 'COMPREHENSIVE' | 'BASIC_FALLBACK';
};

export function deriveEmployeeWage(input: { comprehensive?: number | null; base: number }): DerivedEmployeeWage {
  const comp = Number(input.comprehensive);
  const base = Number(input.base);
  if (Number.isFinite(comp) && comp > 0) {
    const share = Number.isFinite(base) && base > 0 && base <= comp + 0.01 ? round2((base / comp) * 100) : null;
    return { employeeWage: round2(comp), baseSharePercent: share !== null && share > 0 && share <= 100 ? share : null, source: 'COMPREHENSIVE' };
  }
  return { employeeWage: round2(Number.isFinite(base) ? base : 0), baseSharePercent: null, source: 'BASIC_FALLBACK' };
}

export type WageCheck = 'MATCHES_COMPREHENSIVE' | 'MATCHES_BASIC' | 'DIFFERENT';

/**
 * يقارن الأجر المسجّل لموظف قائم بما في الملف: هل يطابق الشامل (صحيح)؟ أم الأساسي (استيراد قديم خاطئ
 * محتمل)؟ أم يختلف (تعديل راتب لاحق مشروع)؟ للتنبيه فقط — لا يُعدَّل أي أجر تلقائياً.
 */
export function checkStoredWage(stored: number, comprehensive: number, base: number): WageCheck {
  const s = Number(stored);
  if (Number.isFinite(comprehensive) && comprehensive > 0 && Math.abs(s - comprehensive) <= EPS) return 'MATCHES_COMPREHENSIVE';
  if (Number.isFinite(base) && base > 0 && Math.abs(s - base) <= EPS) return 'MATCHES_BASIC';
  return 'DIFFERENT';
}

/** ساعات يوم العمل المقترحة من اسم الملف/القسم: الإدارة 9، غيرها (صالة النسيج) 8 — من صيغ ملفات المرتبات. */
export function guessWorkdayHoursFromLabel(label: string | null | undefined): number {
  const l = String(label ?? '').replace(/[أإآ]/g, 'ا');
  return /ادار/.test(l) ? 9 : 8;
}
