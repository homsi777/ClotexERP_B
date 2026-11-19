/** TASK 016 — اختبارات تقسيم الأجر الشامل، بأرقام ملفات المرتبات الفعلية. */
import assert from 'node:assert/strict';
import { splitComprehensiveWage, splitIncentives } from './wageSplit.js';

function testHallSplit75() {
  // صالة النسيج: شامل 16,000 ⇒ أساسي 12,000 + حوافز 4,000 (كما في الملف).
  assert.deepEqual(splitComprehensiveWage(16000, 75), { comprehensive: 16000, base: 12000, allowances: 4000 });
}

function testAdministrationSplit80() {
  // الإدارة: شامل 26,000 ⇒ أساسي = 26000/1.25 = 20,800 + حوافز 5,200.
  assert.deepEqual(splitComprehensiveWage(26000, 80), { comprehensive: 26000, base: 20800, allowances: 5200 });
}

function testBashirExample70() {
  assert.deepEqual(splitComprehensiveWage(10000, 70), { comprehensive: 10000, base: 7000, allowances: 3000 });
}

function testIncentivesSplit35_65() {
  // الصف الأول بالملف: حوافز 4,000 ⇒ انتظام 1,400 + جودة 2,600.
  assert.deepEqual(splitIncentives(4000), { regularity: 1400, quality: 2600 });
}

function testSumAlwaysEqualsComprehensive() {
  for (const pct of [70, 75, 80]) {
    for (const w of [9999.99, 12345.67, 1, 0.05, 16000, 7777.77]) {
      const r = splitComprehensiveWage(w, pct);
      assert.equal(Math.round((r.base + r.allowances) * 100) / 100, r.comprehensive, `w=${w} pct=${pct}`);
    }
  }
  const i = splitIncentives(1234.57);
  assert.equal(Math.round((i.regularity + i.quality) * 100) / 100, 1234.57);
}

function testInvalidInputs() {
  const zero = { comprehensive: 0, base: 0, allowances: 0 };
  assert.deepEqual(splitComprehensiveWage(0, 75), zero);
  assert.deepEqual(splitComprehensiveWage(Number.NaN, 75), zero);
  assert.deepEqual(splitComprehensiveWage(1000, 0), zero);
  assert.deepEqual(splitComprehensiveWage(1000, 101), zero);
  assert.deepEqual(splitIncentives(-5), { regularity: 0, quality: 0 });
}

testHallSplit75();
testAdministrationSplit80();
testBashirExample70();
testIncentivesSplit35_65();
testSumAlwaysEqualsComprehensive();
testInvalidInputs();
console.log('wageSplit tests passed');
