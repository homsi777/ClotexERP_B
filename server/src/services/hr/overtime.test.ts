/** TASK 011 — اختبارات ساعات الإضافي (دالة صِرفة). */
import assert from 'node:assert/strict';
import {
  hourlyRateFromComprehensive,
  overtimeAmount,
  overtimeAmountForWage,
  computeMonthlyOvertime,
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

function testMonthlyOvertimeMatchesExcelRowTotal() {
  // صف «محمد بهاء» بالملف: شامل 11,000، ليلي 18 ساعة، عطلة×2 7 ساعات ⇒ 1,237.5 + 641.67 = 1,879.17.
  const r = computeMonthlyOvertime({ NIGHT: 18, HOLIDAY_X2: 7 }, 11000, 8);
  assert.equal(r.amountByCategory.NIGHT, 1237.5);
  assert.equal(r.amountByCategory.HOLIDAY_X2, 641.67);
  assert.equal(r.totalAmount, 1879.17);
  assert.equal(r.totalActualHours, 25);
  assert.equal(r.totalPaidHours, 41); // 18×1.5 + 7×2
}

function testAllFourCategoriesAndMultipliers() {
  // شامل 2,400 ⇒ أجر ساعة 10 (÷30÷8): نهاري 2×1.5=30 ، ليلي 2×1.5=30 ، عطلة×1 2=20 ، عطلة×2 2×2=40 ⇒ 120.
  const r = computeMonthlyOvertime({ DAY: 2, NIGHT: 2, HOLIDAY_X1: 2, HOLIDAY_X2: 2 }, 2400, 8);
  assert.equal(r.hourlyRate, 10);
  assert.deepEqual(r.amountByCategory, { DAY: 30, NIGHT: 30, HOLIDAY_X1: 20, HOLIDAY_X2: 40 });
  assert.equal(r.totalAmount, 120);
}

function testAdministrationWorkdayNineInMonthlyTotal() {
  const r = computeMonthlyOvertime({ DAY: 6 }, 26000, 9);
  assert.equal(r.totalAmount, 866.67);
}

function testEmptyOrInvalidMonthlyOvertime() {
  assert.equal(computeMonthlyOvertime({}, 11000).totalAmount, 0);
  assert.equal(computeMonthlyOvertime({ DAY: 5 }, 0).totalAmount, 0);
  assert.equal(computeMonthlyOvertime({ DAY: -3, NIGHT: Number.NaN }, 11000).totalAmount, 0);
}

testNormalDayHourIsOneAndHalf();
testMonthlyOvertimeMatchesExcelRowTotal();
testAllFourCategoriesAndMultipliers();
testAdministrationWorkdayNineInMonthlyTotal();
testEmptyOrInvalidMonthlyOvertime();
testExcelOctoberNightHoursCase();
testExcelOctoberMixedCase();
testInvalidWageGivesZero();
testFridayOrHolidayHourIsTwo();
testZeroOrNegativeHoursYieldZero();
testTotalAcrossMixedEntries();
testOvertimeAmountUsesHourlyRate();
console.log('overtime tests passed');
