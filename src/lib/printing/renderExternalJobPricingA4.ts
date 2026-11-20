import type { ManufacturingOverview } from '../api/externalManufacturingApi';
import { BRAND } from '../../branding';
import i18n from '../../i18n/config';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: unknown, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

/**
 * إرسالية الأرشفة = فاتورة تسعير بين المنشأة والمصبغة بعد انتهاء الاستلام والتسوية والتسعير:
 * ما أُرسل، ما استُلم، التسويات بأسبابها، خدمات المصبغة وأسعارها، والإجمالي، وتوقيع الطرفين.
 */
export function renderExternalJobPricingA4Html(opts: { data: ManufacturingOverview; lang: 'ar' | 'tr' }): string {
  const { data, lang } = opts;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const t = (key: string, o?: Record<string, unknown>) => i18n.t(key, { ns: 'externalJobs', lng: lang, ...o });
  const job = data.job;
  const sent = data.lines.reduce((n, l) => n + Number(l.sent_length_m), 0);
  const received = data.lines.reduce((n, l) => n + Number(l.returned_m), 0);
  const shortage = data.lines.reduce((n, l) => n + Number(l.shortage_m), 0);
  const excess = data.lines.reduce((n, l) => n + Number(l.excess_m), 0);
  const kg = data.batches.flatMap((b) => b.lines).reduce((n, l) => n + (Number(l.weight_kg) || 0), 0);
  const rollsReceived = data.batches.reduce((n, b) => n + b.lines.length, 0);

  const serviceRows = data.services.map((s, i) => `
    <tr><td class="c">${i + 1}</td><td>${esc(s.name)}</td>
    <td class="c">${esc(t(`lifecycle.basisName.${s.basis}`))}</td>
    <td class="c n">${s.basis === 'FIXED' ? '1' : num(s.approved_quantity ?? s.quantity, 3)}</td>
    <td class="c n">${num(s.unit_price, 4)}</td><td class="c">${esc(s.currency_code ?? '')}</td>
    <td class="c n">${num(s.unit_price != null ? Number(s.unit_price) * Number(s.basis === 'FIXED' ? 1 : s.approved_quantity ?? s.quantity) : null, 2)}</td></tr>`).join('');
  const settleRows = data.settlements.map((s) => `
    <tr><td>${esc(t(`lifecycle.reasonCat.${s.reason_category ?? s.kind}`))}</td><td class="c n">${num(s.amount_m, 3)}</td><td>${esc(s.reason)}</td></tr>`).join('');
  const batchRows = data.batches.map((b) => `
    <tr><td class="c">${esc(b.dye_paper_no)}</td><td class="c">${esc(String(b.received_at).slice(0, 10))}</td>
    <td class="c">${b.lines.length}</td><td class="c n">${num(b.lines.reduce((n, l) => n + Number(l.length_m), 0), 3)}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8"/><title>${esc(job.job_no)}</title>
<style>
@page{size:A4 portrait;margin:0}*{box-sizing:border-box;margin:0;padding:0}
html,body{width:210mm;font-family:Tahoma,Arial,sans-serif;color:#111;background:#fff;direction:${dir};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;padding:10mm}
.brand{text-align:center;padding-bottom:4mm;border-bottom:.4mm solid #333;margin-bottom:4mm}.brand img{height:16mm;object-fit:contain}
h1{text-align:center;font-size:15pt;margin:2mm 0 5mm}h2{font-size:11pt;margin:5mm 0 2mm;color:#2C405A}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:2mm 6mm;font-size:10pt;margin-bottom:3mm}.meta b{color:#555}
table{width:100%;border-collapse:collapse;font-size:9.5pt}th{background:#2C405A;color:#fff;padding:2mm;text-align:${dir === 'rtl' ? 'right' : 'left'}}
td{border:.2mm solid #ccc;padding:1.8mm}.c{text-align:center}.n{font-family:monospace}
.tot{margin-top:4mm;border:.5mm solid #2C405A;padding:3mm;font-size:12pt;font-weight:700;display:flex;justify-content:space-between}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:12mm;margin-top:14mm;font-size:10pt}.sign .l{font-weight:700;color:#555;margin-bottom:10mm}.sign .line{border-bottom:.3mm solid #999;height:8mm}
</style></head><body><div class="page">
<div class="brand"><img src="${BRAND.logoInline}" alt="${esc(BRAND.name)}"/></div>
<h1>${esc(t('pricingPrint.title'))}</h1>
<div class="meta">
<div><b>${esc(t('print.dispatchNo'))}:</b> ${esc(job.job_no)}</div>
<div><b>${esc(t('print.date'))}:</b> ${esc(String(job.sent_date ?? '').slice(0, 10))}</div>
<div><b>${esc(t('print.party'))}:</b> ${esc(job.supplier_name)}</div>
<div><b>${esc(t('pricingPrint.printedOn'))}:</b> ${esc(new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'tr-TR'))}</div>
</div>
<h2>${esc(t('pricingPrint.quantities'))}</h2>
<table><tbody>
<tr><td>${esc(t('lifecycle.totalSent'))}</td><td class="c n">${num(sent, 3)}</td><td>${esc(t('lifecycle.totalReceived'))}</td><td class="c n">${num(received, 3)} (${rollsReceived} ${esc(t('pricingPrint.rolls'))} / ${num(kg, 2)} ${esc(t('pricingPrint.kg'))})</td></tr>
<tr><td>${esc(t('pricingPrint.settledShortage'))}</td><td class="c n">${num(shortage, 3)}</td><td>${esc(t('pricingPrint.excess'))}</td><td class="c n">${num(excess, 3)}</td></tr>
</tbody></table>
${batchRows ? `<h2>${esc(t('pricingPrint.batches'))}</h2><table><thead><tr><th>${esc(t('lifecycle.dyePaper'))}</th><th>${esc(t('print.date'))}</th><th>${esc(t('pricingPrint.rolls'))}</th><th>${esc(t('pricingPrint.meters'))}</th></tr></thead><tbody>${batchRows}</tbody></table>` : ''}
${settleRows ? `<h2>${esc(t('pricingPrint.settlements'))}</h2><table><thead><tr><th>${esc(t('lifecycle.settlementType'))}</th><th>${esc(t('pricingPrint.meters'))}</th><th>${esc(t('lifecycle.settlementReason'))}</th></tr></thead><tbody>${settleRows}</tbody></table>` : ''}
<h2>${esc(t('pricingPrint.services'))}</h2>
<table><thead><tr><th>#</th><th>${esc(t('pricingPrint.service'))}</th><th>${esc(t('lifecycle.basis'))}</th><th>${esc(t('lifecycle.approvedQuantity'))}</th><th>${esc(t('lifecycle.unitPrice'))}</th><th>${esc(t('lifecycle.currency'))}</th><th>${esc(t('pricingPrint.lineTotal'))}</th></tr></thead><tbody>${serviceRows}</tbody></table>
<div class="tot"><span>${esc(t('pricingPrint.totalFee'))}</span><span class="n">${job.fee_amount != null ? `${num(job.fee_amount, 2)} ${esc(job.fee_currency_code ?? 'USD')}` : '—'}</span></div>
<div class="sign"><div><div class="l">${esc(t('pricingPrint.ourSignature'))}</div><div class="line"></div></div><div><div class="l">${esc(t('pricingPrint.partySignature', { name: job.supplier_name }))}</div><div class="line"></div></div></div>
</div></body></html>`;
}
