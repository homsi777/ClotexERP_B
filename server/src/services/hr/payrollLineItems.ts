import { z } from 'zod';

/**
 * TASK 011 (بشير) — بنود تفصيل سطر الراتب، دالة صِرفة بلا قاعدة بيانات.
 *
 * البنود المعتمدة (2026-11-18):
 *  استحقاقات (تُضاف):  BONUS مكافأة، TRANSPORT بدل مواصلات، ANNUAL_INCREASE زيادة سنوية،
 *                      SALARY_ADJUSTMENT تعديل راتب (يتطلب سبباً: ترقية…)، SETTLEMENT_ADD تسوية بالإضافة.
 *  استقطاعات (تُخصم):  PURCHASE_DEDUCTION خصم مشتريات، SETTLEMENT_DEDUCT تسوية بالخصم.
 *
 * هذه البنود تفصيل فوق حقلَي allowances/deductions الحاليَّين: مجموعها يُضاف إليهما
 * فيبقى ترحيل القيود يقرأ نفس الإجماليات دون أي تغيير.
 * صافي الراتب = الأساسي + الاستحقاقات − الاستقطاعات.
 */

export const ADDITION_KINDS = [
  'BONUS',
  'TRANSPORT',
  'ANNUAL_INCREASE',
  'SALARY_ADJUSTMENT',
  'SETTLEMENT_ADD',
] as const;
export const DEDUCTION_KINDS = ['PURCHASE_DEDUCTION', 'SETTLEMENT_DEDUCT'] as const;

export const PAYROLL_ITEM_KINDS = [...ADDITION_KINDS, ...DEDUCTION_KINDS] as const;
export type PayrollItemKind = (typeof PAYROLL_ITEM_KINDS)[number];

/** بنود يجب أن تحمل سبباً/ملاحظة نصية غير فارغة. */
const NOTE_REQUIRED: ReadonlySet<PayrollItemKind> = new Set([
  'SALARY_ADJUSTMENT',
  'SETTLEMENT_ADD',
  'SETTLEMENT_DEDUCT',
]);

export const payrollItemSchema = z.object({
  kind: z.enum(PAYROLL_ITEM_KINDS),
  amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  note: z.string().trim().max(500).optional().nullable(),
});

export type PayrollItemInput = z.infer<typeof payrollItemSchema>;

export function isAdditionKind(kind: PayrollItemKind): boolean {
  return (ADDITION_KINDS as readonly string[]).includes(kind);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** يتحقق من متطلبات الملاحظة/السبب؛ يرجع رسالة عربية أو null إن كان سليماً. */
export function validatePayrollItems(items: PayrollItemInput[]): string | null {
  for (const it of items) {
    if (NOTE_REQUIRED.has(it.kind) && !(it.note ?? '').trim()) {
      return it.kind === 'SALARY_ADJUSTMENT'
        ? 'تعديل الراتب يتطلب تسجيل السبب (مثل ترقية)'
        : 'التسوية تتطلب ملاحظة توضّح سببها';
    }
  }
  return null;
}

export type ItemsTotals = { additions: number; deductions: number };

export function sumPayrollItems(items: Array<Pick<PayrollItemInput, 'kind' | 'amount'>>): ItemsTotals {
  let additions = 0;
  let deductions = 0;
  for (const it of items) {
    const amt = Number(it.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (isAdditionKind(it.kind)) additions += amt;
    else deductions += amt;
  }
  return { additions: round2(additions), deductions: round2(deductions) };
}

export type LineAmounts = { baseSalary: number; allowances: number; deductions: number };

/**
 * يطبّق تغيير البنود على سطر قائم: يطرح أثر البنود القديمة ويضيف أثر الجديدة،
 * فيبقى أي مبلغ يدوي/مستورد (allowances/deductions الأصلي) سليماً.
 */
export function applyItemsChange(
  line: LineAmounts,
  previous: Array<Pick<PayrollItemInput, 'kind' | 'amount'>>,
  next: Array<Pick<PayrollItemInput, 'kind' | 'amount'>>,
): LineAmounts & { net: number } {
  const prev = sumPayrollItems(previous);
  const nxt = sumPayrollItems(next);
  const allowances = round2(line.allowances - prev.additions + nxt.additions);
  const deductions = round2(line.deductions - prev.deductions + nxt.deductions);
  const net = round2(line.baseSalary + allowances - deductions);
  return { baseSalary: line.baseSalary, allowances, deductions, net };
}
