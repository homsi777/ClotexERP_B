import { BRAND } from '../../branding';
import type { RollLabelPreviewDto } from '../api/labelsApi';
import { documentFooterStyles, renderDocumentFooterHtml } from './renderDocumentFooter';

export interface ReceiptRollsSlipData {
  receiptNo: string;
  supplierName?: string | null;
  invoiceNo?: string | null;
  warehouseName?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  rolls: RollLabelPreviewDto[];
}

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number | null | undefined, d = 2): string =>
  v == null || !Number.isFinite(Number(v)) ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** الكمية الرئيسية للتوب: كيلو للمُدخل بالوزن، وإلا أمتار. */
export const rollMainQty = (r: RollLabelPreviewDto): { value: number | null; unit: 'm' | 'kg' } =>
  r.entryBasis === 'WEIGHT' ? { value: r.actualWeightKg ?? null, unit: 'kg' } : { value: r.lengthM ?? null, unit: 'm' };

/** إرسالية استلام: كشف A4 بالأتواب المُدخلة في إيصال الاستلام (الباركود، المادة، اللون، الكمية). */
export function renderReceiptRollsA4Html(d: ReceiptRollsSlipData): string {
  const color = BRAND.primaryColor;
  let totM = 0, totKg = 0;
  const rows = d.rolls.map((r, i) => {
    const q = rollMainQty(r);
    if (q.unit === 'm') totM += q.value ?? 0; else totKg += q.value ?? 0;
    const wKg = q.unit === 'm' ? (r.actualWeightKg ?? r.calculatedWeightKg) : null;
    return `<tr><td>${i + 1}</td><td class="mono">${esc(r.barcode)}</td><td>${esc(r.itemName)}</td><td>${esc(r.internalCode)}</td><td>${esc(r.colorNameAr || r.colorNameTr)}</td><td class="mono">${esc(r.colorCode)}</td><td class="mono">${q.unit === 'm' ? num(q.value) : ''}</td><td class="mono">${q.unit === 'kg' ? num(q.value) : num(wKg)}</td></tr>`;
  }).join('');
  const sum = [totM > 0 ? `<span class="mono">${num(totM)} m</span>` : '', totKg > 0 ? `<span class="mono">${num(totKg)} kg</span>` : ''].filter(Boolean).join(' &nbsp;+&nbsp; ');
  const when = d.createdAt ? new Date(d.createdAt).toLocaleString('en-GB') : '';
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إرسالية استلام ${esc(d.receiptNo)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4 portrait;margin:0}
html,body{width:210mm;font-family:'Segoe UI','Noto Sans Arabic',Arial,sans-serif;color:#1f1f1f;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;display:flex;flex-direction:column;padding:8mm 10mm 6mm}
.body{flex:1 1 auto}
.head{display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid ${BRAND.accentColor ?? '#B89854'};padding-bottom:6px;margin-bottom:8px}
.title{font-size:24px;font-weight:900;color:${color}}
.sub{font-size:12px;margin-top:3px}
.logo{height:87px;width:auto;object-fit:contain}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 12px;font-size:12px;margin:8px 0 10px}
.meta b{color:${color}}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:${color};color:#fff;padding:6px 5px;font-weight:900;text-align:center}
td{padding:5px;border-bottom:1px solid #ece7f6;text-align:center}
tr:nth-child(even) td{background:#f7f4fc}
.mono{font-family:Consolas,monospace;direction:ltr}
.tot{margin-top:10px;border:1px solid ${color};background:#f1edfa;color:${color};font-weight:900;font-size:14px;padding:8px 12px;display:flex;justify-content:space-between}
.sign{display:flex;gap:16px;margin-top:22px}.sign div{flex:1;border:1px solid #ddd5ee;padding:8px 10px 26px;font-size:11px;font-weight:900;color:${color}}
${documentFooterStyles(color, BRAND.accentColor ?? '#B89854')}
</style></head><body><div class="page"><div class="body">
<div class="head"><div><div class="title">إرسالية استلام</div><div class="sub" dir="ltr" style="text-align:right">${esc(d.receiptNo)}</div></div><img class="logo" src="${BRAND.logoInline}" alt="${esc(BRAND.name)}"/></div>
<div class="meta"><div><b>المورد:</b> ${esc(d.supplierName) || '—'}</div><div><b>فاتورة المورد:</b> ${esc(d.invoiceNo) || '—'}</div><div><b>المستودع:</b> ${esc(d.warehouseName) || '—'}</div><div><b>التاريخ:</b> ${esc(when)}</div><div><b>المُدخِل:</b> ${esc(d.createdBy) || '—'}</div><div><b>عدد الأتواب:</b> ${d.rolls.length}</div></div>
<table><thead><tr><th>#</th><th>الباركود</th><th>المادة</th><th>كود الخامة</th><th>اللون</th><th>كود اللون</th><th>الأمتار</th><th>الوزن (كغ)</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><span>الإجمالي — ${d.rolls.length} توب</span><span>${sum}</span></div>
<div class="sign"><div>أمين المستودع</div><div>المستلم</div></div>
</div>${renderDocumentFooterHtml('invoice')}</div></body></html>`;
}
