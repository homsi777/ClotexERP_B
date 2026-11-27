import i18n from '../../i18n/config';
import { getBranchPrintInfo } from './branchPrintInfo';

const t = (key: string) => i18n.t(key, { ns: 'terminology' });
// بيانات كل فرع مستقلة: عند غياب العنوان/الهاتف يبقى الحقل فارغاً ولا تُعرض بيانات فرع آخر.
const getLocation = () => getBranchPrintInfo()?.location ?? '';

export type DocumentFooterPreset = 'invoice' | 'voucher-receipt' | 'voucher-payment';

const getPresets = (): Record<DocumentFooterPreset, { phone: string; slogan: string; icon: 'star' | 'shield' | 'thread' }> => ({
  invoice: {
    phone: getBranchPrintInfo()?.phoneInvoice ?? '',
    slogan: t('documentFooter.invoiceSlogan'),
    icon: 'thread',
  },
  'voucher-receipt': {
    phone: getBranchPrintInfo()?.phoneVoucher ?? '',
    slogan: t('documentFooter.voucherReceiptSlogan'),
    icon: 'star',
  },
  'voucher-payment': {
    phone: getBranchPrintInfo()?.phoneVoucher ?? '',
    slogan: t('documentFooter.voucherPaymentSlogan'),
    icon: 'shield',
  },
});

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function footerIconSvg(kind: 'pin' | 'phone' | 'star' | 'shield' | 'thread'): string {
  const paths: Record<string, string> = {
    pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z',
    phone: 'M7 3h3l1 4-2 1a11 11 0 0 0 5 5l1-2 4 1v3a2 2 0 0 1-2 2A15 15 0 0 1 3 5a2 2 0 0 1 2-2Z',
    star: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7-5.4-4.7 7.1-.6L12 2Z',
    shield: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z',
    thread: 'M12 2C8 2 5 5 5 9c0 4 3 7 7 7s7-3 7-7c0-4-3-7-7-7Zm0 3a4 4 0 0 1 4 4c0 2.2-1.8 4-4 4S8 11.2 8 9a4 4 0 0 1 4-4Z',
  };
  return `<svg class="doc-footer-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[kind]}"/></svg>`;
}

export function documentFooterStyles(navy = '#4C3890', gold = '#B89854', bw = false): string {
  const text = bw ? '#111111' : navy;
  const rule = bw ? '#111111' : gold;

  return `
    .doc-footer-bar {
      background: #ffffff;
      color: ${text};
      border-top: 1.5px solid ${rule};
      padding: 7px 4px 2px;
      margin-top: auto;
      flex-shrink: 0;
    }
    .doc-footer-bar, .doc-footer-bar * {
      color: ${text} !important;
      -webkit-text-fill-color: ${text} !important;
    }
    .doc-footer-table { width: 100%; border-collapse: collapse; }
    .doc-footer-table td {
      vertical-align: middle;
      font-size: 9px;
      line-height: 1.55;
      font-weight: 500;
    }
    .doc-footer-right { text-align: right; }
    .doc-footer-center { text-align: center; }
    .doc-footer-left { text-align: left; line-height: 1.45; }
    .doc-footer-inline { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
    .doc-footer-inline-center { justify-content: center; margin: 0 auto; }
    .doc-footer-ico { display: none; }
    .doc-footer-phone {
      text-decoration: none !important;
      font-weight: 500;
      letter-spacing: 0.2px;
      white-space: nowrap;
      direction: ltr;
      unicode-bidi: embed;
    }
    .doc-footer-bar a,
    .doc-footer-bar a:link,
    .doc-footer-bar a:visited,
    .doc-footer-bar a:hover,
    .doc-footer-bar a:active {
      text-decoration: none !important;
      pointer-events: none;
    }
  `;
}

export function renderDocumentFooterHtml(
  preset: DocumentFooterPreset,
  bw = false,
  opts?: { slogan?: string },
): string {
  const cfg = getPresets()[preset];
  const slogan = opts?.slogan ?? cfg.slogan;
  const sloganIcon = footerIconSvg(cfg.icon);
  const phoneHtml = `<span class="doc-footer-phone">${esc(cfg.phone)}</span>`;

  return `
    <div class="doc-footer-bar">
      <table class="doc-footer-table" dir="rtl">
        <tr>
          <td class="doc-footer-right" style="width:34%;">
            <span class="doc-footer-inline">${footerIconSvg('pin')}<span>${esc(getLocation())}</span></span>
          </td>
          <td class="doc-footer-center" style="width:32%;">
            <span class="doc-footer-inline doc-footer-inline-center">${footerIconSvg('phone')}${phoneHtml}</span>
          </td>
          <td class="doc-footer-left" style="width:34%;">
            <span class="doc-footer-inline">${sloganIcon}<span>${esc(slogan)}</span></span>
          </td>
        </tr>
      </table>
    </div>`;
}
