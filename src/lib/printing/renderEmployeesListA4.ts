import { BRAND } from '../../branding';
import i18n from '../../i18n/config';
import { documentFooterStyles, renderDocumentFooterHtml } from './renderDocumentFooter';

const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";
const NAVY = '#4C3890';
const GOLD = '#B89854';
const ROWS_PER_PAGE = 28;

export interface EmployeeListRow { code: string; fullName: string; address: string; phone: string; salary: string; period: string; status: string }
export interface EmployeeListLabels { title: string; printDate: string; count: string; index: string; code: string; fullName: string; address: string; phone: string; salary: string; period: string; status: string; noData: string }

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** قائمة الموظفين A4 بقالب الهوية الجديدة: ترويسة (عنوان + تاريخ + عدد) والشعار وخط ذهبي، جدول بنفسجي، 28 صفاً بالصفحة وتذييل الفرع. */
export function renderEmployeesListA4Html(rows: EmployeeListRow[], L: EmployeeListLabels): string {
  const pages: EmployeeListRow[][] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  if (!pages.length) pages.push([]);
  const slogan = i18n.t('documentFooter.hrSlogan', { ns: 'terminology', defaultValue: 'نجاحنا يبدأ بفريقنا.. وقوتنا في ناسنا' });
  const body = pages.map((pageRows, pi) => `
  <section class="page">
    <div class="page-body">
      <div class="doc-head">
        <div class="doc-head-text">
          <div class="doc-title">${esc(L.title)}</div>
          <div class="doc-meta">${esc(L.printDate)}</div>
          <div class="doc-meta">${esc(L.count)}</div>
        </div>
        <div class="doc-head-brand"><img class="brand-logo" src="${BRAND.logoInline}" alt="${esc(BRAND.name)}" /></div>
      </div>
      <div class="gold-rule"></div>
      <table class="data-table">
        <thead><tr><th style="width:5%">${esc(L.index)}</th><th style="width:11%">${esc(L.code)}</th><th style="width:26%">${esc(L.fullName)}</th><th style="width:17%">${esc(L.address)}</th><th style="width:11%">${esc(L.phone)}</th><th style="width:13%">${esc(L.salary)}</th><th style="width:9%">${esc(L.period)}</th><th style="width:8%">${esc(L.status)}</th></tr></thead>
        <tbody>${pageRows.length ? pageRows.map((r, i) => `<tr><td class="num">${pi * ROWS_PER_PAGE + i + 1}</td><td class="num">${esc(r.code)}</td><td class="text">${esc(r.fullName)}</td><td class="text">${esc(r.address || '-')}</td><td class="num">${esc(r.phone || '-')}</td><td class="num">${esc(r.salary)}</td><td>${esc(r.period)}</td><td>${esc(r.status)}</td></tr>`).join('') : `<tr><td colspan="8">${esc(L.noData)}</td></tr>`}</tbody>
      </table>
    </div>
    <div class="page-no">${pi + 1} / ${pages.length}</div>
    ${renderDocumentFooterHtml('invoice', false, { slogan })}
  </section>`).join('');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8" /><title>${esc(L.title)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; font-family: ${FONT}; color: #1f1f1f; background: #fff; direction: rtl; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; height: 297mm; display: flex; flex-direction: column; padding: 8mm 10mm 6mm; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page-body { flex: 1 1 auto; min-height: 0; }
  .doc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .doc-title { font-size: 26px; font-weight: 900; color: ${NAVY}; margin-bottom: 4px; line-height: 1.2; }
  .doc-meta { font-size: 11.5px; color: #222; font-weight: 500; line-height: 1.5; }
  .brand-logo { height: 87px; width: auto; object-fit: contain; }
  .gold-rule { height: 1.5px; background: ${GOLD}; margin: 4px 0 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .data-table thead th { background: ${NAVY}; color: #fff; font-size: 10px; font-weight: 900; padding: 7px 4px; text-align: center; border-left: 1px solid rgba(255,255,255,.22); }
  .data-table thead th:last-child { border-left: none; }
  .data-table tbody td { padding: 6px 5px; font-size: 9.6px; font-weight: 500; text-align: center; border-bottom: 1px solid #ece7f6; vertical-align: middle; }
  .data-table tbody tr:nth-child(even) td { background: #f7f4fc; }
  .data-table td.text { text-align: right; }
  .data-table td.num { direction: ltr; unicode-bidi: embed; }
  .page-no { position: absolute; bottom: 14mm; left: 0; right: 0; text-align: center; font-size: 9px; color: #333; direction: ltr; }
  ${documentFooterStyles(NAVY, GOLD)}
  .doc-footer-bar { margin-top: auto; }
</style></head>
<body>${body}</body></html>`;
}
