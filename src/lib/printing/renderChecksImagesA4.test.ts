import assert from 'node:assert/strict';
import { buildCheckInfoHtml, buildChecksOriginalImagesHtml, type CheckImagesPrintItem, type CheckPrintInfo } from './renderChecksImagesA4';

const info = (n: string, over: Partial<CheckPrintInfo> = {}): CheckPrintInfo => ({
  check_no: n,
  bank_name: 'بنك مصر',
  party_name: 'شركة النور',
  amount: '12500',
  currency_code: 'EGP',
  received_date: '2026-11-01',
  due_date: '2026-12-20',
  ...over,
});
const IMG = (n: number) => `data:image/jpeg;base64,/9j/${'A'.repeat(10 + n)}`;
const item = (n: string, imgs: number, over: Partial<CheckPrintInfo> = {}): CheckImagesPrintItem => ({
  info: info(n, over),
  images: Array.from({ length: imgs }, (_, i) => ({ side: i === 0 ? 'FRONT' : 'BACK', data: IMG(i + Number(n)) })),
});

// 5 شيكات بصور: خمس كتل، كل صورة داخل كتلة لا تنقسم، وبلا شعار
const five = buildChecksOriginalImagesHtml({ items: [1, 2, 3, 4, 5].map((n) => item(String(n), 1)), includeInfo: false });
assert.equal(five.printedImages, 5);
assert.equal((five.html.match(/class="item"/g) ?? []).length, 5);
assert.equal((five.html.match(/<img /g) ?? []).length, 5);
assert.ok(/break-inside:\s*avoid/.test(five.html) && /page-break-inside:\s*avoid/.test(five.html), 'لا تقسيم للصورة بين صفحتين');
assert.ok(!/logo|BRAND|brand/i.test(five.html), 'لا شعار ولا إضافات');
assert.ok(/max-width:\s*100%/.test(five.html) && /object-fit:\s*contain/.test(five.html) && /width:\s*auto;\s*height:\s*auto/.test(five.html), 'نسبة الأبعاد بلا تمديد');

// بلا معلومات: صور فقط، لا عناوين ولا بيانات
assert.ok(!five.html.includes('class="info"'));
assert.ok(!five.html.includes('تم استلام الشيك من'));

// مع المعلومات: تحت كل صورة مباشرة (داخل نفس الكتلة)
const withInfo = buildChecksOriginalImagesHtml({ items: [item('11', 1), item('12', 1)], includeInfo: true });
assert.equal((withInfo.html.match(/class="info"/g) ?? []).length, 2);
for (const block of withInfo.html.split('<div class="item">').slice(1)) {
  assert.ok(block.indexOf('<img') < block.indexOf('class="info"'), 'المعلومات بعد الصورة');
}
assert.ok(withInfo.html.includes('تم استلام الشيك من') && withInfo.html.includes('شركة النور'));
assert.ok(withInfo.html.includes('تاريخ الاستلام') && withInfo.html.includes('2026-11-01'));
assert.ok(withInfo.html.includes('12,500.00 EGP'));
assert.ok(withInfo.html.includes('2026-12-20'));

// شيك صادر: معلومات التسليم والمستفيد بدل القبض
const out = buildCheckInfoHtml(info('9', { status: 'PAID_OUT', delivered_at: '2026-11-15', party_name: 'مورد الخيط' }));
assert.ok(out.includes('سُلِّم إلى') && out.includes('مورد الخيط') && out.includes('تاريخ التسليم') && out.includes('2026-11-15'));
assert.ok(!out.includes('تم استلام الشيك من'));

// شيك بلا صورة: يُتخطّى ويُبلَّغ عنه (لا يُطبع بصمت)
const mixed = buildChecksOriginalImagesHtml({ items: [item('21', 1), item('22', 0), item('23', 1)], includeInfo: false });
assert.equal(mixed.printedImages, 2);
assert.deepEqual(mixed.missing.map((m) => m.check_no), ['22']);

// الوجه الخلفي اختياري
const frontOnly = buildChecksOriginalImagesHtml({ items: [item('31', 2)], includeInfo: true });
assert.equal(frontOnly.printedImages, 1);
const both = buildChecksOriginalImagesHtml({ items: [item('31', 2)], includeInfo: true, includeBack: true });
assert.equal(both.printedImages, 2);
assert.equal((both.html.match(/class="info"/g) ?? []).length, 1, 'المعلومات مرة واحدة تحت الأمامية');
assert.ok(both.html.includes('الوجه الخلفي'));

// ترتيب الإدخال محفوظ
const order = buildChecksOriginalImagesHtml({ items: [item('3', 1), item('1', 1), item('2', 1)], includeInfo: true });
const pos = ['3', '1', '2'].map((n) => order.html.indexOf(`alt="${n}"`));
assert.ok(pos[0] < pos[1] && pos[1] < pos[2]);

// هروب HTML
const evil = buildChecksOriginalImagesHtml({ items: [item('<b>x</b>', 1, { party_name: '"><script>' })], includeInfo: true });
assert.ok(!evil.html.includes('<script>') && !evil.html.includes('<b>x</b>'));
console.log('renderChecksImagesA4 tests passed');
