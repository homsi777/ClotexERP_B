import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareRow } from './stockImportJobService.js';

// قيد fabric_rolls: gsm و width_cm بخانتين عشريتين وأكبر من صفر؛ 0.004 كانت تُقرَّب في القاعدة إلى 0.00 فتُفشل الدفعة كلها.
test('stock import: tiny gsm/width values never reach the DB as 0.00', () => {
  const base = { itemName: 'اوكارنيا', quantity: 50, colorName: 'ساده' };
  const tiny = prepareRow({ ...base, gsm: 0.004, widthCm: 0.003 } as never, 1);
  assert.equal(tiny.gsm, null); assert.equal(tiny.widthCm, null);
  const ok = prepareRow({ ...base, gsm: 150.126, widthCm: 149.999 } as never, 2);
  assert.equal(ok.gsm, 150.13); assert.equal(ok.widthCm, 150);
  const none = prepareRow({ ...base, gsm: 0 } as never, 3);
  assert.equal(none.gsm, null);
});
