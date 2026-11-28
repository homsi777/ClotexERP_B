import { BRAND } from '../../branding';
import { code128Modules, code128Sequence } from './code128Width';
import { formatCompositionLinesForLabel, type CartelaCompositionLine } from '../cartela/careSymbols';
import markBlackSvg from '../../assets/brand/clotex-mark-black.svg?raw';
import { renderCareSymbolsHtml } from '../cartela/careSymbolSvg';
import type { CartelaCareSymbolId } from '../cartela/careSymbols';

export const CARTELA_WIDTH_MM = 80;
export const CARTELA_HEIGHT_MM = 50;
export const CARTELA_DEFAULT_FONT_SIZE_PT = 6.8;
export const CARTELA_MIN_FONT_SIZE_PT = 4.5;
export const CARTELA_MAX_FONT_SIZE_PT = 11;

export type CartelaLabelData = {
  artCode: string;
  designNo: string;
  colour: string;
  widthValue: string;
  widthUnit: string;
  widthToleranceEnabled: boolean;
  widthTolerancePercent: number;
  weightValue: string;
  weightUnit: string;
  weightToleranceEnabled: boolean;
  weightTolerancePercent: number;
  compositionLines: CartelaCompositionLine[];
  careSymbols: CartelaCareSymbolId[];
  serialNo: string;
  showLogo: boolean;
  fontSizePt?: number;
  qrSvg?: string;
};

const CODE128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

/** compact=true: مجموعة C للأرقام المتتالية (نصف العرض تقريباً) — لملصق اللون الفرعي؛ الافتراضي كما كان (B). */
export function buildCode128Svg(value: string, height = 24, compact = false): string {
  const seq = code128Sequence(value, compact);
  const mw = 1.6;
  let x = 0;
  const bars = seq
    .flatMap((code) => {
      const pat = CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0];
      return pat.split('').map((w, idx) => {
        const width = Number(w) * mw;
        const bar = idx % 2 === 0 ? `<rect x="${x}" y="0" width="${width}" height="${height}" fill="#000"/>` : '';
        x += width;
        return bar;
      });
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${height}" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none">${bars}</svg>`;
}

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function formatWidth(data: CartelaLabelData): string {
  const base = `${data.widthValue.trim()} ${data.widthUnit.trim()}`.trim();
  if (!data.widthValue.trim()) return '';
  if (!data.widthToleranceEnabled) return base;
  return `${base} (±${Math.round(data.widthTolerancePercent)}%)`;
}

function formatWeight(data: CartelaLabelData): string {
  const base = `${data.weightValue.trim()} ${data.weightUnit.trim()}`.trim();
  if (!data.weightValue.trim()) return '';
  if (!data.weightToleranceEnabled) return base;
  return `${base} (±${Math.round(data.weightTolerancePercent)}%)`;
}

function clampFontSizePt(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return CARTELA_DEFAULT_FONT_SIZE_PT;
  return Math.min(CARTELA_MAX_FONT_SIZE_PT, Math.max(CARTELA_MIN_FONT_SIZE_PT, Math.round(n * 10) / 10));
}

/** تقدير حجم الخط (pt) ليتسع نص من عدد أحرف معيّن في عرض معيّن (mm) — أحرف كبيرة عريضة ≈ 0.68em. */
function fitPt(text: string, availMm: number, maxPt: number, minPt: number, lines = 1): number {
  const len = Math.max(1, text.length);
  const pt = (availMm * lines) / (len * 0.68 * 0.3528);
  return Math.round(Math.min(maxPt, Math.max(minPt, pt)) * 10) / 10;
}

/** حجم رقم الكارتيلة الكبير (أسفل اليمين) حسب عدد الخانات — يبقى أعرض ما يمكن مع الأصفار البادئة. */
function serialPt(serial: string): number {
  const n = serial.length;
  return n <= 4 ? 25 : n === 5 ? 21 : n === 6 ? 18 : n === 7 ? 15.5 : n === 8 ? 13.5 : 11.5;
}

const LOGO_BLACK_SVG = markBlackSvg.replace(/<svg /, '<svg class="logo-svg" preserveAspectRatio="xMidYMid meet" ');

function buildCartelaLabelSheetInner(data: CartelaLabelData): string {
  const serial = data.serialNo.trim();
  const base = clampFontSizePt(data.fontSizePt);
  // باركود مضغوط (مجموعة C للأرقام) بعرض يترك هوامش صمت كافية على الجانبين ليُقرأ بالسكانر
  const bcModules = serial ? code128Modules(serial, true) : 0;
  const bcUnitMm = bcModules ? Math.min(0.5, 39 / bcModules) : 0.5;
  const bcWidthMm = Math.round(bcModules * bcUnitMm * 100) / 100;
  const barcodeSvg = serial ? buildCode128Svg(serial, 22, true) : '';
  const art = data.artCode.trim();
  const design = data.designNo.trim();
  const width = formatWidth(data);
  const weight = formatWeight(data);
  const compParts = formatCompositionLinesForLabel(data.compositionLines);

  // ART CODE: سطر واحد يصغَّر ليتسع؛ الاسم الطويل جداً يلتف على سطرين بخط أصغر
  const topAvail = 34;
  const topMax = base + 1.4;
  const artOne = fitPt(art, topAvail, topMax, 5.4);
  const artTwoLines = art.length * 0.68 * 0.3528 * artOne > topAvail * 1.02;
  const artPt = artTwoLines ? fitPt(art, topAvail, topMax - 1, 4.8, 2) : artOne;
  const designPt = fitPt(design, topAvail, topMax, 5.4);

  // COMP.: من مكوّن إلى خمسة؛ يلتف على أسطر ويصغَّر قليلاً حسب العدد دون إفراط
  const compPt = compParts.length <= 2 ? base - 0.2 : compParts.length === 3 ? base - 0.7 : base - 1.2;
  const specPt = base + 0.4;
  const lblPt = base - 0.4;

  const careIds = data.careSymbols;
  const careInner = renderCareSymbolsHtml(careIds).replace('<div class="care" aria-hidden="true">', '').replace(/<\/div>$/, '');
  const careHtml = careIds.length
    ? `<div class="care" style="--s:${Math.max(3.4, Math.min(6.6, (53 - (careIds.length - 1) * 0.8) / careIds.length)).toFixed(2)}mm">${careInner}</div>`
    : '';

  const field = (label: string, value: string, pt: number, extra = '') =>
    value.trim()
      ? `<div class="f ${extra}"><span class="fl" style="font-size:${lblPt}pt">${esc(label)}</span><span class="fs">:</span><span class="fv" style="font-size:${pt}pt">${esc(value)}</span></div>`
      : '';

  const logoBlock = data.showLogo ? `<div class="logo-box">${LOGO_BLACK_SVG}<span class="tm">™</span></div>` : '';
  const qrBlock = data.qrSvg ? `<div class="qr">${data.qrSvg.replace('<svg ', '<svg class="qr-svg" ')}</div>` : '';
  const compHtml = compParts.length
    ? `<div class="f comp"><span class="fl" style="font-size:${lblPt}pt">COMP.</span><span class="fs">:</span><span class="fv fc" style="font-size:${compPt}pt">${compParts.map((c) => `<span class="cp">${esc(c)}</span>`).join(' ')}</span></div>`
    : '';

  return `<main class="sheet">
    <section class="frame">
      <div class="top">
        <div class="top-l">
          ${field('ART CODE', art, artPt, artTwoLines ? 'two' : '')}
          ${field('DESIGN NO', design, designPt)}
        </div>
        <div class="top-r">${logoBlock}</div>
      </div>
      <div class="mid">
        <div class="mid-l">
          <div class="specs">
            ${field('WIDTH', width, specPt)}
            ${field('WEIGHT', weight, specPt)}
            ${compHtml}
          </div>
          ${careHtml}
        </div>
        <div class="mid-r">${qrBlock}</div>
      </div>
      <div class="bot">
        <div class="bot-l">${barcodeSvg ? `<div class="bc" style="--bw:${bcWidthMm}mm">${barcodeSvg}</div>` : ''}</div>
        <div class="bot-r"><span class="serial" style="font-size:${serialPt(serial)}pt">${esc(serial)}</span></div>
      </div>
    </section>
  </main>`;
}

function buildCartelaLabelDocumentCss(_fontSizePt = CARTELA_DEFAULT_FONT_SIZE_PT): string {
  return `
    @page { size: ${CARTELA_WIDTH_MM}mm ${CARTELA_HEIGHT_MM}mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .sheet {
      width: ${CARTELA_WIDTH_MM}mm;
      height: ${CARTELA_HEIGHT_MM}mm;
      padding: 1.2mm;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .frame {
      width: 100%;
      height: 100%;
      border: 0.5mm solid #000;
      border-radius: 2.4mm;
      display: grid;
      grid-template-rows: 11.6mm 1fr 10mm;
      overflow: hidden;
      background: #fff;
    }
    .top, .mid, .bot { display: grid; min-height: 0; min-width: 0; }
    .top { grid-template-columns: 1fr 22.5mm; border-bottom: 0.35mm solid #000; }
    .mid { grid-template-columns: 1fr 22.5mm; border-bottom: 0.35mm solid #000; }
    .bot { grid-template-columns: 1fr 27mm; }
    .top-r, .mid-r, .bot-r { border-left: 0.3mm solid #000; }
    .top-l { padding: 1mm 1.4mm 0.6mm 1.8mm; display: flex; flex-direction: column; justify-content: center; gap: 0.6mm; min-width: 0; }
    .top-r { display: flex; align-items: center; justify-content: center; padding: 0.6mm; }
    .logo-box { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; }
    .logo-svg { height: 10.2mm; width: auto; display: block; }
    .tm { position: absolute; top: 46%; right: -2.3mm; font-size: 3.4pt; font-weight: 700; line-height: 1; }
    .f { display: grid; grid-template-columns: 15.8mm 1.6mm 1fr; align-items: baseline; line-height: 1.1; min-width: 0; }
    .fl { font-weight: 800; white-space: nowrap; letter-spacing: 0.1pt; }
    .fs { font-size: 6.4pt; font-weight: 900; line-height: 1; text-align: center; }
    .fv { font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .f.two .fv { white-space: normal; line-height: 1.02; overflow: hidden; }
    .mid-l { display: grid; grid-template-rows: 1fr auto; min-width: 0; min-height: 0; }
    .specs { padding: 1mm 1.4mm 0.4mm 1.8mm; display: flex; flex-direction: column; gap: 0.5mm; min-height: 0; overflow: hidden; }
    .f.comp { align-items: start; }
    .fv.fc { white-space: normal; line-height: 1.08; overflow: hidden; font-weight: 800; }
    .cp { display: inline-block; white-space: nowrap; margin-right: 1.2mm; }
    .care { border-top: 0.3mm solid #000; margin: 0 1.2mm; padding: 0.7mm 0 0.5mm; display: flex; align-items: center; justify-content: space-around; gap: 0.8mm; }
    .sym { width: var(--s, 5.5mm); height: var(--s, 5.5mm); flex-shrink: 0; display: block; overflow: visible; }
    .mid-r { display: flex; align-items: center; justify-content: center; padding: 0.8mm; }
    .qr { width: 18mm; height: 18mm; background: #fff; display: flex; align-items: center; justify-content: center; }
    .qr svg, .qr-svg { width: 18mm !important; height: 18mm !important; display: block; shape-rendering: crispEdges; }
    .bot-l { display: flex; align-items: center; justify-content: center; padding: 0.8mm 1mm; min-width: 0; }
    .bc { display: flex; align-items: center; }
    .bc svg { width: var(--bw); height: 7.6mm; display: block; }
    .bot-r { display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .serial { font-weight: 900; line-height: 1; letter-spacing: -0.3pt; font-family: Arial, Helvetica, sans-serif; white-space: nowrap; }
    @media screen { body { background: #fff; } }`;
}

export function buildCartelaLabelHtml(data: CartelaLabelData): string {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <style>${buildCartelaLabelDocumentCss(data.fontSizePt)}</style>
</head>
<body>
  ${buildCartelaLabelSheetInner(data)}
</body>
</html>`;
}

/** High-quality batch document — one thermal page per cartela, same renderer as single print. */
export function buildCartelaLabelsBatchHtml(labels: CartelaLabelData[]): string {
  if (!labels.length) {
    return buildCartelaLabelHtml({
      artCode: '',
      designNo: '',
      colour: '',
      widthValue: '',
      widthUnit: 'cm',
      widthToleranceEnabled: true,
      widthTolerancePercent: 3,
      weightValue: '',
      weightUnit: 'gr/m²',
      weightToleranceEnabled: true,
      weightTolerancePercent: 5,
      compositionLines: [],
      careSymbols: [],
      serialNo: '',
      showLogo: true,
    });
  }
  const referenceFont = labels[0]?.fontSizePt ?? CARTELA_DEFAULT_FONT_SIZE_PT;
  const sheets = labels.map((label) => buildCartelaLabelSheetInner(label)).join('\n');
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <style>${buildCartelaLabelDocumentCss(referenceFont)}</style>
</head>
<body>
  ${sheets}
</body>
</html>`;
}

const LABEL_PX_PER_MM = 96 / 25.4;

/** Fit label inside iframe viewport — scaling stays inside the document (no clipped iframe transform). */
export function injectCartelaPreviewFitCss(html: string): string {
  const labelWpx = CARTELA_WIDTH_MM * LABEL_PX_PER_MM;
  const labelHpx = CARTELA_HEIGHT_MM * LABEL_PX_PER_MM;
  const fitCss = `
    <style id="cartela-preview-fit">
      @media screen {
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
          background: #fff !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .sheet {
          width: ${CARTELA_WIDTH_MM}mm !important;
          height: ${CARTELA_HEIGHT_MM}mm !important;
          flex-shrink: 0 !important;
          transform: scale(min(calc(100vw / ${labelWpx}px), calc(100vh / ${labelHpx}px))) !important;
          transform-origin: center center !important;
          box-shadow: none !important;
          page-break-after: auto !important;
        }
      }
    </style>`;
  return html.includes('</head>') ? html.replace('</head>', `${fitCss}</head>`) : `${fitCss}${html}`;
}

export function buildCartelaLabelPreviewHtml(data: CartelaLabelData): string {
  return injectCartelaPreviewFitCss(buildCartelaLabelHtml(data));
}

/** QR الكارتيلة يوجّه إلى الموقع الرسمي (مُعرَّف مركزياً في BRAND.websiteUrl) — لا يتطلب تسجيل دخول. */
export function cartelaQrPayload(_data?: Pick<CartelaLabelData, 'artCode' | 'designNo' | 'serialNo'>): string {
  return BRAND.websiteUrl;
}

/** Optional small logo for screen preview only — thermal uses text stripe. */
export const CARTELA_LOGO_INLINE = BRAND.logoInline;
