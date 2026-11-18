import type { CurrencyStrip } from '../statements/currencySummary';

export type CurrencyStripsLabels = {
  title: string;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  debitSide: string;
  creditSide: string;
  rateLine: (p: { amount: string; from: string; rate: string; converted: string; to: string }) => string;
  missingRate: string;
  separateNote: string;
};

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const num = (n: number, locale: string, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '0.00';

/** معدّل الصرف: أقصى 4 خانات عشرية بلا أصفار زائدة (50 → "50"، 0.0033 → "0.0033"). */
const rateText = (n: number, locale: string) =>
  Number.isFinite(n) ? n.toLocaleString(locale, { maximumFractionDigits: 4 }) : '—';

/**
 * TASK 010 — قسم "شرائط العملات" لقوالب طباعة/PDF كشف العميل والمورّد.
 * عرض فقط: كل عملة بشريطها المستقل، ولا يوجد إجمالي موحَّد عبر العملات.
 * يُرجع سلسلة فارغة إن لم توجد شرائط، فلا يتغير شكل أي كشف بلا بيانات.
 */
export function renderCurrencyStripsHtml(
  strips: CurrencyStrip[],
  labels: CurrencyStripsLabels,
  locale = 'ar',
): string {
  if (!strips.length) return '';
  const rows = strips
    .map((s) => {
      const side = s.closingBalance >= 0 ? labels.debitSide : labels.creditSide;
      const closingAbs = Math.abs(s.closingBalance);
      let conversionLine = '';
      if (s.conversion) {
        conversionLine = `<div class="cs-conv">${esc(
          labels.rateLine({
            amount: num(closingAbs, locale),
            from: s.currency,
            rate: rateText(s.conversion.rate, locale),
            converted: num(Math.abs(s.conversion.converted), locale),
            to: s.conversion.toCurrency,
          }),
        )}</div>`;
      } else if (s.missingRate) {
        conversionLine = `<div class="cs-conv cs-warn">${esc(labels.missingRate)}</div>`;
      }
      return `<div class="cs-strip">
        <div class="cs-cur">${esc(s.currency)}</div>
        <div class="cs-cell"><span>${esc(labels.opening)}</span><b>${num(s.openingBalance, locale)}</b></div>
        <div class="cs-cell"><span>${esc(labels.debit)}</span><b>${num(s.debit, locale)}</b></div>
        <div class="cs-cell"><span>${esc(labels.credit)}</span><b>${num(s.credit, locale)}</b></div>
        <div class="cs-cell cs-final"><span>${esc(labels.closing)} (${esc(side)})</span><b>${num(closingAbs, locale)} ${esc(s.currency)}</b></div>
        ${conversionLine}
      </div>`;
    })
    .join('');
  return `<style>
    .cs-wrap{margin:10px 0 14px;page-break-inside:avoid;direction:rtl}
    .cs-title{font-weight:700;font-size:12px;margin-bottom:6px}
    .cs-strip{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;border:1px solid #cbd5e1;border-radius:6px;padding:6px 10px;margin-bottom:5px;font-size:11px}
    .cs-cur{font-weight:700;min-width:44px}
    .cs-cell{display:flex;gap:6px;align-items:baseline}
    .cs-cell span{color:#475569}
    .cs-final b{font-size:12px}
    .cs-conv{flex-basis:100%;font-size:11px;color:#1e3a8a}
    .cs-warn{color:#b45309}
    .cs-note{font-size:10px;color:#64748b;margin-top:2px}
  </style>
  <div class="cs-wrap">
    <div class="cs-title">${esc(labels.title)}</div>
    ${rows}
    <div class="cs-note">${esc(labels.separateNote)}</div>
  </div>`;
}
