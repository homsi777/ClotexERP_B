/** TASK 011 — اختبارات ساعات الإضافي (دالة صِرفة). */
import assert from 'node:assert/strict';
import { overtimePaidHours, totalOvertimePaidHours, overtimeAmount } from './overtime.js';

function testNormalDayHourIsOneAndHalf() {
  assert.equal(overtimePaidHours(4, 'NORMAL'), 6);
}

function testFridayOrHolidayHourIsTwo() {
  assert.equal(overtimePaidHours(3, 'FRIDAY_OR_HOLIDAY'), 6);
}

function testZeroOrNegativeHoursYieldZero() {
  assert.equal(overtimePaidHours(0, 'NORMAL'), 0);
  assert.equal(overtimePaidHours(-2, 'FRIDAY_OR_HOLIDAY'), 0);
}

function testTotalAcrossMixedEntries() {
  const total = totalOvertimePaidHours([
    { actualHours: 2, kind: 'NORMAL' }, // 3
    { actualHours: 5, kind: 'FRIDAY_OR_HOLIDAY' }, // 10
  ]);
  assert.equal(total, 13);
}

function testOvertimeAmountUsesHourlyRate() {
  // 13 ساعة مدفوعة × 50 = 650.
  const amount = overtimeAmount(
    [
      { actualHours: 2, kind: 'NORMAL' },
      { actualHours: 5, kind: 'FRIDAY_OR_HOLIDAY' },
    ],
    50,
  );
  assert.equal(amount, 650);
}

testNormalDayHourIsOneAndHalf();
testFridayOrHolidayHourIsTwo();
testZeroOrNegativeHoursYieldZero();
testTotalAcrossMixedEntries();
testOvertimeAmountUsesHourlyRate();
console.log('overtime tests passed');
