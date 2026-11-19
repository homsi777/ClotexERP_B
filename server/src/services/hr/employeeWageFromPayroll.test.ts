/** TASK 019 — اختبارات اشتقاق أجر الموظف من سطر ملف المرتبات (بأرقام الملف الفعلية). */
import assert from 'node:assert/strict';
import { checkStoredWage, deriveEmployeeWage, guessWorkdayHoursFromLabel } from './employeeWageFromPayroll.js';

function testHallEmployeeUsesComprehensiveAndDerives75() {
  // صالة النسيج: شامل 16,000، أساسي 12,000.
  assert.deepEqual(deriveEmployeeWage({ comprehensive: 16000, base: 12000 }), {
    employeeWage: 16000,
    baseSharePercent: 75,
    source: 'COMPREHENSIVE',
  });
}

function testAdministrationEmployeeDerives80() {
  // الإدارة: شامل 26,000، أساسي 20,800.
  const r = deriveEmployeeWage({ comprehensive: 26000, base: 20800 });
  assert.equal(r.employeeWage, 26000);
  assert.equal(r.baseSharePercent, 80);
}

function testFallsBackToBasicWhenNoComprehensiveColumn() {
  const r = deriveEmployeeWage({ comprehensive: 0, base: 12000 });
  assert.deepEqual(r, { employeeWage: 12000, baseSharePercent: null, source: 'BASIC_FALLBACK' });
  assert.equal(deriveEmployeeWage({ comprehensive: null, base: 9000 }).source, 'BASIC_FALLBACK');
}

function testImpossibleShareIsNotInvented() {
  // أساسي أكبر من الشامل = بيانات شاذة ⇒ لا نسبة.
  assert.equal(deriveEmployeeWage({ comprehensive: 10000, base: 12000 }).baseSharePercent, null);
  assert.equal(deriveEmployeeWage({ comprehensive: 10000, base: 0 }).baseSharePercent, null);
}

function testStoredWageCheckFlagsOldBasicImports() {
  assert.equal(checkStoredWage(16000, 16000, 12000), 'MATCHES_COMPREHENSIVE');
  assert.equal(checkStoredWage(12000, 16000, 12000), 'MATCHES_BASIC'); // الاستيراد القديم الخاطئ المحتمل
  assert.equal(checkStoredWage(18000, 16000, 12000), 'DIFFERENT'); // تعديل راتب لاحق مشروع
  assert.equal(checkStoredWage(16000.4, 16000, 12000), 'MATCHES_COMPREHENSIVE'); // ضمن التسامح
}

function testWorkdayHoursGuessFromLabel() {
  assert.equal(guessWorkdayHoursFromLabel('مرتبات ادارة النسيج اكتوبر 2026'), 9);
  assert.equal(guessWorkdayHoursFromLabel('مرتبات إدارة النسيج'), 9);
  assert.equal(guessWorkdayHoursFromLabel('مرتبات صالة النسيج اكتوبر 2026'), 8);
  assert.equal(guessWorkdayHoursFromLabel(''), 8);
}

testHallEmployeeUsesComprehensiveAndDerives75();
testAdministrationEmployeeDerives80();
testFallsBackToBasicWhenNoComprehensiveColumn();
testImpossibleShareIsNotInvented();
testStoredWageCheckFlagsOldBasicImports();
testWorkdayHoursGuessFromLabel();
console.log('employeeWageFromPayroll tests passed');
