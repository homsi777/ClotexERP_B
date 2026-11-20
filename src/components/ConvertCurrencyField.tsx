import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export type CurrencyConversion = { enabled: boolean; code: string; rate: string };
export const NO_CONVERSION: CurrencyConversion = { enabled: false, code: '', rate: '' };

/** السعر الافتراضي: كم وحدة من العملة الهدف تساوي وحدة واحدة من عملة السند (من أسعار الصرف مقابل الدولار). */
function defaultRate(rates: { currency_code: string; exchange_rate_to_usd: string | number }[], from: string, to: string): string {
  const per = (code: string) => (code === 'USD' ? 1 : Number(rates.find((r) => r.currency_code === code)?.exchange_rate_to_usd));
  const a = per(from), b = per(to);
  return Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0 ? String(Math.round((b / a) * 1e6) / 1e6) : '';
}

/**
 * مفتاح «التحويل بسعر الصرف» (معطّل افتراضياً): المبلغ يبقى بعملته الأصلية، وعند التفعيل يُحفظ ويُعرض مكافئه
 * بعملة أخرى بالسعر المحدد (بالسند وكشف الحساب). لا يغيّر الأرصدة.
 */
export const ConvertCurrencyField: React.FC<{
  amount: number;
  currencyCode: string;
  rates: { currency_code: string; exchange_rate_to_usd: string | number }[];
  value: CurrencyConversion;
  onChange: (v: CurrencyConversion) => void;
}> = ({ amount, currencyCode, rates, value, onChange }) => {
  const { t } = useTranslation('common');
  const options = useMemo(() => [...new Set(['USD', ...rates.map((r) => r.currency_code)])].filter((c) => c !== currencyCode), [rates, currencyCode]);
  // تغيّرت عملة السند: يُعاد ضبط التحويل.
  useEffect(() => { if (value.enabled) onChange(NO_CONVERSION); }, [currencyCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const rateNum = Number(value.rate);
  const converted = value.enabled && rateNum > 0 ? Math.round(amount * rateNum * 100) / 100 : null;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => {
            if (!e.target.checked) { onChange(NO_CONVERSION); return; }
            const code = options[0] ?? '';
            onChange({ enabled: true, code, rate: code ? defaultRate(rates, currencyCode, code) : '' });
          }}
        />
        {t('convert.toggle')}
      </label>
      {value.enabled && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            className="rounded-lg border border-slate-200 bg-white p-2.5"
            value={value.code}
            onChange={(e) => onChange({ enabled: true, code: e.target.value, rate: defaultRate(rates, currencyCode, e.target.value) })}
          >
            {options.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="number"
            step="0.000001"
            className="rounded-lg border border-slate-200 bg-white p-2.5 text-left font-mono"
            dir="ltr"
            placeholder={t('convert.rate', { from: currencyCode, to: value.code })}
            value={value.rate}
            onChange={(e) => onChange({ ...value, rate: e.target.value })}
          />
          {converted !== null && (
            <p className="text-xs font-bold text-emerald-700 sm:col-span-2">
              {t('convert.result', { amount: amount.toLocaleString('en-US'), from: currencyCode, converted: converted.toLocaleString('en-US'), to: value.code })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export const conversionPayload = (v: CurrencyConversion) => {
  const rate = Number(v.rate);
  return v.enabled && v.code && rate > 0 ? { convertToCurrencyCode: v.code, convertRate: rate } : {};
};
