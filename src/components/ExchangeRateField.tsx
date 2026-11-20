import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * سعر الصرف اختياري بزر تفعيل (ملاحظة بشير):
 *  - مطفأ (الافتراضي): يُستعمل آخر سعر معتمد للعملة تلقائياً ولا يظهر حقل إدخال.
 *  - مفعّل: يدخل المستخدم سعراً يدوياً لهذه المعاملة فقط.
 * العملة الأساسية (USD) لا تحتاج سعراً فلا يُعرض شيء.
 */
export function resolveExchangeRate(opts: {
  currencyCode: string;
  manual: boolean;
  manualValue: string;
  storedRate: number | null;
  normalize: (v: string) => number | null;
}): number | null {
  if (opts.currencyCode === 'USD') return 1;
  if (opts.manual) return opts.normalize(opts.manualValue);
  return opts.storedRate !== null && opts.storedRate > 0 ? opts.storedRate : null;
}

export const ExchangeRateField: React.FC<{
  currencyCode: string;
  storedRate: number | null;
  manual: boolean;
  onManualChange: (manual: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  inputClassName?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}> = ({ currencyCode, storedRate, manual, onManualChange, value, onValueChange, inputClassName, onKeyDown }) => {
  const { t } = useTranslation('common');
  if (currencyCode === 'USD') return null;
  return (
    <div className="space-y-1">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => {
            onManualChange(e.target.checked);
            if (e.target.checked && storedRate !== null) onValueChange(String(storedRate));
          }}
        />
        {t('rate.manualToggle')}
      </label>
      {manual ? (
        <input
          type="number"
          step="0.000001"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          className={inputClassName ?? 'w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-left'}
          dir="ltr"
        />
      ) : storedRate !== null ? (
        <p className="text-xs text-slate-500">
          {t('rate.autoHint', { code: currencyCode, rate: storedRate })}
        </p>
      ) : (
        <p className="text-xs font-bold text-rose-600">{t('rate.noStored', { code: currencyCode })}</p>
      )}
    </div>
  );
};
