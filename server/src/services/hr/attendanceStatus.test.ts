/** TASK 013 — اختبارات أثر حالات الحضور (دالة صِرفة). */
import assert from 'node:assert/strict';
import {
  ATTENDANCE_STATUS_CODES,
  attendanceEffectOf,
  summarizeMonthlyStatuses,
  usesGraduatedAbsenceRule,
} from './attendanceStatus.js';

const rec = (date: string, status: string | null) => ({ date, status });

function testEffectsMatchHrTable() {
  assert.equal(attendanceEffectOf('ANNUAL'), 'LEAVE_BALANCE');
  assert.equal(attendanceEffectOf('CASUAL'), 'LEAVE_BALANCE');
  assert.equal(attendanceEffectOf('PERMITTED_ABSENCE'), 'LEAVE_BALANCE');
  assert.equal(attendanceEffectOf('SICK'), 'HALF_PAY');
  assert.equal(attendanceEffectOf('MARRIAGE'), 'HALF_PAY');
  assert.equal(attendanceEffectOf('UNAUTH_ABSENCE'), 'ABSENCE_PENALTY');
  for (const c of ['BAN', 'MISSION', 'MISSION_LEAVE', 'OFFICIAL_HOLIDAY']) assert.equal(attendanceEffectOf(c), 'COMPANY', c);
  assert.equal(attendanceEffectOf('REST'), 'DAY_OFF');
  assert.equal(attendanceEffectOf('NOPE'), null);
  assert.equal(new Set(ATTENDANCE_STATUS_CODES).size, ATTENDANCE_STATUS_CODES.length, 'رموز فريدة');
}

function testRuleSwitchesOnFirstNovember2026() {
  assert.equal(usesGraduatedAbsenceRule(2026, 10), false);
  assert.equal(usesGraduatedAbsenceRule(2026, 11), true);
  assert.equal(usesGraduatedAbsenceRule(2027, 1), true);
  assert.equal(usesGraduatedAbsenceRule(2025, 12), false);
}

function testGraduatedNovemberFourAbsencesMatchesBashirExample() {
  // أجر شامل 9000 ⇒ أجر يوم 300؛ 4 غيابات في نوفمبر 2026 ⇒ 2325 (مثال بشير).
  const s = summarizeMonthlyStatuses(
    ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12'].map((d) => rec(d, 'UNAUTH_ABSENCE')),
    9000, 2026, 11,
  );
  assert.equal(s.absenceRule, 'GRADUATED');
  assert.equal(s.absenceDeduction, 2325);
  assert.equal(s.absenceWageDeduction, 1200);
  assert.equal(s.absencePenaltyDeduction, 1125);
}

function testLegacyOctoberIsTwoFlatDaysPerAbsence() {
  // يطابق ملف Excel لأكتوبر: غياب يوم واحد = 2.00 × أجر اليوم.
  const s = summarizeMonthlyStatuses([rec('2026-10-10', 'UNAUTH_ABSENCE')], 13400, 2026, 10);
  assert.equal(s.absenceRule, 'LEGACY_FLAT_2');
  assert.equal(s.dayWage, 446.67);
  assert.equal(s.absenceDeduction, 893.34);
}

function testSickAndMarriageHalfPayAndLeaveBalanceDays() {
  const s = summarizeMonthlyStatuses(
    [rec('2026-11-01', 'SICK'), rec('2026-11-02', 'MARRIAGE'), rec('2026-11-03', 'ANNUAL'), rec('2026-11-04', 'CASUAL'), rec('2026-11-05', 'PERMITTED_ABSENCE')],
    9000, 2026, 11,
  );
  assert.equal(s.halfPayDays, 2);
  assert.equal(s.halfPayDeduction, 300); // 2 × 300 × 0.5
  assert.equal(s.leaveDaysUsed, 3);
  assert.equal(s.absenceDeduction, 0);
  assert.equal(s.totalPayrollDeduction, 300);
}

function testCompanyBorneAndRestHaveNoEffect() {
  const s = summarizeMonthlyStatuses(
    ['BAN', 'MISSION', 'MISSION_LEAVE', 'OFFICIAL_HOLIDAY', 'REST', 'COMP_LEAVE'].map((c, i) => rec(`2026-11-0${i + 1}`, c)),
    9000, 2026, 11,
  );
  assert.equal(s.totalPayrollDeduction, 0);
  assert.equal(s.leaveDaysUsed, 0);
}

function testUnknownAndEmptyStatusesIgnoredButReported() {
  const s = summarizeMonthlyStatuses([rec('2026-11-01', null), rec('2026-11-02', 'WEIRD')], 9000, 2026, 11);
  assert.equal(s.totalPayrollDeduction, 0);
  assert.deepEqual(s.unknownStatuses, ['WEIRD']);
}

function testFifthAbsenceIsFlatTwoDays() {
  const s = summarizeMonthlyStatuses(
    Array.from({ length: 5 }, (_, i) => rec(`2026-11-0${i + 1}`, 'UNAUTH_ABSENCE')), 9000, 2026, 11,
  );
  assert.equal(s.absenceDeduction, 2925); // 2325 + 600
}

function testZeroWageGivesZeroDeductions() {
  const s = summarizeMonthlyStatuses([rec('2026-11-01', 'UNAUTH_ABSENCE')], 0, 2026, 11);
  assert.equal(s.totalPayrollDeduction, 0);
}

testEffectsMatchHrTable();
testRuleSwitchesOnFirstNovember2026();
testGraduatedNovemberFourAbsencesMatchesBashirExample();
testLegacyOctoberIsTwoFlatDaysPerAbsence();
testSickAndMarriageHalfPayAndLeaveBalanceDays();
testCompanyBorneAndRestHaveNoEffect();
testUnknownAndEmptyStatusesIgnoredButReported();
testFifthAbsenceIsFlatTwoDays();
testZeroWageGivesZeroDeductions();
console.log('attendanceStatus tests passed');
