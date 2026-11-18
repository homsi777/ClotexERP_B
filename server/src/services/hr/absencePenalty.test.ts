/** TASK 011 — اختبارات جزاء الغياب بدون إذن (دالة صِرفة). */
import assert from 'node:assert/strict';
import {
  dayWageFromComprehensive,
  absencePenaltyFactor,
  computeMonthlyAbsencePenalty,
} from './absencePenalty.js';

function testDayWageIsComprehensiveOver30() {
  assert.equal(dayWageFromComprehensive(9000), 300);
  assert.equal(dayWageFromComprehensive(16000), 533.33);
  assert.equal(dayWageFromComprehensive(0), 0);
}

function testGraduatedFactorsMatchBashirTable() {
  assert.equal(absencePenaltyFactor(1), 0.25);
  assert.equal(absencePenaltyFactor(2), 0.5);
  assert.equal(absencePenaltyFactor(3), 1.0);
  assert.equal(absencePenaltyFactor(4), 2.0);
}

function testFifthAndBeyondIsFlatTwoDays() {
  // من اليوم الخامس: خصم يومين ثابتين ⇒ معامل 1 (أجر اليوم × 2).
  assert.equal(absencePenaltyFactor(5), 1);
  assert.equal(absencePenaltyFactor(9), 1);
}

function testFourDayExampleMatchesBashirNote() {
  // مثال بشير: أجر اليوم 300 جنيه، 4 أيام غياب ⇒ إجمالي 2,325.
  const r = computeMonthlyAbsencePenalty(9000, 4); // 9000/30 = 300
  assert.equal(r.dayWage, 300);
  assert.deepEqual(r.rows.map((x) => x.totalDeduction), [375, 450, 600, 900]);
  assert.equal(r.totalWageDeduction, 1200);
  assert.equal(r.totalPenaltyDeduction, 1125);
  assert.equal(r.totalDeduction, 2325);
}

function testFifthDayAddsFlatTwoDayWages() {
  // اليوم الخامس يضيف 2 × أجر اليوم = 600 فوق إجمالي الأربعة (2325).
  const r = computeMonthlyAbsencePenalty(9000, 5);
  assert.equal(r.rows[4].totalDeduction, 600);
  assert.equal(r.totalDeduction, 2925);
}

function testZeroAbsenceNoDeduction() {
  const r = computeMonthlyAbsencePenalty(9000, 0);
  assert.equal(r.totalDeduction, 0);
  assert.equal(r.rows.length, 0);
}

testDayWageIsComprehensiveOver30();
testGraduatedFactorsMatchBashirTable();
testFifthAndBeyondIsFlatTwoDays();
testFourDayExampleMatchesBashirNote();
testFifthDayAddsFlatTwoDayWages();
testZeroAbsenceNoDeduction();
console.log('absencePenalty tests passed');
