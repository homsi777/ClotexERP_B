import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrencyStrip } from '../../lib/statements/currencySummary';

type Props = {
  strips: CurrencyStrip[];
  loading?: boolean;
  error?: string | null;
  /** مورّد: الرصيد الموجب = دائن للمورّد (مستحق له) بدل "مدين" للعميل. */
  isSupplier?: boolean;
};

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * TASK 010 (بشير): شريط لكل عملة بقيمتها الأصلية؛ عند اختيار عملة عرض تظهر
 * بجانبه المعادلة (المبلغ ÷ السعر = المعادل). عرض فقط — لا إجمالي موحَّد.
 * مشترك بين كشف العملاء وكشف الموردين.
 */
export const CurrencyStripsPanel: React.FC<Props> = ({ strips, loading, error, isSupplier }) => {
  const { t } = useTranslation('terminology');
  const k = (key: string, opts?: Record<string, unknown>) => t(`accountStatement.currencyStrips.${key}`, opts);
  const debitSide = isSupplier ? t('accountStatement.creditToSupplier') : t('accountStatement.totalDebit');
  const creditSide = isSupplier ? t('accountStatement.debitToUs') : t('accountStatement.totalCredit');

  return (
    <div className="p-6 border-b border-slate-200 bg-white" data-testid="currency-strips">
      <h4 className="text-lg font-bold text-slate-900 mb-3">{k('title')}</h4>
      {loading && <p className="text-sm text-slate-400">…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!loading && !error && strips.length === 0 && <p className="text-sm text-slate-400">—</p>}
      {!loading && !error && strips.length > 0 && (
        <div className="space-y-2">
          {strips.map((s) => {
            const closingAbs = Math.abs(s.closingBalance);
            const side = s.closingBalance >= 0 ? debitSide : creditSide;
            return (
              <div key={s.currency} className="border border-slate-200 rounded-lg bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs text-slate-600">
                  <span className="font-bold text-slate-900 text-sm min-w-[3rem]">{s.currency}</span>
                  <span>{k('opening')}: <b className="font-mono">{money(s.openingBalance)}</b></span>
                  <span>{k('debit')}: <b className="font-mono">{money(s.debit)}</b></span>
                  <span>{k('credit')}: <b className="font-mono">{money(s.credit)}</b></span>
                  <span className="text-sm font-bold text-indigo-700">
                    {k('closing')}: {money(closingAbs)} {s.currency}{' '}
                    <span className="text-[11px] font-normal text-slate-500">({side})</span>
                  </span>
                </div>
                {s.pendingChecksTotal > 0 && (
                  <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900" data-testid="pending-checks">
                    <div>
                      شيكات قيد التحصيل: <b className="font-mono">{money(s.pendingChecksTotal)} {s.currency}</b>
                      {' — '}الرصيد المتوقع بعد التحصيل: <b className="font-mono">{money(Math.abs(s.expectedBalance))} {s.currency}</b>
                      <span className="text-[11px] text-amber-700"> ({s.expectedBalance >= 0 ? debitSide : creditSide})</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-amber-800">
                      {s.pendingChecks.map((c) => `${c.checkNo} / ${c.bankName} / ${c.dueDate} / ${money(c.amount)}`).join('  •  ')}
                    </div>
                  </div>
                )}
                {s.conversion && (
                  <div className="mt-1 text-[12px] text-blue-800">
                    {k('rateLine', {
                      amount: money(closingAbs),
                      from: s.currency,
                      rate: s.conversion.rate.toLocaleString(undefined, { maximumFractionDigits: 4 }),
                      converted: money(Math.abs(s.conversion.converted)),
                      to: s.conversion.toCurrency,
                    })}
                  </div>
                )}
                {s.missingRate && <div className="mt-1 text-[12px] text-amber-700">{k('missingRate')}</div>}
              </div>
            );
          })}
          <p className="text-[11px] text-slate-400">{k('separateNote')}</p>
        </div>
      )}
    </div>
  );
};
