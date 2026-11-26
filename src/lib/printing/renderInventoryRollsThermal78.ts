import type { FabricRollDto } from '../api/fabricRollsApi';
import { displayImportedColorCode, displayImportedColorName } from '../importDisplay';
import { getRollLengthMeters } from '../inventory/rollAvailability';
import { clampFontScale } from './inventoryPrintSettings';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
const kgOf = (r: FabricRollDto) => { const n = parseFloat(String(r.actual_weight_kg ?? r.calculated_weight_kg ?? '0')); return Number.isFinite(n) ? n : 0; };
const STATUS: Record<string, string> = { AVAILABLE: '', RESERVED: 'محجوز', SOLD: 'مباع', DAMAGED: 'تالف', TRANSFERRED: 'محوَّل', AT_EXTERNAL_JOB: 'عند المصنعية', INACTIVE: 'غير فعّال' };

/** الأتواب مجمَّعة بحسب اللون وكوده، ومرتبة بالباركود (منطق مشترك للكشف الحراري). */
export function groupRollsByColor(rolls: FabricRollDto[]) {
  const groups = new Map<string, { colorName: string; colorCode: string; rows: Array<{ barcode: string; meters: number; kg: number; status: string; warehouse: string }> }>();
  for (const r of rolls) {
    const colorName = displayImportedColorName(r.color_name_ar || r.color_name_tr);
    const colorCode = displayImportedColorCode(r.color_code);
    const k = `${colorName}\u0000${colorCode}`;
    const g = groups.get(k) ?? { colorName, colorCode, rows: [] };
    g.rows.push({ barcode: String(r.barcode || '—'), meters: getRollLengthMeters(r), kg: kgOf(r), status: STATUS[r.status] ?? r.status ?? '', warehouse: String(r.warehouse_name ?? '') });
    groups.set(k, g);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' });
  return [...groups.values()].sort((a, b) => cmp(a.colorName, b.colorName) || cmp(a.colorCode, b.colorCode)).map((g) => ({ ...g, rows: g.rows.sort((x, y) => cmp(x.barcode, y.barcode)) }));
}

export interface ThermalStatementOptions {
  rolls: FabricRollDto[]; title?: string; searchQuery?: string; warehouseLabel?: string; printedAt?: Date;
  /** معامل حجم الخط (1 = الافتراضي)؛ يتغير به المطبوع فعلاً مع ارتفاع الصفوف والمسافات. */
  fontScale?: number; rollWidthMm?: number;
  /** ملخص: سطر واحد لكل لون (عدد الأتواب والمجموع) بلا أتواب مفردة؛ الافتراضي تفصيلي. */
  summary?: boolean;
  /** شعار CLOTEX (data-URI) واسم العلامة؛ يمرّرهما المستدعي كي يبقى المُصيّر نقياً وقابلاً للاختبار. */
  logoSrc?: string; brandName?: string;
}

/**
 * الكشف التفصيلي على رول حراري 78 مم (المحتوى ضمن 72 مم، دقة 203 DPI): توبان بكل صف مع فاصل، الأمتار كبيرة،
 * باركود التوب كرقم فقط، تظليل خفيف على مجموع كل لون والإجمالي العام فقط. الطول يتبع عدد الأتواب.
 */
export function renderInventoryRollsThermal78(o: ThermalStatementOptions): { html: string; heightMm: number } {
  const s = clampFontScale(o.fontScale ?? 1);
  const rollW = o.rollWidthMm ?? 78;
  const printedAt = o.printedAt ?? new Date();
  const groups = groupRollsByColor(o.rolls ?? []);
  const totalRolls = o.rolls.length;
  const totalM = o.rolls.reduce((a, r) => a + getRollLengthMeters(r), 0);
  const totalKg = o.rolls.reduce((a, r) => a + kgOf(r), 0);
  const warehouses = new Set(o.rolls.map((r) => String(r.warehouse_name ?? '')));
  const summary = o.summary === true;
  const summaryHtml = `<div class="sh"><span>اللون</span><span>الأتواب</span><span>الأمتار</span></div>` + groups.map((g) => {
    const gm = g.rows.reduce((a, r) => a + r.meters, 0), gk = g.rows.reduce((a, r) => a + r.kg, 0);
    return `<div class="srow"><div class="sn">${esc(g.colorName)}${g.colorCode && g.colorCode !== '—' ? ` <span class="gc">${esc(g.colorCode)}</span>` : ''}</div><div class="sc">${g.rows.length.toLocaleString('en')}</div><div class="sm">${fmt(gm)}${gk > 0 ? `<small>${fmt(gk, 1)} كغ</small>` : ''}</div></div>`;
  }).join('');
  const rollsHtml = summary ? summaryHtml : groups.map((g) => {
    const gm = g.rows.reduce((a, r) => a + r.meters, 0), gk = g.rows.reduce((a, r) => a + r.kg, 0);
    const cells = g.rows.map((r, i) => {
      const extra = [r.kg > 0 ? `${fmt(r.kg, 1)} كغ` : '', r.status, warehouses.size > 1 ? r.warehouse : ''].filter(Boolean).join(' · ');
      return `<div class="cell"><div class="m">${fmt(r.meters)}<small> م</small></div><div class="bc"><span class="n">#${i + 1}</span> ${esc(r.barcode)}</div>${extra ? `<div class="x">${esc(extra)}</div>` : ''}</div>`;
    });
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 2) rows.push(`<div class="row">${cells[i]}<div class="sep"></div>${cells[i + 1] ?? '<div class="cell empty"></div>'}</div>`);
    return `<section class="grp"><div class="gh">${esc(g.colorName)}${g.colorCode && g.colorCode !== '—' ? ` <span class="gc">${esc(g.colorCode)}</span>` : ''}</div>${rows.join('')}
      <div class="tot"><span>${g.rows.length.toLocaleString('en')} توب</span><b>${fmt(gm)} م</b>${gk > 0 ? `<span>${fmt(gk, 1)} كغ</span>` : ''}</div></section>`;
  }).join('');

  // ارتفاع تقديري يتبع المحتوى (لا فراغ كبير ولا قص): الرأس + مجموعات + الإجمالي
  const rowMm = 12.5 * s, ghMm = 7 * s, totMm = 7 * s;
  const heightMm = summary
    ? Math.ceil(46 * s + 8 * s + groups.length * 10 * s + 16 * s + 8)
    : Math.ceil(46 * s + groups.reduce((a, g) => a + ghMm + Math.ceil(g.rows.length / 2) * rowMm + totMm + 2, 0) + 16 * s + 8);
  const title = o.title ?? (summary ? 'كشف جرد ملخص' : 'كشف جرد الأتواب');
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
@page { size: ${rollW}mm ${heightMm}mm; margin: 0; }
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${rollW}mm;background:#fff;color:#000;font-family:Tahoma,Arial,'Segoe UI',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:72mm;margin:0 auto;padding:${2 * s}mm 0 ${4 * s}mm}
.logo{display:block;margin:0 auto ${1.5 * s}mm;height:${11 * s}mm;width:auto}
h1{text-align:center;font-size:${11 * s}pt;font-weight:900;margin-bottom:${1 * s}mm}
.meta{font-size:${7 * s}pt;font-weight:700;line-height:1.5;border-top:.3mm solid #000;border-bottom:.3mm solid #000;padding:${1 * s}mm 0;margin-bottom:${2 * s}mm}
.meta div{display:flex;justify-content:space-between;gap:2mm}
.grp{margin-bottom:${2 * s}mm}
.gh{font-size:${9 * s}pt;font-weight:900;padding:${.8 * s}mm 0;border-bottom:.35mm solid #000}
.gc{font-family:Consolas,'Courier New',monospace;font-weight:700;font-size:${7.5 * s}pt;direction:ltr;unicode-bidi:embed}
.row{display:flex;align-items:stretch;border-bottom:.15mm dotted #888;page-break-inside:avoid;break-inside:avoid}
.cell{width:35mm;padding:${1 * s}mm ${.8 * s}mm;text-align:center}
.cell.empty{visibility:hidden}
.sep{width:2mm;display:flex;justify-content:center}.sep:before{content:'';width:0;border-right:.3mm solid #000}
.m{font-size:${16 * s}pt;font-weight:900;line-height:1.1;font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed}
.m small{font-size:${7.5 * s}pt;font-weight:700}
.bc{font-size:${8 * s}pt;font-weight:700;font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed;margin-top:.4mm}
.bc .n{font-weight:900}
.x{font-size:${6.5 * s}pt;font-weight:700;color:#222;margin-top:.3mm;line-height:1.25}
.tot{display:flex;justify-content:space-between;align-items:baseline;gap:2mm;background:#e4e4e4;border:.3mm solid #000;padding:${1 * s}mm ${1.5 * s}mm;margin-top:${1 * s}mm;font-size:${8.5 * s}pt;font-weight:700}
.tot b{font-size:${11 * s}pt;font-weight:900;font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed}
.grand{background:#d2d2d2;border:.5mm solid #000;padding:${1.8 * s}mm ${1.5 * s}mm;margin-top:${2 * s}mm;text-align:center}
.grand .t{font-size:${8 * s}pt;font-weight:900}
.grand .v{font-size:${14 * s}pt;font-weight:900;font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed}
.grand .k{font-size:${8 * s}pt;font-weight:700}
.sh{display:flex;justify-content:space-between;font-size:${7 * s}pt;font-weight:900;border-bottom:.35mm solid #000;padding:${.6 * s}mm 0}
.srow{display:flex;align-items:center;gap:1.5mm;border-bottom:.15mm dotted #888;padding:${1.2 * s}mm 0;page-break-inside:avoid;break-inside:avoid}
.sn{flex:1;font-size:${9 * s}pt;font-weight:900;line-height:1.2}
.sc{width:12mm;text-align:center;font-size:${9 * s}pt;font-weight:700;font-family:Consolas,'Courier New',monospace}
.sm{width:26mm;text-align:left;font-size:${12 * s}pt;font-weight:900;font-family:Consolas,'Courier New',monospace;direction:ltr;unicode-bidi:embed;line-height:1.1}
.sm small{display:block;font-size:${6.5 * s}pt;font-weight:700;color:#222}
.foot{text-align:center;font-size:${6.5 * s}pt;margin-top:${2 * s}mm}
</style></head><body><div class="page">
${o.logoSrc ? `<img class="logo" src="${o.logoSrc}" alt="${esc(o.brandName ?? 'CLOTEX')}"/>` : ''}
<h1>${esc(title)}</h1>
<div class="meta">
${o.searchQuery ? `<div><span>البحث</span><span>${esc(o.searchQuery)}</span></div>` : ''}
<div><span>التاريخ</span><span style="direction:ltr">${printedAt.toLocaleDateString('en-GB')} ${printedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
<div><span>المستودع</span><span>${esc(o.warehouseLabel || 'كل المستودعات')}</span></div>
</div>
${rollsHtml || '<p style="text-align:center;font-size:9pt">لا أتواب.</p>'}
<div class="grand"><div class="t">الإجمالي العام — ${totalRolls.toLocaleString('en')} توب</div><div class="v">${fmt(totalM)} م</div>${totalKg > 0 ? `<div class="k">${fmt(totalKg, 1)} كغ</div>` : ''}</div>
<div class="foot">${esc(o.brandName ?? 'CLOTEX')}</div>
</div></body></html>`;
  return { html, heightMm };
}
