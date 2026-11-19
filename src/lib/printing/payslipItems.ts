/**
 * TASK 011 — صفوف بنود الراتب لكشف الراتب المطبوع. ملف صِرف بلا استيراد للشعار/الصور
 * ليكون قابلاً للاختبار؛ يستخدمه renderPayslipA4.
 */
export type PayslipItem = { kind: string; amount: number | string; note?: string | null };

const ITEM_LABELS_AR: Record<string, { label: string; sign: 1 | -1 }> = {
  BONUS: { label: 'مكافأة', sign: 1 },
  TRANSPORT: { label: 'بدل مواصلات', sign: 1 },
  ANNUAL_INCREASE: { label: 'زيادة سنوية', sign: 1 },
  SALARY_ADJUSTMENT: { label: 'تعديل راتب', sign: 1 },
  SETTLEMENT_ADD: { label: 'تسوية بالإضافة', sign: 1 },
  OVERTIME: { label: 'إضافي', sign: 1 },
  ATTENDANCE_OVERTIME: { label: 'إضافي (من الحضور)', sign: 1 },
  PURCHASE_DEDUCTION: { label: 'خصم مشتريات', sign: -1 },
  SETTLEMENT_DEDUCT: { label: 'تسوية بالخصم', sign: -1 },
  ATTENDANCE_ABSENCE_DEDUCTION: { label: 'خصم غياب بدون إذن', sign: -1 },
  ATTENDANCE_HALF_PAY_DEDUCTION: { label: 'خصم نصف أجر (إجازة مرضية/زواج)', sign: -1 },
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** صفوف بنود الراتب: الاستحقاق بإشارة +، والاستقطاع بإشارة −، مع الملاحظة/السبب. */
export function payslipItemRows(items: PayslipItem[] | null | undefined): string {
  if (!items?.length) return '';
  return items
    .map((it) => {
      const meta = ITEM_LABELS_AR[it.kind] ?? { label: it.kind, sign: 1 as const };
      const amount = Math.abs(Number(it.amount));
      const signed = `${meta.sign === 1 ? '+' : '-'}${money(Number.isFinite(amount) ? amount : 0)}`;
      const note = it.note ? ` <span class="det-note">(${esc(it.note)})</span>` : '';
      return `<tr><td class="det-label">${esc(meta.label)}${note}</td><td class="det-value">${signed}</td></tr>`;
    })
    .join('');
}
