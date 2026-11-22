import { buildCode128Svg } from './renderCartelaLabel';
import { code128WidthMm } from './code128Width';

/** ملصق اللون الفرعي للكارتيلة: 5×2.5 سم (50×25 مم) = كود الخامة / كود اللون / باركود — دون اسم الخامة (ملاحظة بشير). */
export const CARTELA_COLOR_LABEL_WIDTH_MM = 50;
export const CARTELA_COLOR_LABEL_HEIGHT_MM = 25;

export type CartelaColorLabelCell = {
  materialCode: string;
  colorCode: string;
  barcodeCode: string;
};

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function labelHtml(cell: CartelaColorLabelCell): string {
  const bc = cell.barcodeCode.trim();
  const svg = bc ? buildCode128Svg(bc, 40, true) : '';
  return `<div class="label">
    <div class="mat" dir="ltr">${esc(cell.materialCode)}</div>
    <div class="col" dir="ltr">${esc(cell.colorCode)}</div>
    <div class="bc"><div class="bcw" style="width:${code128WidthMm(bc)}mm">${svg}</div></div>
    <div class="bt" dir="ltr">${esc(cell.barcodeCode)}</div>
  </div>`;
}

const PAGE_BREAK = 'page-break-after: always; break-after: page;';

const css = `
  @page { size: ${CARTELA_COLOR_LABEL_WIDTH_MM}mm ${CARTELA_COLOR_LABEL_HEIGHT_MM}mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; }
  .label {
    width: ${CARTELA_COLOR_LABEL_WIDTH_MM}mm; height: ${CARTELA_COLOR_LABEL_HEIGHT_MM}mm;
    padding: 1.2mm 2mm 1mm; overflow: hidden; text-align: center;
    display: flex; flex-direction: column; justify-content: space-between;
    ${PAGE_BREAK}
  }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .mat { font-size: 9pt; font-weight: 700; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .col { font-size: 12pt; font-weight: 900; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bc { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .bcw { height: 9mm; }
  .bc svg { width: 100%; height: 100%; display: block; }
  .bt { font-size: 7pt; font-weight: 700; letter-spacing: 0.4px; line-height: 1.1; text-align: center; font-family: monospace; white-space: nowrap; overflow: hidden; }
`;

/** صفحة واحدة 50×25 لكل ملصق؛ copies = عدد النسخ لكل لون. */
export function buildCartelaColorLabelsHtml(cells: CartelaColorLabelCell[], copies = 1): string {
  const n = Math.max(1, Math.min(20, Math.round(copies) || 1));
  const labels = cells.flatMap((c) => Array.from({ length: n }, () => labelHtml(c))).join('');
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body>${labels}</body></html>`;
}

/** معاينة على الشاشة: كل ملصق بإطار متقطع ليظهر حجمه. */
export function buildCartelaColorLabelsPreviewHtml(cells: CartelaColorLabelCell[]): string {
  const labels = cells
    .slice(0, 12)
    .map((c) => `<div style="display:inline-block;margin:6px;border:1px dashed #94a3b8;background:#fff">${labelHtml(c)}</div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace(PAGE_BREAK, '')} body{background:#f1f5f9;padding:6px}</style></head><body>${labels}</body></html>`;
}
