import assert from 'node:assert/strict';
import {
  FULL_CROP,
  IDENTITY_PARAMS,
  clampCrop,
  cropFromPoints,
  dragCrop,
  isIdentity,
  normalizeRotation,
  outputSize,
  parseEditParams,
  rotateBy,
  rotatedSize,
} from './imageEditMath';

// التدوير
assert.equal(normalizeRotation(-90), 270);
assert.equal(normalizeRotation(450), 90);
assert.equal(rotateBy(270, 90), 0);
assert.equal(rotateBy(0, -90), 270);
assert.equal(rotateBy(90, 180), 270);
assert.deepEqual(rotatedSize(400, 200, 90), { w: 200, h: 400 });
assert.deepEqual(rotatedSize(400, 200, 180), { w: 400, h: 200 });

// القص
assert.deepEqual(clampCrop({ x: -1, y: 2, w: 3, h: 0 }), { x: 0, y: 0.95, w: 1, h: 0.05 });
assert.equal(isIdentity(IDENTITY_PARAMS), true);
assert.equal(isIdentity({ rotation: 90, crop: FULL_CROP }), false);
assert.equal(isIdentity({ rotation: 0, crop: { x: 0.1, y: 0, w: 0.9, h: 1 } }), false);

// حجم الناتج: شيك 3000×1400 مقصوص إلى النصف الأيمن ومدوَّر 90 → 700×1500 (ثم تصغير للحد)
const o = outputSize(3000, 1400, { rotation: 90, crop: { x: 0, y: 0, w: 1, h: 0.5 } }, 2400);
assert.deepEqual(o.cropPx, { x: 0, y: 0, w: 1400, h: 1500 });
assert.ok(Math.max(o.w, o.h) <= 2400);
const big = outputSize(6000, 3000, IDENTITY_PARAMS, 2400);
assert.deepEqual([big.w, big.h], [2400, 1200], 'تصغير بنسبة الأبعاد دون تشويه');
assert.equal(Math.round((big.w / big.h) * 100), 200);

// السحب
const start = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
assert.deepEqual(dragCrop(start, 'move', 0.5, 0.5), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 'الحركة لا تخرج عن الحدود');
const e = dragCrop(start, 'e', 0.1, 0);
assert.equal(e.w.toFixed(2), '0.60');
assert.equal(e.x, 0.2);
const wHandle = dragCrop(start, 'w', 0.1, 0);
assert.equal(wHandle.x.toFixed(2), '0.30');
assert.equal((wHandle.x + wHandle.w).toFixed(2), '0.70', 'الحافة اليمنى ثابتة');
const nw = dragCrop(start, 'nw', 0.9, 0.9);
assert.ok(nw.w >= 0.05 && nw.h >= 0.05, 'الحد الأدنى للقص');
const se = dragCrop(start, 'se', 5, 5);
assert.equal(se.x + se.w, 1);
assert.equal(se.y + se.h, 1);
const cp = cropFromPoints(0.6, 0.7, 0.2, 0.1);
assert.deepEqual([cp.x, cp.y, +cp.w.toFixed(6), +cp.h.toFixed(6)], [0.2, 0.1, 0.4, 0.6]);

// إعادة الفتح من المعاملات المحفوظة
assert.deepEqual(parseEditParams({ rotation: 90, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }), { rotation: 90, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
assert.deepEqual(parseEditParams({ rotation: 180 }), { rotation: 180, crop: FULL_CROP });
assert.equal(parseEditParams(null), null);
assert.equal(parseEditParams('x'), null);
console.log('imageEditMath tests passed');
