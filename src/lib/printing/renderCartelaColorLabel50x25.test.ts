import assert from 'node:assert/strict';
import { code128Modules, code128Sequence, code128WidthMm } from './code128Width';

/** فكّ التسلسل بإعادة تفسير مجموعات B/C — للتأكد أن الترميز المضغوط يُرجِع النص نفسه تماماً. */
function decode(seq: number[]): string {
  const data = seq.slice(0, -2);
  const check = seq[seq.length - 2];
  assert.equal(seq[seq.length - 1], 106, 'نهاية');
  const sum = data.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  assert.equal(sum, check, 'رقم الفحص صحيح');
  let set = data[0] === 105 ? 'C' : 'B';
  assert.ok(data[0] === 104 || data[0] === 105, 'يبدأ بحرف بداية');
  let out = '';
  for (const c of data.slice(1)) {
    if (c === 100) set = 'B';
    else if (c === 99) set = 'C';
    else out += set === 'C' ? String(c).padStart(2, '0') : String.fromCharCode(c + 32);
  }
  return out;
}

// مثال معياري: «123456» بمجموعة C
assert.deepEqual(code128Sequence('123456', true), [105, 12, 34, 56, 44, 106]);
// الرجوع إلى B فقط يطابق السلوك القديم
assert.deepEqual(code128Sequence('AB', false), [104, 33, 34, (104 + 33 + 34 * 2) % 103, 106]);

// تدوير كامل لقيم متنوعة (رقمية، مختلطة، قصيرة، فردية)
for (const v of ['22274', '222740', '0001-V1', '00012345', 'V1', '12', '123', 'ABC123', '5114-C-01', '0000021', '9']) {
  assert.equal(decode(code128Sequence(v, true)), v, `compact ${v}`);
  assert.equal(decode(code128Sequence(v, false)), v, `plain ${v}`);
}

// الضغط يقلل العرض للأرقام الطويلة
assert.ok(code128Modules('222740', true) < code128Modules('222740', false), '6 أرقام: أضيق');
assert.ok(code128Modules('22274', true) < code128Modules('22274', false), '5 أرقام: أضيق');
assert.equal(code128Modules('222740', true), 5 * 11 + 13 + 0 * 11, '6 أرقام = 68 شريطاً');

// العرض بالمليمتر: يتناسب مع الطول ولا يملأ الملصق (50 مم)
assert.ok(code128WidthMm('22274') <= 22, '5 أرقام ≈ 20 مم');
assert.ok(code128WidthMm('0001-V1') < 50);
assert.equal(code128WidthMm('0123456789012345678901234567890123456789'), 44, 'حد أعلى');
assert.ok(code128WidthMm('1') >= 18, 'حد أدنى');
console.log('code128 compact tests passed');
