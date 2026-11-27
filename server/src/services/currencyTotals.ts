/**
 * مجاميع مالية حسب العملة — لا يُجمع مبلغان بعملتين مختلفتين دون تحويل محاسبي معتمد.
 * تُستخدم في التقارير والمؤشرات التي تعرض إجماليات نصية.
 */
export interface CurrencyTotalRow { currency_code: string | null; total: string | number | null }

const fmt = (v: string | number | null): string =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "EGP 1,000.00 | USD 500.00" — أو "0.00" عند عدم وجود صفوف. */
export function formatTotalsByCurrency(rows: CurrencyTotalRow[]): string {
  const parts = rows
    .filter((r) => r.currency_code)
    .map((r) => `${r.currency_code} ${fmt(r.total)}`);
  return parts.length ? parts.join(' | ') : '0.00';
}

export function totalsByCurrencyList(rows: CurrencyTotalRow[]): { currency_code: string; total: string }[] {
  return rows.filter((r) => r.currency_code).map((r) => ({ currency_code: String(r.currency_code), total: String(r.total ?? 0) }));
}
