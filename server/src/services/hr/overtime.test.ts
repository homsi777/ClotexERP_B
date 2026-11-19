/** TASK 011 — اختبارات ساعات الإضافي (دالة صِرفة). */
import assert from 'node:assert/strict';
import {
  hourlyRateFromComprehensive,
  overtimeAmount,
  overtimeAmountForWage,
  overtimePaidHours,
  totalOvertimePaidHours,
} from './overtime.js';

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

function testExcelOctoberNightHoursCase() {
  // ملف مرتبات أكتوبر: شامل 13,800، 8 ساعات ليلية (×1.5) ⇒ 690 بالضبط.
  assert.equal(hourlyRateFromComprehensive(13800), 57.5);
  assert.equal(overtimeAmountForWage([{ actualHours: 8, kind: 'NORMAL' }], 13800), 690);
}

function testExcelOctoberMixedCase() {
  // شامل 11,000: 18 ساعة ليلية (×1.5) = 1,237.5 ، و7 ساعات عطلة (×2) = 641.67.
  assert.equal(overtimeAmountForWage([{ actualHours: 18, kind: 'NORMAL' }], 11000), 1237.5);
  assert.equal(overtimeAmountForWage([{ actualHours: 7, kind: 'FRIDAY_OR_HOLIDAY' }], 11000), 641.67);
}

function testAdministrationNineHourDayMatchesExcelFormula() {
  // صيغة الإدارة بالملف: (الشامل ÷ 11.25) × (ساعات ÷ 24) × 1.5 ⇒ 26,000: 6 ساعات = 866.67.
  const excel = Math.round((26000 / 11.25) * (6 / 24) * 1.5 * 100) / 100;
  assert.equal(excel, 866.67);
  assert.equal(overtimeAmountForWage([{ actualHours: 6, kind: 'NORMAL' }], 26000, 9), excel);
  // وبافتراض 8 ساعات (الخطأ السابق) تختلف القيمة — هذا ما نمنعه.
  assert.notEqual(overtimeAmountForWage([{ actualHours: 6, kind: 'NORMAL' }], 26000, 8), excel);
}

function testInvalidWageGivesZero() {
  assert.equal(hourlyRateFromComprehensive(0), 0);
  assert.equal(overtimeAmountForWage([{ actualHours: 5, kind: 'NORMAL' }], -10), 0);
}

testNormalDayHourIsOneAndHalf();
testExcelOctoberNightHoursCase();
testExcelOctoberMixedCase();
testInvalidWageGivesZero();
testFridayOrHolidayHourIsTwo();
testZeroOrNegativeHoursYieldZero();
testTotalAcrossMixedEntries();
testOvertimeAmountUsesHourlyRate();
console.log('overtime tests passed');
