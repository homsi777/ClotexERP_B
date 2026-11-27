import { BRAND } from '../../branding';
import { amountToArabicWords, amountToTurkishWords } from './arabicAmountWords';
import {
  buildVoucherMetaStatement,
  buildVoucherNarrativeParts,
  type VoucherNarrativeInput,
} from './voucherNarrative';
import { voucherPurposeAr } from '../voucherPurpose';
import i18n from '../../i18n/config';
import { getBranchPrintInfo } from './branchPrintInfo';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'terminology', ...options });
const amountToWords = (amount: number, currencyCode: string) =>
  i18n.language === 'ar' ? amountToArabicWords(amount, currencyCode) : amountToTurkishWords(amount, currencyCode);

const NAVY = '#4C3890';
const GOLD = '#B89854';
const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";

const getContact = () => ({
  location: getBranchPrintInfo()?.location || t('documentFooter.location'),
  phone: getBranchPrintInfo()?.phoneVoucher || '+963 944 555 080',
  receiptSlogan: t('documentFooter.voucherReceiptSlogan'),
  paymentSlogan: t('documentFooter.voucherPaymentSlogan'),
});

export type VoucherPrintData = {
  voucherNo: string;
  voucherType: 'RECEIPT' | 'PAYMENT';
  voucherDate: string;
  partyName: string;
  partyType?: string;
  amount: string;
  currencyCode: string;
  exchangeRateToUsd?: string;
  amountUsd?: string;
  /** تحويل اختياري بسعر صرف: مكافئ المبلغ بعملة أخرى. */
  conversion?: { amount: string; currencyCode: string; rate: string } | null;
  cashboxName?: string;
  paymentMethod?: string | null;
  referenceDocumentNo?: string | null;
  purpose?: string | null;
  description?: string | null;
  representative?: string | null;
  /** شيكات استُلمت/دُفعت بهذا السند — تظهر بالطباعة كإثبات (رقم، بنك، استحقاق). */
  checks?: { checkNo: string; bankName: string; dueDate?: string | null; holder?: string | null }[];
};

export type VoucherRenderOptions = {
  colorMode?: 'color' | 'bw';
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function displayField(value?: string | null): string {
  const trimmed = String(value ?? '').trim();
  return trimmed ? esc(trimmed) : '—';
}

function normalizeVoucherDate(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const datePart = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  return raw;
}

function shortNumericVoucherNo(voucherNo: string): string {
  const digits = String(voucherNo ?? '').match(/\d+/g)?.join('');
  return digits ? digits.padStart(6, '0').slice(-6) : '000000';
}

function formatAmountDisplay(amount: string, currencyCode: string): string {
  const num = Number(amount);
  const code = currencyCode.trim().toUpperCase() || 'USD';
  const formatted = Number.isFinite(num)
    ? num % 1 === 0
      ? Math.round(num).toLocaleString('en-US')
      : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(amount ?? '0');
  return `${code} ${formatted}`;
}

function iconSvg(kind: 'user' | 'pin' | 'tag' | 'calendar' | 'wallet' | 'doc' | 'receipt' | 'phone' | 'mail' | 'check' | 'star' | 'shield'): string {
  const paths: Record<string, string> = {
    user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z',
    pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z',
    tag: 'M3 10V3h7l10 10-7 7L3 10Zm4-4a1.5 1.5 0 1 0 1.5 1.5A1.5 1.5 0 0 0 7 6Z',
    calendar: 'M7 2v2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm12 8H5v8h14V10Z',
    wallet: 'M3 6h14a2 2 0 0 1 2 2v1h-3a3 3 0 0 0 0 6h3v1a2 2 0 0 1-2 2H3V6Zm14 4h2v2h-2a1 1 0 1 1 0-2Z',
    doc: 'M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V6h2.5',
    receipt: 'M6 2h12v18l-2-1-2 1-2-1-2 1-2-1-2 1-2-1V2Zm2 4h8v2H8V6Zm0 4h8v2H8v-2Z',
    phone: 'M7 3h3l1 4-2 1a11 11 0 0 0 5 5l1-2 4 1v3a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2Z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2 8 5 8-5v12H4V6Z',
    check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
    star: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7-5.4-4.7 7.1-.6L12 2Z',
    shield: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z',
  };
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[kind]}"/></svg>`;
}

function metaRow(icon: string, label: string, value: string): string {
  return `
    <tr>
      <td class="meta-label">${icon}<span>${label}</span></td>
      <td class="meta-value">${value}</td>
    </tr>`;
}

function renderVoucherFooterHtml(isReceipt: boolean): string {
  const contact = getContact();
  const slogan = isReceipt ? contact.receiptSlogan : contact.paymentSlogan;
  return `
      <div class="footer-bar">
        <table class="footer-table" dir="rtl">
          <tr>
            <td class="footer-right" style="width:34%;"><span>${esc(contact.location)}</span></td>
            <td class="footer-center" style="width:32%;"><span class="footer-phone ltr">${esc(contact.phone)}</span></td>
            <td class="footer-left" style="width:34%;"><span>${esc(slogan)}</span></td>
          </tr>
        </table>
      </div>`;
}

function narrativeInput(data: VoucherPrintData): VoucherNarrativeInput {
  return {
    voucherType: data.voucherType,
    partyName: data.partyName,
    amount: Number(data.amount) || 0,
    currencyCode: data.currencyCode,
    paymentMethod: data.paymentMethod,
    cashboxName: data.cashboxName,
    referenceDocumentNo: data.referenceDocumentNo,
    purpose: data.purpose,
    description: data.description,
  };
}

function renderNarrativeHtml(data: VoucherPrintData, accent: string): string {
  const parts = buildVoucherNarrativeParts(narrativeInput(data));
  const highlight = parts.highlight
    ? `<strong style="color:${accent};">${esc(parts.highlight)}</strong>`
    : '';
  return `${esc(parts.beforeAmount)}<strong style="color:${accent};">${esc(parts.amount)}</strong>${esc(parts.middle)}${highlight}${esc(parts.after)}`;
}

function renderSignFieldsHtml(): string {
  return `
    <table class="sign-fields" dir="rtl">
      <tr><td class="sign-key">${t('accountStatement.nameField')}</td><td class="sign-val sign-underline">&nbsp;</td></tr>
      <tr><td class="sign-key">${t('accountStatement.signatureField')}</td><td class="sign-val sign-underline">&nbsp;</td></tr>
    </table>`;
}

function voucherStyles(accent: string, accentSoft: string, bw: boolean): string {
  const ink = bw ? '#111111' : NAVY;
  const soft = bw ? '#f5f5f5' : '#f1edfa';
  const line = bw ? '#999999' : '#ddd5ee';
  const gold = bw ? '#111111' : GOLD;

  return `
    @page { size: A4 portrait; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 210mm;
      min-height: 297mm;
      font-family: ${FONT};
      color: #1f1f1f;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 210mm; min-height: 297mm; display: flex; flex-direction: column; padding: 8mm 10mm 6mm; }
    .page-content { flex: 1 1 auto; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    .header-table td { vertical-align: middle; }
    .brand-cell { display: flex; align-items: center; gap: 10px; direction: ltr; }
    .logo { height: 62px; width: auto; object-fit: contain; }
    .brand-tag { font-size: 11px; color: ${ink}; font-weight: 500; }
    .page-no { font-size: 9px; color: #444; text-align: right; direction: ltr; vertical-align: top; }
    .doc-title { text-align: center; font-size: 30px; font-weight: 900; color: ${ink}; margin: 0 0 4px; line-height: 1.2; }
    .doc-sub { text-align: center; font-size: 12px; color: ${ink}; font-weight: 500; }
    .gold-rule { height: 1.5px; background: ${gold}; margin: 8px 0 30px; }
    .cards-table { width: 100%; border-collapse: separate; border-spacing: 14px 0; margin: 0 -14px 30px; width: calc(100% + 28px); }
    .cards-table td { width: 50%; vertical-align: top; }
    .card { border: 1px solid ${line}; background: #fff; min-height: 205px; }
    .card-head { background: ${soft}; font-size: 15px; font-weight: 900; color: ${ink}; padding: 9px 12px; text-align: right; border-bottom: 1px solid ${line}; }
    .card-head .ico, .meta-label .ico, .narrative-head .ico, .sign-title .ico { display: none; }
    .meta-table { width: 100%; border-collapse: collapse; margin: 4px 12px; width: calc(100% - 24px); }
    .meta-table tr { border-bottom: 1px solid ${line}; }
    .meta-label { font-size: 12.5px; color: ${ink}; font-weight: 900; padding: 8px 0; white-space: nowrap; vertical-align: middle; width: 40%; text-align: right; }
    .meta-value { font-size: 11px; font-weight: 500; color: #1f1f1f; padding: 8px 0; text-align: left; word-break: break-word; vertical-align: middle; }
    .type-pill { display: inline; background: none; border: none; color: inherit; padding: 0; font-size: inherit; font-weight: inherit; }
    .amount-box { border: 1px solid ${line}; background: ${soft}; padding: 14px 22px 16px; text-align: center; margin: 0 0 32px; padding-top: 18px; }
    .amount-label { font-size: 15px; font-weight: 900; color: ${ink}; margin-bottom: 14px; }
    .amount-value { font-size: 40px; font-weight: 900; color: ${ink}; line-height: 1.1; letter-spacing: 0.5px; direction: ltr; }
    .amount-words { margin-top: 14px; padding-top: 12px; border-top: 1px solid ${line}; font-size: 13px; color: #222; font-weight: 700; line-height: 1.6; }
    .narrative-box { border: 1px solid ${line}; background: #fff; margin: 0 0 44px; }
    .narrative-head { background: ${soft}; font-size: 15px; font-weight: 900; color: ${ink}; padding: 9px 12px; border-bottom: 1px solid ${line}; }
    .narrative-text { font-size: 12.5px; line-height: 1.9; color: #1f1f1f; font-weight: 500; padding: 14px 14px 22px; min-height: 70px; }
    .narrative-text strong { color: #1f1f1f !important; font-weight: 500; }
    .sign-table { width: calc(100% + 28px); margin: 0 -14px; border-collapse: separate; border-spacing: 14px 0; }
    .sign-table td { width: 50%; border: 1px solid ${line}; padding: 0; vertical-align: top; background: #fff; }
    .sign-title { background: ${soft}; text-align: center; font-size: 14px; font-weight: 900; color: ${ink}; padding: 8px 10px; border-bottom: 1px solid ${line}; }
    .sign-table .sign-fields td { border: none; border-radius: 0; background: none; width: auto; }
    .sign-fields { width: calc(100% - 28px); margin: 14px 14px 18px; border-collapse: collapse; }
    .sign-key { font-size: 12px; color: ${ink}; font-weight: 500; padding: 12px 0 6px; width: 28%; text-align: right; }
    .sign-val { padding: 12px 0 6px; }
    .sign-table .sign-fields td.sign-underline { border-bottom: 1px solid ${line}; min-width: 60px; }
    .footer-bar { border-top: 1.5px solid ${gold}; padding: 8px 4px 0; margin: 14px 0 0; width: 100%; flex-shrink: 0; }
    .footer-bar, .footer-bar * { color: ${ink} !important; -webkit-text-fill-color: ${ink} !important; }
    .footer-table { width: 100%; border-collapse: collapse; }
    .footer-table td { vertical-align: middle; font-size: 9.5px; line-height: 1.55; font-weight: 500; }
    .footer-right { text-align: right; }
    .footer-center { text-align: center; }
    .footer-left { text-align: left; }
    .footer-phone { text-decoration: none !important; font-weight: 500; letter-spacing: 0.2px; white-space: nowrap; }
    .ltr { direction: ltr; unicode-bidi: embed; }

    @media print {
      html, body { width: 210mm; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { min-height: auto; overflow: visible; }
      .card, .amount-box, .narrative-box, .footer-bar, .card-head, .narrative-head, .sign-title {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  `;
}

/** أنماط html2canvas — نفس قواعد الطباعة، مصدر واحد مع القالب */
export const VOUCHER_A5_PDF_EXPORT_CSS = `
  html, body {
    width: 210mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .page {
    width: 210mm !important;
    min-height: 297mm !important;
    display: flex !important;
    flex-direction: column !important;
    padding: 8mm 10mm 6mm !important;
    overflow: visible !important;
    background: #ffffff !important;
  }
  .page-content { flex: 1 1 auto !important; }
  .brand-cell { display: flex !important; align-items: center !important; }
  .cards-table, .sign-table, .header-table, .meta-table, .footer-table { border-collapse: collapse !important; }
  .cards-table { border-collapse: separate !important; border-spacing: 14px 0 !important; }
  .sign-table { border-collapse: separate !important; border-spacing: 14px 0 !important; }
  .meta-table { table-layout: fixed !important; width: calc(100% - 24px) !important; }
  .meta-label { width: 40% !important; }
  .meta-value { width: 60% !important; text-align: left !important; overflow: visible !important; vertical-align: middle !important; }
  .card, .amount-box, .narrative-box, .footer-bar, .card-head, .narrative-head, .sign-title, .doc-title, .amount-value {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .footer-bar { flex-shrink: 0 !important; margin: 14px 0 0 !important; width: 100% !important; }
`;

/** html2canvas لا يرسم SVG — نحوّلها لصور قبل الالتقاط */
export function prepareVoucherDocumentForCanvas(doc: Document): void {
  const svgs = Array.from(doc.querySelectorAll('[data-clotex-doc="voucher-a5"] svg, .page[data-clotex-doc="voucher-a5"] svg'));
  for (const svg of svgs) {
    try {
      const svgEl = svg as SVGSVGElement;
      const computed = doc.defaultView?.getComputedStyle(svgEl);
      const w = svgEl.getBoundingClientRect().width
        || parseFloat(computed?.width || '0')
        || 12;
      const h = svgEl.getBoundingClientRect().height
        || parseFloat(computed?.height || '0')
        || 12;
      const clone = svgEl.cloneNode(true) as SVGSVGElement;
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      const serialized = new XMLSerializer().serializeToString(clone);
      const img = doc.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
      img.className = svgEl.className?.toString() || 'ico';
      img.style.width = `${Math.max(w, 10)}px`;
      img.style.height = `${Math.max(h, 10)}px`;
      img.style.display = 'inline-block';
      img.style.verticalAlign = 'middle';
      svgEl.parentNode?.replaceChild(img, svgEl);
    } catch {
      // إبقاء SVG الأصلي
    }
  }

  doc.querySelectorAll('[data-clotex-doc="voucher-a5"] .status-badge').forEach((el) => {
    const node = el as HTMLElement;
    node.style.display = 'inline-flex';
    node.style.alignItems = 'center';
    node.style.justifyContent = 'center';
    node.style.gap = '5px';
    node.style.borderRadius = '14px';
    node.style.padding = '4px 12px';
  });

  doc.querySelectorAll('[data-clotex-doc="voucher-a5"] .type-pill').forEach((el) => {
    const node = el as HTMLElement;
    node.style.display = 'inline-flex';
    node.style.alignItems = 'center';
    node.style.justifyContent = 'center';
    node.style.borderRadius = '10px';
    node.style.padding = '2px 10px 3px';
    node.style.minWidth = '40px';
    node.style.textAlign = 'center';
  });
}

export const A5_CAPTURE_WIDTH_PX = Math.round((210 / 25.4) * 96); // الاسم قديم: القالب المعتمد صار A4

export function renderVoucherA5BodyHtml(data: VoucherPrintData, options: VoucherRenderOptions = {}): string {
  const bw = options.colorMode === 'bw';
  const isReceipt = data.voucherType === 'RECEIPT';
  const accent = NAVY;
  const accentSoft = '#f1edfa';
  const accentColor = bw ? '#111111' : accent;
  const typeLabel = isReceipt ? t('voucher.typeReceipt') : t('voucher.typePayment');
  const docTitle = isReceipt ? t('voucher.docTitleReceipt') : t('voucher.docTitlePayment');
  const statusText = isReceipt ? t('voucher.statusReceived') : t('voucher.statusPaid');
  const amountHeading = isReceipt ? t('voucher.amountHeadingReceived') : t('voucher.amountHeadingPaid');
  const partyCardTitle = isReceipt ? t('voucher.partyCardTitleCustomer') : t('voucher.partyCardTitleBeneficiary');
  const receiverTitle = isReceipt ? t('voucher.receiverTitleReceiver') : t('voucher.receiverTitleBeneficiary');

  const voucherNo = esc(`#${shortNumericVoucherNo(data.voucherNo)}`);
  const voucherDate = esc(normalizeVoucherDate(data.voucherDate));
  const partyName = displayField(data.partyName);
  const cashboxName = displayField(data.cashboxName ?? (data.checks?.length ? t('voucher.checkMethod') : undefined));
  const checksHtml = (data.checks ?? [])
    .map((c) => [
      `${esc(t('voucher.checkNoShort'))} <b class="ltr">${esc(c.checkNo)}</b>`,
      `${esc(t('voucher.checkBankLabel'))}: ${esc(c.bankName)}`,
      c.dueDate ? `${esc(t('voucher.checkDueShort'))}: <span class="ltr">${esc(normalizeVoucherDate(c.dueDate))}</span>` : '',
      c.holder ? `${esc(t('voucher.checkHolderLabel'))}: ${esc(c.holder)}` : '',
    ].filter(Boolean).join(' — '))
    .join('<br/>');
  const invoiceNo = displayField(data.referenceDocumentNo);
  const purposeLabel = displayField(voucherPurposeAr(data.purpose));
  const metaStatement = displayField(buildVoucherMetaStatement(narrativeInput(data)));
  const representative = displayField(data.representative);
  const amountDisplay = esc(formatAmountDisplay(data.amount, data.currencyCode));
  const amountWords = esc(amountToWords(Number(data.amount) || 0, data.currencyCode));

  return `
    <div class="page" dir="rtl" data-clotex-doc="voucher-a5">
      <div class="page-content">
        <table class="header-table">
          <tr>
            <td style="width:25%;"><div class="page-no">1 / 1</div></td>
            <td style="width:40%;"><div class="doc-title">${docTitle}</div><div class="doc-sub">${statusText}</div></td>
            <td style="width:35%;"><div class="brand-cell"><img src="${BRAND.logoInline}" alt="${esc(BRAND.name)}" class="logo" /><span class="brand-tag">${esc(BRAND.taglineDocs)}</span></div></td>
          </tr>
        </table>
        <div class="gold-rule"></div>

        <table class="cards-table">
          <tr>
            <td>
              <div class="card">
                <div class="card-head">${iconSvg('user')}<span>${partyCardTitle}</span></div>
                <table class="meta-table">
                  ${metaRow(iconSvg('user'), t('voucher.partyNameLabel'), partyName)}
                  ${metaRow(iconSvg('receipt'), t('voucher.invoiceNoLabel'), invoiceNo)}
                  ${metaRow(iconSvg('doc'), t('voucher.purposeLabel'), purposeLabel)}
                  ${metaRow(iconSvg('doc'), t('voucher.statementLabel'), metaStatement)}
                  ${metaRow(iconSvg('user'), t('voucher.representativeLabel'), representative)}
                </table>
              </div>
            </td>
            <td>
              <div class="card">
                <div class="card-head">${iconSvg('tag')}<span>${t('voucher.voucherDataTitle')}</span></div>
                <table class="meta-table">
                  ${metaRow(iconSvg('tag'), t('voucher.voucherNoLabel'), `<span class="ltr">${voucherNo}</span>`)}
                  ${metaRow(iconSvg('calendar'), t('voucher.dateLabel'), `<span class="ltr">${voucherDate}</span>`)}
                  ${metaRow(iconSvg('receipt'), t('voucher.voucherTypeLabel'), `<span class="type-pill">${typeLabel}</span>`)}
                  ${metaRow(iconSvg('wallet'), t('voucher.cashboxLabel'), cashboxName)}
                  ${checksHtml ? metaRow(iconSvg('check'), t('voucher.payMethodLabel'), `<span class="type-pill">${esc(t('voucher.checkMethod'))}</span>`) : ''}
                  ${checksHtml ? metaRow(iconSvg('receipt'), t('voucher.checkLabel'), checksHtml) : ''}
                </table>
              </div>
            </td>
          </tr>
        </table>

        <div class="amount-box">
          <div class="amount-label">${amountHeading}</div>
          <div class="amount-value">${amountDisplay}</div>
          <div class="amount-words">${amountWords}</div>
          ${data.conversion ? `<div class="amount-words">${esc(t('voucher.convertedLine', { amount: formatAmountDisplay(data.conversion.amount, data.conversion.currencyCode), rate: Number(data.conversion.rate) }))}</div>` : ''}
        </div>

        <div class="narrative-box">
          <div class="narrative-head">${iconSvg('doc')}<span>${t('voucher.statementColon')}</span></div>
          <div class="narrative-text">${renderNarrativeHtml(data, accentColor)}</div>
        </div>

        <table class="sign-table">
          <tr>
            <td>
              <div class="sign-title">${iconSvg('wallet')}<span>${t('voucher.cashierTitle')}</span></div>
              ${renderSignFieldsHtml()}
            </td>
            <td>
              <div class="sign-title">${iconSvg('user')}<span>${receiverTitle}</span></div>
              ${renderSignFieldsHtml()}
            </td>
          </tr>
        </table>
      </div>

      ${renderVoucherFooterHtml(isReceipt)}
    </div>`;
}

export function renderVoucherA5Html(data: VoucherPrintData, options: VoucherRenderOptions = {}): string {
  const isReceipt = data.voucherType === 'RECEIPT';
  const accent = NAVY;
  const bw = options.colorMode === 'bw';
  const body = renderVoucherA5BodyHtml(data, options);
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="format-detection" content="telephone=no,email=no,address=no" />
  <title>${isReceipt ? t('voucher.docTitleReceipt') : t('voucher.docTitlePayment')}</title>
  <style>${voucherStyles(accent, '#f1edfa', bw)}</style>
</head>
<body>${body}</body>
</html>`;
}

export function voucherRowToPrintData(voucher: {
  voucher_no: string;
  voucher_type: 'RECEIPT' | 'PAYMENT';
  voucher_date: string;
  party_name: string;
  party_type?: string | null;
  amount: string;
  currency_code: string;
  exchange_rate_to_usd?: string | null;
  amount_usd?: string | null;
  convert_to_currency_code?: string | null;
  convert_rate?: string | null;
  converted_amount?: string | null;
  cashbox_name?: string | null;
  payment_method?: string | null;
  purpose?: string | null;
  description?: string | null;
  reference_document_no?: string | null;
  lines?: Array<{
    check_no?: string | null;
    check_bank_name?: string | null;
    check_details?: { checkNo?: string; bankName?: string; accountHolderName?: string | null; dueDate?: string | null } | null;
  }>;
}): VoucherPrintData {
  const checks = (voucher.lines ?? [])
    .map((l) => ({
      checkNo: l.check_no ?? l.check_details?.checkNo ?? '',
      bankName: l.check_bank_name ?? l.check_details?.bankName ?? '',
      dueDate: l.check_details?.dueDate ?? null,
      holder: l.check_details?.accountHolderName ?? null,
    }))
    .filter((c) => c.checkNo);
  return {
    voucherNo: voucher.voucher_no,
    voucherType: voucher.voucher_type,
    voucherDate: voucher.voucher_date,
    partyName: voucher.party_name,
    partyType: voucher.party_type ?? undefined,
    amount: voucher.amount,
    currencyCode: voucher.currency_code,
    exchangeRateToUsd: voucher.exchange_rate_to_usd ?? undefined,
    amountUsd: voucher.amount_usd ?? undefined,
    conversion: voucher.converted_amount && voucher.convert_to_currency_code && voucher.convert_rate
      ? { amount: voucher.converted_amount, currencyCode: voucher.convert_to_currency_code, rate: voucher.convert_rate } : null,
    cashboxName: voucher.cashbox_name ?? undefined,
    paymentMethod: voucher.payment_method,
    purpose: voucher.purpose ?? undefined,
    description: voucher.description,
    referenceDocumentNo: voucher.reference_document_no ?? undefined,
    checks: checks.length ? checks : undefined,
  };
}
