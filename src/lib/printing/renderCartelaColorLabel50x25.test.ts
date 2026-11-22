import assert from 'node:assert/strict';
import { code128WidthMm } from './code128Width';

// عرض باركود ملصق اللون الفرعي (5×2.5 سم): يتناسب مع طول الرمز ولا يملأ عرض الملصق
assert.equal(code128WidthMm('0001-V1'), 28, '7 أحرف ← 28 مم');
assert.ok(code128WidthMm('1') >= 22, 'حد أدنى');
assert.equal(code128WidthMm('0123456789012345678901234567890123456789'), 44, 'حد أعلى للرموز الطويلة');
assert.ok(code128WidthMm('0001-V1') < code128WidthMm('0001-V1-LONGER'), 'الرمز الأطول أعرض');
assert.ok(code128WidthMm('0001-V1') < 50, 'لا يملأ عرض الملصق (50 مم)');
console.log('code128Width tests passed');
