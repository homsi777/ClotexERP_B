/**
 * طباعة صور الشيكات الأصلية (وضع الصور) على A4: كل صورة بنسبة أبعادها دون تمديد، تحت بعضها عمودياً،
 * وكل صورة (مع معلوماتها) كتلة لا تنقسم بين صفحتين. بلا شعار ولا إضافات فوق الصورة.
 * المعلومات الإضافية اختيارية وتوضع تحت كل صورة مباشرة بشكل مختصر.
 */

export type CheckImageSideLite = 'FRONT' | 'BACK' | 'OTHER';

export interface CheckPrintInfo {
  check_no: string;
  bank_name: string;
  party_name: string | null;
  account_holder_name?: string | null;
  amount: string;
  currency_code: string;
  received_date?: string | null;
  due_date: string;
  /** PAID_OUT = شيك صادر (مُعطى لمورد): تُعرض معلومات التسليم بدل القبض. */
  status?: string;
  delivered_at?: string | null;
}

export interface CheckImagesPrintItem {
  info: CheckPrintInfo;
  images: { side: CheckImageSideLite; data: string }[];
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const ymd = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '—');

export function isOutgoingCheck(info: Pick<CheckPrintInfo, 'status'>): boolean {
  return info.status === 'PAID_OUT';
}

/** سطر المعلومات الإضافية: «معلومات القبض» للوارد و«معلومات التسليم» للصادر. */
export function buildCheckInfoHtml(info: CheckPrintInfo): string {
  const amount = `${Number(info.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(info.currency_code)}`;
  const party = esc(info.party_name || info.account_holder_name || '—');
  const outgoing = isOutgoingCheck(info);
  const cells: [string, string][] = outgoing
    ? [
        ['سُلِّم إلى (المستفيد)', party],
        ['تاريخ التسليم', esc(ymd(info.delivered_at))],
        ['رقم الشيك', `<span class="mono">${esc(info.check_no)}</span>`],
        ['البنك', esc(info.bank_name)],
        ['القيمة', `<span class="mono">${amount}</span>`],
        ['تاريخ الاستحقاق', esc(ymd(info.due_date))],
      ]
    : [
        ['تم استلام الشيك من', party],
        ['تاريخ الاستلام', esc(ymd(info.received_date))],
        ['رقم الشيك', `<span class="mono">${esc(info.check_no)}</span>`],
        ['البنك', esc(info.bank_name)],
        ['القيمة', `<span class="mono">${amount}</span>`],
        ['تاريخ الاستحقاق', esc(ymd(info.due_date))],
      ];
  return `<div class="info">${cells.map(([l, v]) => `<div><span class="lbl">${l}:</span> ${v}</div>`).join('')}</div>`;
}

export const CHECK_IMAGES_PRINT_CSS = `
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: Tahoma, Arial, 'Segoe UI', sans-serif; color: #111; background: #fff; direction: rtl;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .item { break-inside: avoid; page-break-inside: avoid; margin: 0 0 7mm; text-align: center; }
  .item img { display: block; margin: 0 auto; max-width: 100%; max-height: 118mm; width: auto; height: auto; object-fit: contain; }
  .info { margin-top: 2mm; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8mm 4mm; font-size: 8.5pt; text-align: right; }
  .info .lbl { font-weight: 700; color: #444; }
  .mono { font-family: monospace; }
  .side-note { font-size: 8pt; color: #555; margin-top: 1mm; text-align: right; }
`;

/**
 * يبني مستند الطباعة. includeBack: طباعة الوجه الخلفي/الصور الأخرى أيضاً (افتراضياً الأمامي فقط).
 * شيك بلا صورة مؤهلة يُتخطّى هنا (المستدعي يحذّر المستخدم قبلها)؛ أرجع missing لتنبيهه.
 */
export function buildChecksOriginalImagesHtml(opts: {
  items: CheckImagesPrintItem[];
  includeInfo: boolean;
  includeBack?: boolean;
}): { html: string; printedImages: number; missing: CheckPrintInfo[] } {
  const missing: CheckPrintInfo[] = [];
  const blocks: string[] = [];
  let printed = 0;
  for (const it of opts.items) {
    const imgs = it.images.filter((i) => (opts.includeBack ? true : i.side === 'FRONT') && i.data);
    // لا صورة أمامية لكن توجد أخرى: تُستعمل أولى الصور المتاحة بدل تفويت الشيك.
    const chosen = imgs.length ? imgs : it.images.slice(0, 1).filter((i) => i.data);
    if (!chosen.length) {
      missing.push(it.info);
      continue;
    }
    chosen.forEach((img, idx) => {
      printed++;
      const note = opts.includeInfo && idx > 0 ? `<div class="side-note">${img.side === 'BACK' ? 'الوجه الخلفي' : 'صورة إضافية'} — شيك ${esc(it.info.check_no)}</div>` : '';
      blocks.push(`<div class="item"><img src="${esc(img.data)}" alt="${esc(it.info.check_no)}" />${opts.includeInfo && idx === 0 ? buildCheckInfoHtml(it.info) : note}</div>`);
    });
  }
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>صور الشيكات</title><style>${CHECK_IMAGES_PRINT_CSS}</style></head><body>${blocks.join('')}</body></html>`;
  return { html, printedImages: printed, missing };
}
