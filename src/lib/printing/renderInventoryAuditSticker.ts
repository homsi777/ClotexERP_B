const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface AuditStickerColor { name: string; code: string; meters: number }
export interface AuditStickerInput {
  materialName: string; baseCode: string; cartelaCode: string; date?: Date; colors: AuditStickerColor[]; widthMm?: number;
}

/**
 * كود الكارتيلة يظهر أعلى الستيكر، فيظهر بسطر اللون الجزء المتغير فقط: «0004-V-8» ← «-V-8» دون تكرار «0004».
 * إن لم يبدأ الكود بكود الكارتيلة يُعرض كاملاً (لا نخترع جزءاً).
 */
export function variableColorCode(fullCode: string, cartelaCode: string): string {
  const code = String(fullCode ?? '').trim(), base = String(cartelaCode ?? '').trim();
  if (!code) return '—';
  return base && code.toLowerCase().startsWith(base.toLowerCase()) && code.length > base.length ? code.slice(base.length) : code;
}

/** ستيكر الجرد: طوله يتبع عدد الألوان، والأسماء والأكواد والكميات كاملة بخط مقروء (لا قص ولا تصغير). */
export function renderInventoryAuditSticker(i: AuditStickerInput): { html: string; widthMm: number; heightMm: number } {
  const w = i.widthMm ?? 72;
  const date = (i.date ?? new Date()).toLocaleDateString('en-GB');
  const lineMm = 6.2, headMm = 27;
  const heightMm = Math.ceil(headMm + i.colors.length * lineMm + 5);
  const rows = i.colors.map((c) => `<tr><td class="n">${esc(c.name)}</td><td class="c">${esc(variableColorCode(c.code, i.cartelaCode))}</td><td class="m">${fmt(c.meters)} م</td></tr>`).join('');
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>ستيكر جرد</title><style>
@page{size:${w}mm ${heightMm}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}mm;background:#fff;color:#000;font-family:Tahoma,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.s{width:${w - 4}mm;margin:0 auto;padding:1.5mm 0}
.t{font-size:10.5pt;font-weight:900;text-align:center;line-height:1.25;word-break:break-word}
.k{display:flex;justify-content:space-between;gap:2mm;font-size:8pt;font-weight:700;border-top:.3mm solid #000;margin-top:1mm;padding-top:.8mm}
.k b{font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed;font-size:9pt}
table{width:100%;border-collapse:collapse;margin-top:1.2mm}
td{border-top:.2mm solid #555;padding:.9mm .5mm;font-size:9.5pt;font-weight:700;vertical-align:middle}
td.n{text-align:right}td.c{text-align:center;font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed;font-size:9pt}
td.m{text-align:left;font-weight:900;font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed;white-space:nowrap}
</style></head><body><div class="s">
<div class="t">${esc(i.materialName)}</div>
<div class="k"><span>كود الخامة <b>${esc(i.baseCode || '—')}</b></span><span>الكارتيلة <b>${esc(i.cartelaCode || '—')}</b></span></div>
<div class="k"><span>تاريخ الجرد</span><b>${date}</b></div>
<table><tbody>${rows}</tbody></table>
</div></body></html>`;
  return { html, widthMm: w, heightMm };
}
