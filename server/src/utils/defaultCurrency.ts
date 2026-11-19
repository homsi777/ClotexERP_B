/**
 * ملاحظة مدير بشير: «في المعاملات المادية لفرع مصر اعتماد الجنيه كعملة افتراضية، مع السماح بتغييرها».
 * العملة الافتراضية للمعاملات إعداد لكل فرع (مثل اللغة الافتراضية)، وتختلف عن عملة الأساس المحاسبية
 * (USD ثابتة). هي فقط القيمة الابتدائية بنماذج الفواتير والمصروفات…، ويظل تغييرها يدوياً مسموحاً.
 */

export const SUPPORTED_TRANSACTION_CURRENCIES = ['USD', 'EGP', 'TRY', 'SYP'] as const;
export type TransactionCurrency = (typeof SUPPORTED_TRANSACTION_CURRENCIES)[number];

/** يرجع الرمز بحروف كبيرة إن كان مدعوماً، وإلا null. */
export function normalizeTransactionCurrency(value: unknown): TransactionCurrency | null {
  const v = String(value ?? '').trim().toUpperCase();
  return (SUPPORTED_TRANSACTION_CURRENCIES as readonly string[]).includes(v) ? (v as TransactionCurrency) : null;
}

/** القيمة الفعلية للفرع: المضبوطة وإلا USD (سلوك ما قبل الإعداد دون أي تغيير). */
export function effectiveDefaultCurrency(stored: unknown): TransactionCurrency {
  return normalizeTransactionCurrency(stored) ?? 'USD';
}
