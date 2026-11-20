import assert from 'node:assert/strict';
import { renderCartelaDeliveryVoucherHtml, type CartelaDeliveryVoucherLabels } from './renderCartelaDeliveryVoucher';

const L: CartelaDeliveryVoucherLabels = {
  title: 'سند تسليم كارتيلات', customer: 'العميل', deliveryDate: 'تاريخ التسليم', barcode: 'الباركود', cartela: 'الكارتيلة',
  code: 'الكود', color: 'اللون', qty: 'العدد', dueDate: 'موعد الإرجاع', dueUndefined: 'غير محدد', notes: 'ملاحظات',
  receiverSignature: 'توقيع المستلم', total: 'إجمالي العدد',
};

const html = renderCartelaDeliveryVoucherHtml(
  {
    voucherNo: 'CV000001',
    customerName: 'بركات <script>alert(1)</script>',
    deliveryDate: '2026-11-20',
    notes: 'a & b',
    rows: [
      { barcode: '0004', cartelaTitle: 'ANDRIA OXFORD', artCode: 'ANDRIA OXFORD', colorName: null, qty: 1, dueDate: null },
      { barcode: '0041', cartelaTitle: 'قطن', artCode: 'A9', colorName: 'أحمر', qty: 3, dueDate: '2026-12-05' },
    ],
  },
  L,
);

// الأعمدة بالترتيب المطلوب (من اليمين في RTL: الباركود أولاً)
const headers = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
assert.deepEqual(headers, ['الباركود', 'الكارتيلة', 'الكود', 'اللون', 'العدد', 'موعد الإرجاع']);
// ترويسة السند: العنوان والرقم والعميل والتاريخ بصيغة DD-MM-YYYY
assert.match(html, /سند تسليم كارتيلات/);
assert.match(html, /CV000001/);
assert.match(html, /20-11-2026/);
assert.match(html, /05-12-2026/);
// موعد غير محدد يظهر نصاً، والإجمالي مجموع الأعداد
assert.match(html, /غير محدد/);
assert.match(html, /إجمالي العدد: 4/);
// الهروب من HTML (لا حقن)
assert.ok(!html.includes('<script>alert(1)</script>'));
assert.match(html, /&lt;script&gt;/);
assert.match(html, /a &amp; b/);
// توقيع المستلم، وطباعة A5 أفقي بألوان دقيقة
assert.match(html, /توقيع المستلم/);
assert.match(html, /size: A5 landscape/);
assert.match(html, /print-color-adjust: exact/);
console.log('renderCartelaDeliveryVoucher tests passed');
