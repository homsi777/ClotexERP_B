import { BRAND } from '../../branding';
import { payslipItemRows, type PayslipItem } from './payslipItems';
import i18n from '../../i18n/config';
import { documentFooterStyles, renderDocumentFooterHtml } from './renderDocumentFooter';

const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";
const NAVY = '#4C3890';
const GOLD = '#B89854';

export type PayslipData = {
  payrollNo: string;
  periodMonth: number;
  periodYear: number;
  employeeCode: string;
  fullName: string;
  jobTitle?: string | null;
  department?: string | null;
  factory?: string | null;
  baseSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  currencyCode: string;
  /** عناوين عربية → قيم — من excel_detail، يُعرَض كما هو بلا تعديل. */
  detail?: Record<string, unknown> | null;
  /** TASK 011: بنود تفصيل الراتب (مكافأة، مشتريات، تسويات…) — تُعرض بجدول مستقل إن وُجدت. */
  items?: PayslipItem[] | null;
};


function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthName(m: number): string {
  const names = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return names[m - 1] || String(m);
}

function detailRows(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return '';
  const entries = Object.entries(detail).filter(([, v]) => v !== '' && v !== null && v !== undefined && Number(v) !== 0);
  if (!entries.length) return '';
  return entries
    .map(([label, value]) => `<tr><td class="det-label">${esc(label)}</td><td class="det-value">${esc(value)}</td></tr>`)
    .join('');
}

export function renderPayslipA4Html(data: PayslipData): string {
  const detailHtml = detailRows(data.detail);
  const itemsHtml = payslipItemRows(data.items);
  const slogan = i18n.t('documentFooter.hrSlogan', { ns: 'terminology', defaultValue: 'نجاحنا يبدأ بفريقنا.. وقوتنا في ناسنا' });
  const cur = esc(data.currencyCode);
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8" />
<title>كشف راتب - ${esc(data.fullName)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4 portrait; margin: 0; }
  html, body { width: 210mm; font-family: ${FONT}; color:#1f1f1f; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { width: 210mm; min-height: 297mm; display:flex; flex-direction:column; padding: 8mm 10mm 6mm; }
  .page-body { flex: 1 1 auto; }
  .header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
  .title { font-size:26px; font-weight:900; color:${NAVY}; line-height:1.2; margin-bottom:4px; }
  .subtitle { font-size:12px; color:#222; font-weight:500; line-height:1.5; }
  .logo { height:87px; width:auto; object-fit:contain; }
  .gold-rule { height:1.5px; background:${GOLD}; margin:4px 0 12px; }
  .section { background:${NAVY}; color:#fff; font-size:12px; font-weight:900; padding:6px 10px; text-align:right; margin-top:12px; }
  .info-table { width:100%; border-collapse:collapse; }
  .info-table td { padding:6px 10px; border-bottom:1px solid #ece7f6; font-size:11px; font-weight:500; }
  .info-table tr:nth-child(odd) td { background:#f7f4fc; }
  .info-label { font-weight:900 !important; color:#1f1f1f; width:16%; text-align:right; }
  .amount-table { width:100%; border-collapse:collapse; }
  .amount-table td { padding:8px 10px; border-bottom:1px solid #ece7f6; font-size:12.5px; }
  .amount-table .lbl { font-weight:900; color:#1f1f1f; text-align:right; }
  .amount-table .val { text-align:left; font-weight:900; direction:ltr; }
  .net-box { display:flex; justify-content:space-between; align-items:center; margin-top:8px; border:1px solid ${NAVY}; background:#f1edfa; padding:10px 12px; color:${NAVY}; font-weight:900; font-size:15px; }
  .net-box .v { direction:ltr; font-size:18px; }
  .detail-table { width:100%; border-collapse:collapse; font-size:10px; }
  .detail-table td { padding:4px 10px; border-bottom:1px solid #ece7f6; }
  .detail-table tr:nth-child(odd) td { background:#f7f4fc; }
  .det-label { color:#333; text-align:right; }
  .det-value { text-align:left; direction:ltr; font-weight:900; }
  .det-note { color:#94a3b8; font-weight:400; }
  .sign-table { width:100%; border-collapse:separate; border-spacing:12px 0; margin:22px -12px 0; width:calc(100% + 24px); }
  .sign-table td { width:50%; border:1px solid #ddd5ee; padding:8px 12px 12px; font-size:11px; font-weight:900; color:${NAVY}; vertical-align:top; }
  .sign-line { margin-top:26px; border-bottom:1px solid ${NAVY}; opacity:.7; }
  ${documentFooterStyles(NAVY, GOLD)}
</style>
</head>
<body>
  <div class="page">
    <div class="page-body">
      <div class="header">
        <div>
          <div class="title">كشف راتب</div>
          <div class="subtitle">${monthName(data.periodMonth)} ${data.periodYear}</div>
          <div class="subtitle" dir="ltr" style="text-align:right">${esc(data.payrollNo)}</div>
        </div>
        <img src="${BRAND.logoInline}" alt="${esc(BRAND.name)}" class="logo" />
      </div>
      <div class="gold-rule"></div>

      <div class="section">بيانات الموظف</div>
      <table class="info-table">
        <tr><td class="info-label">رمز الموظف</td><td>${esc(data.employeeCode)}</td><td class="info-label">الاسم</td><td>${esc(data.fullName)}</td></tr>
        <tr><td class="info-label">المصنع</td><td>${esc(data.factory) || '—'}</td><td class="info-label">القسم</td><td>${esc(data.department) || '—'}</td></tr>
        <tr><td class="info-label">الوظيفة</td><td>${esc(data.jobTitle) || '—'}</td><td class="info-label">العملة</td><td>${cur}</td></tr>
      </table>

      <div class="section">ملخص الراتب</div>
      <table class="amount-table">
        <tr><td class="lbl">الأجر الأساسي</td><td class="val">${money(data.baseSalary)}</td></tr>
        <tr><td class="lbl">الاستحقاقات الإضافية</td><td class="val">${money(data.allowances)}</td></tr>
        <tr><td class="lbl">إجمالي المستقطع</td><td class="val">-${money(data.deductions)}</td></tr>
      </table>
      <div class="net-box"><span>الصافي النهائي</span><span class="v">${money(data.netSalary)} ${cur}</span></div>

      ${itemsHtml ? `<div class="section">بنود الراتب</div><table class="detail-table">${itemsHtml}</table>` : ''}
      ${detailHtml ? `<div class="section">تفاصيل الكشف الأصلي</div><table class="detail-table">${detailHtml}</table>` : ''}

      <table class="sign-table">
        <tr>
          <td>توقيع المحاسب<div class="sign-line">&nbsp;</div></td>
          <td>توقيع الموظف (استلام)<div class="sign-line">&nbsp;</div></td>
        </tr>
      </table>
    </div>
    ${renderDocumentFooterHtml('invoice', false, { slogan })}
  </div>
</body>
</html>`;
}
