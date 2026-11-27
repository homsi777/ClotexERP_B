import assert from 'node:assert/strict';
import { setBranchPrintInfo } from './branchPrintInfo';
import { renderDocumentFooterHtml } from './renderDocumentFooter';

const SYRIA = /حلب|944 555 080|الجمهورية العربية السورية/;

// فرع بلا بيانات: لا تظهر بيانات أي فرع آخر
setBranchPrintInfo(null);
for (const p of ['invoice', 'voucher-receipt', 'voucher-payment'] as const) assert.doesNotMatch(renderDocumentFooterHtml(p), SYRIA, p);

// تركيا (فارغ مؤقتاً)
setBranchPrintInfo({ location: '', phoneInvoice: '', phoneVoucher: '' });
assert.doesNotMatch(renderDocumentFooterHtml('invoice'), SYRIA);

// مصر
setBranchPrintInfo({ location: 'الجمهورية العربية المصرية / القاهرة', phoneInvoice: '+201278518975', phoneVoucher: '+201500231211' });
assert.match(renderDocumentFooterHtml('invoice'), /\+201278518975/);
assert.match(renderDocumentFooterHtml('voucher-receipt'), /\+201500231211/);
assert.doesNotMatch(renderDocumentFooterHtml('invoice'), SYRIA);

// سوريا (قيم صريحة من الفرع نفسه)
setBranchPrintInfo({ location: 'الجمهورية العربية السورية / حلب', phoneInvoice: '09 44 555 080', phoneVoucher: '+963 944 555 080' });
assert.match(renderDocumentFooterHtml('invoice'), /حلب/);
setBranchPrintInfo(null);
console.log('branch footer isolation ok');
