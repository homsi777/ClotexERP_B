/** ألوان دقيقة عند الطباعة (نسخة محلية صغيرة لإبقاء المصيّر بلا اعتماديات ثقيلة وقابلاً للاختبار). */
const PRINT_COLOR_EXACT_CSS = `
  html, body, * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
`;

/**
 * سند تسليم كارتيلات (A5 أفقي، بهوية clotex الأرجوانية) — ملاحظة بشير: تحسين شكل السند.
 * أعمدة الجدول من اليمين: الباركود، الكارتيلة، الكود، اللون، العدد، موعد الإرجاع. يُنتج HTML كاملاً للمعاينة والطباعة.
 */
export type CartelaDeliveryVoucherRow = {
  barcode: string;
  cartelaTitle: string;
  artCode: string;
  colorName: string | null;
  qty: number;
  dueDate: string | null;
};

export type CartelaDeliveryVoucherData = {
  voucherNo: string;
  customerName: string;
  deliveryDate: string;
  notes?: string | null;
  rows: CartelaDeliveryVoucherRow[];
  /** مصدر الشعار (data URI) واسم العلامة — يمرّرهما المستدعي من ملف الهوية. */
  logoSrc?: string;
  brandName?: string;
};

export type CartelaDeliveryVoucherLabels = {
  title: string;
  customer: string;
  deliveryDate: string;
  barcode: string;
  cartela: string;
  code: string;
  color: string;
  qty: string;
  dueDate: string;
  dueUndefined: string;
  notes: string;
  receiverSignature: string;
  total: string;
};

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** YYYY-MM-DD → DD-MM-YYYY (أرقام لاتينية ثابتة مهما كانت لغة الجهاز). */
const fmtDate = (ymd: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ymd ?? '');
};

const PURPLE = '#6B3A9E';
const PURPLE_SOFT = '#F4EEFA';

export function renderCartelaDeliveryVoucherHtml(data: CartelaDeliveryVoucherData, L: CartelaDeliveryVoucherLabels): string {
  const totalQty = data.rows.reduce((n, r) => n + r.qty, 0);
  const rows = data.rows
    .map(
      (r, i) => `<tr${i % 2 ? ` class="alt"` : ''}>
        <td class="ltr">${esc(r.barcode)}</td>
        <td class="strong">${esc(r.cartelaTitle)}</td>
        <td>${esc(r.artCode || '—')}</td>
        <td>${esc(r.colorName || '—')}</td>
        <td class="num">${r.qty}</td>
        <td>${r.dueDate ? `<span class="ltr">${esc(fmtDate(r.dueDate))}</span>` : esc(L.dueUndefined)}</td>
      </tr>`,
    )
    .join('');
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8" />
<title>${esc(L.title)} ${esc(data.voucherNo)}</title>
<style>
  @page { size: A5 landscape; margin: 7mm; }
  ${PRINT_COLOR_EXACT_CSS}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #111; background: #fff; }
  .page { width: 100%; padding: 4mm 6mm; }
  .head { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  .head td { vertical-align: top; }
  .logo { height: 24mm; max-width: 73mm; object-fit: contain; }
  .title { font-size: 22pt; font-weight: 800; line-height: 1.1; margin: 0; }
  .vno { font-size: 17pt; font-weight: 800; margin: 1mm 0 3mm; direction: ltr; text-align: right; }
  .meta { font-size: 11pt; }
  .meta b { font-weight: 800; }
  .meta .sep { display: inline-block; width: 0.6mm; height: 5mm; background: ${PURPLE}; margin: 0 4mm; vertical-align: middle; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 2mm; font-size: 10.5pt; }
  table.items th { background: ${PURPLE}; color: #fff; padding: 2.4mm 2mm; text-align: center; font-weight: 800; border: 0.3mm solid ${PURPLE}; }
  table.items td { padding: 2.4mm 2mm; text-align: center; border: 0.3mm solid ${PURPLE}; }
  table.items tr.alt td { background: ${PURPLE_SOFT}; }
  table.items td.strong { font-weight: 700; }
  table.items td.num { font-weight: 800; }
  .ltr { direction: ltr; unicode-bidi: embed; display: inline-block; }
  .totals { margin-top: 2mm; font-size: 10.5pt; font-weight: 800; text-align: left; color: ${PURPLE}; }
  .notes { margin-top: 3mm; font-size: 10pt; color: #333; }
  .sign { margin-top: 12mm; font-size: 12pt; font-weight: 700; }
  .sign .line { display: inline-block; width: 62mm; border-bottom: 0.3mm solid #111; margin-right: 3mm; vertical-align: bottom; height: 6mm; }
  @media screen { body { padding: 4mm; } }
</style>
</head>
<body>
<div class="page">
  <table class="head"><tr>
    <td style="width:34%;text-align:left;">${data.logoSrc ? `<img class="logo" src="${esc(data.logoSrc)}" alt="${esc(data.brandName ?? '')}" />` : ''}</td>
    <td style="width:66%;text-align:right;">
      <h1 class="title">${esc(L.title)}</h1>
      <div class="vno">${esc(data.voucherNo)}</div>
      <div class="meta">${esc(L.customer)}: <b>${esc(data.customerName)}</b><span class="sep"></span>${esc(L.deliveryDate)}: <b class="ltr">${esc(fmtDate(data.deliveryDate))}</b></div>
    </td>
  </tr></table>
  <table class="items">
    <thead><tr>
      <th>${esc(L.barcode)}</th><th>${esc(L.cartela)}</th><th>${esc(L.code)}</th><th>${esc(L.color)}</th><th>${esc(L.qty)}</th><th>${esc(L.dueDate)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">${esc(L.total)}: ${totalQty}</div>
  ${data.notes ? `<div class="notes"><b>${esc(L.notes)}:</b> ${esc(data.notes)}</div>` : ''}
  <div class="sign">${esc(L.receiverSignature)}: <span class="line"></span></div>
</div>
</body>
</html>`;
}
