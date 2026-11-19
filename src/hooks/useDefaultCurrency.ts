import { useEffect, useRef, useState } from 'react';
import { fetchMe } from '../lib/api/authApi';

/**
 * ملاحظة مدير بشير: العملة الافتراضية للمعاملات بفرع مصر = الجنيه (مع السماح بتغييرها).
 * تأتي من إعداد الفرع (/auth/me → companyDefaultCurrency). نخزّن الطلب مؤقتاً بالذاكرة ليُشارَك بين النماذج،
 * ونفرّغه عند تبديل الفرع (clearDefaultCurrencyCache).
 */
let cache: Promise<string> | null = null;

export function clearDefaultCurrencyCache(): void {
  cache = null;
}

function loadDefaultCurrency(): Promise<string> {
  if (!cache) {
    cache = fetchMe()
      .then((u) => (u.companyDefaultCurrency || 'USD').toUpperCase())
      .catch(() => {
        cache = null; // لا نخزّن الفشل
        return 'USD';
      });
  }
  return cache;
}

/** العملة الافتراضية للفرع الحالي ('USD' حتى تصل أو إن لم تُضبط). */
export function useDefaultCurrency(): { defaultCurrency: string; loaded: boolean } {
  const [state, setState] = useState<{ defaultCurrency: string; loaded: boolean }>({ defaultCurrency: 'USD', loaded: false });
  useEffect(() => {
    let cancelled = false;
    void loadDefaultCurrency().then((c) => {
      if (!cancelled) setState({ defaultCurrency: c, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * حالة عملة نموذج: تبدأ USD ثم تتبنّى عملة الفرع الافتراضية فور وصولها — فقط إن لم يغيّرها المستخدم يدوياً.
 * `allowed` يحصر القيم المقبولة (نماذج تدعم قائمة عملات محدودة)؛ خارجها يبقى USD.
 */
export function useCurrencyWithBranchDefault<T extends string = string>(allowed?: readonly T[]): [T, (v: T) => void] {
  const { defaultCurrency, loaded } = useDefaultCurrency();
  const [value, setValue] = useState<T>('USD' as T);
  const touched = useRef(false);
  useEffect(() => {
    if (!loaded || touched.current) return;
    const ok = !allowed || (allowed as readonly string[]).includes(defaultCurrency);
    if (ok) setValue(defaultCurrency as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, defaultCurrency]);
  return [
    value,
    (v: T) => {
      touched.current = true;
      setValue(v);
    },
  ];
}
