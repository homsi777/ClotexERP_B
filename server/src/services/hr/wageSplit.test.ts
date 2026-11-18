/** TASK 011 — اختبارات تقسيم الأجر الشامل 70/30. */
import assert from 'node:assert/strict';
import { splitComprehensiveWage } from './wageSplit.js';

function testBashirExample() {
  // مثال HR: 10,000 ⇒ 7,000 أساسي + 3,000 بدلات.
  assert.deepEqual(splitComprehensiveWage(10000), { comprehensive: 10000, base: 7000, allowances: 3000 });
}

function testSumAlwaysEqualsComprehensive() {
  for (const w of [9999.99, 12345.67, 1, 0.05, 16000, 7777.77]) {
    const r = splitComprehensiveWage(w);
    assert.equal(Math.round((r.base + r.allowances) * 100) / 100, r.comprehensive, `w=${w}`);
  }
}

function testZeroAndInvalid() {
  assert.deepEqual(splitComprehensiveWage(0), { comprehensive: 0, base: 0, allowances: 0 });
  assert.deepEqual(splitComprehensiveWage(Number.NaN), { comprehensive: 0, base: 0, allowances: 0 });
}

testBashirExample();
testSumAlwaysEqualsComprehensive();
testZeroAndInvalid();
console.log('wageSplit tests passed');
