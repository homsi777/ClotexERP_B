import i18n from '../../i18n/config';
import { arAccountingCreditSide, arAccountingDebitSide } from '../i18n/arTerminology';
import type { CurrencyStrip } from '../statements/currencySummary';
import { renderCurrencyStripsHtml, type CurrencyStripsLabels } from './currencyStripsHtml';

const tt = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`accountStatement.currencyStrips.${key}`, { ns: 'terminology', ...options });

/** TASK 010: HTML قسم الشرائط بتسميات اللغة الحالية — يُمرَّر لقوالب طباعة/PDF الكشف. */
export function buildCurrencyStripsHtmlForStatement(strips: CurrencyStrip[], isSupplier = false): string {
  const labels: CurrencyStripsLabels = {
    title: tt('title'),
    opening: tt('opening'),
    debit: tt('debit'),
    credit: tt('credit'),
    closing: tt('closing'),
    debitSide: isSupplier ? i18n.t('accountStatement.creditToSupplier', { ns: 'terminology' }) : arAccountingDebitSide(),
    creditSide: isSupplier ? i18n.t('accountStatement.debitToUs', { ns: 'terminology' }) : arAccountingCreditSide(),
    rateLine: (p) => tt('rateLine', p),
    missingRate: tt('missingRate'),
    separateNote: tt('separateNote'),
  };
  return renderCurrencyStripsHtml(strips, labels, i18n.language === 'ar' ? 'ar' : 'tr');
}
