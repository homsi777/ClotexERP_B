/**
 * TASK 010 (بشير) — ملخص كشف الحساب بعملاته (عملاء + موردون).
 *
 * دالة صِرفة، لا تلمس أي فاتورة أو قيد أو رصيد: تأخذ أرصدة كل عملة بقيمها
 * الأصلية (من statement-by-currency) وتُنتج "شرائط" عرض فقط.
 *
 * القواعد المعتمدة من بشير:
 *  - بلا عملة عرض (null): شريط مستقل لكل عملة بقيمتها الأصلية، دون جمع أو تحويل.
 *  - عند اختيار عملة عرض D: كل عملة غير D تُعرض بقيمتها الأصلية + سعر الصرف
 *    + ما يعادلها بـ D (مثال: 50,000 جنيه ÷ 50 = 1,000$).
 *  - عملة تطابق D (أو عملة بلا سعر صرف) تُعرض منفصلة بقيمتها الأصلية ولا
 *    تدخل في أي إجمالي — لا يوجد إجمالي موحَّد عبر العملات أصلاً.
 *
 * سعر الصرف المركزي: exchange_rate_to_usd = وحدات العملة مقابل 1 دولار
 * (USD = 1). التحويل من A إلى B: amount / rate[A] * rate[B].
 */

export type CurrencyBalanceInput = {
  currency: string;
  openingBalance: number;
  totals: { debit: number; credit: number; closingBalance: number; pendingChecksTotal?: number; expectedBalance?: number };
  pendingChecks?: { checkNo: string; bankName: string; dueDate: string; amount: number }[];
};

/** وحدات العملة مقابل 1 دولار. USD = 1 ضمنياً حتى لو لم يُذكر. */
export type RatesToUsd = Record<string, number>;

export type CurrencyStrip = {
  currency: string;
  openingBalance: number;
  debit: number;
  credit: number;
  /** الرصيد الختامي موقّعاً: موجب = مدين، سالب = دائن (نفس اصطلاح الخادم). */
  closingBalance: number;
  /** شيكات قيد التحصيل (لا تُخصم من الرصيد) والرصيد المتوقع بعد تحصيلها. */
  pendingChecksTotal: number;
  expectedBalance: number;
  pendingChecks: { checkNo: string; bankName: string; dueDate: string; amount: number }[];
  conversion:
    | null
    | {
        toCurrency: string;
        /** وحدات العملة الأصلية مقابل وحدة واحدة من عملة العرض (50 جنيه = 1$ → 50). */
        rate: number;
        converted: number;
      };
  /** true إذا طُلب تحويل لكن لا يتوفر سعر صرف مُفعَّل لإحدى العملتين. */
  missingRate: boolean;
};

function rateFor(currency: string, rates: RatesToUsd): number | null {
  if (currency === 'USD') return 1;
  const r = rates[currency];
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null;
}

export function buildCurrencyStrips(
  entries: CurrencyBalanceInput[],
  displayCurrency: string | null,
  rates: RatesToUsd,
): CurrencyStrip[] {
  return entries.map((entry) => {
    const base: CurrencyStrip = {
      currency: entry.currency,
      openingBalance: entry.openingBalance,
      debit: entry.totals.debit,
      credit: entry.totals.credit,
      closingBalance: entry.totals.closingBalance,
      pendingChecksTotal: entry.totals.pendingChecksTotal ?? 0,
      expectedBalance: entry.totals.expectedBalance ?? entry.totals.closingBalance,
      pendingChecks: entry.pendingChecks ?? [],
      conversion: null,
      missingRate: false,
    };
    if (!displayCurrency || displayCurrency === entry.currency) return base;

    const from = rateFor(entry.currency, rates);
    const to = rateFor(displayCurrency, rates);
    if (from === null || to === null) return { ...base, missingRate: true };

    return {
      ...base,
      conversion: {
        toCurrency: displayCurrency,
        rate: from / to,
        converted: (entry.totals.closingBalance / from) * to,
      },
    };
  });
}
