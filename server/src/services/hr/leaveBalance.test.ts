/** TASK 011 — اختبارات رصيد الإجازات السنوي (دالة صِرفة) على أمثلة بشير/HR نفسها. */
import assert from 'node:assert/strict';
import { computeAnnualLeaveBalance, tenYearsInsuranceDateFrom } from './leaveBalance.js';

function testFirstYearNineMonthsExample() {
  // مثال HR: 9 أشهر متبقية × 15 ÷ 12 = 11.25 ⇒ 12 يوماً.
  const r = computeAnnualLeaveBalance({ hireDate: '2026-04-01', year: 2026 });
  assert.equal(r.rawDays, 11.25);
  assert.equal(r.days, 12);
}

function testSecondYearMixedRatesExample() {
  // مثال HR: 3 أشهر × 15 + 9 أشهر × 21 ⇒ 19.5 ⇒ 20 يوماً (تقريب واحد على المجموع).
  const r = computeAnnualLeaveBalance({ hireDate: '2026-04-01', year: 2027 });
  assert.equal(r.rawDays, 19.5);
  assert.equal(r.days, 20);
}

function testHiredBeforeSept2025Gets21() {
  const r = computeAnnualLeaveBalance({ hireDate: '2024-06-15', year: 2026 });
  assert.equal(r.days, 21);
  assert.equal(r.rawDays, 21);
}

function testHiredExactlyAtCutoffIsNotLegacy() {
  // 1 أيلول 2025 نفسه ليس "قبل" — يبدأ بمعدل 15 في سنة التعيين.
  const r = computeAnnualLeaveBalance({ hireDate: '2025-09-01', year: 2025 });
  assert.equal(r.rawDays, 5); // 4 أشهر (أيلول–كانون1) × 15 ÷ 12
  assert.equal(r.days, 5);
}

function testHiredDayBeforeCutoffIsLegacy() {
  const r = computeAnnualLeaveBalance({ hireDate: '2025-08-31', year: 2026 });
  assert.equal(r.days, 21);
}

function testOver50Gets30() {
  const r = computeAnnualLeaveBalance({ hireDate: '2020-01-01', year: 2026, birthDate: '1970-03-10' });
  assert.equal(r.days, 30);
}

function testExactly50DoesNotYetGet30UntilExceeded() {
  // يكمل 50 في 2026-07-01: قبله 21، بعده (من اليوم التالي) 30 ⇒ يُدمج بتقريب واحد.
  const r = computeAnnualLeaveBalance({ hireDate: '2020-01-01', year: 2026, birthDate: '1976-07-01' });
  assert.ok(r.rawDays > 21 && r.rawDays < 30, `raw=${r.rawDays}`);
}

function testTenYearsInsuranceGets30() {
  const r = computeAnnualLeaveBalance({ hireDate: '2015-01-01', year: 2026, tenYearsInsuranceDate: '2025-01-01' });
  assert.equal(r.days, 30);
}

function testUsableFromIsThreeMonthsAfterHire() {
  assert.equal(computeAnnualLeaveBalance({ hireDate: '2026-04-01', year: 2026 }).usableFrom, '2026-07-01');
  // آخر الشهر: 31 تشرين الثاني غير موجود ⇒ يُقصّ لآخر يوم صالح.
  assert.equal(computeAnnualLeaveBalance({ hireDate: '2026-08-31', year: 2026 }).usableFrom, '2026-11-30');
}

function testTenYearsInsuranceDateDerivation() {
  assert.equal(tenYearsInsuranceDateFrom('2016-05-10'), '2026-05-10');
  assert.equal(tenYearsInsuranceDateFrom('2016-02-29'), '2026-02-28'); // 2026 ليست كبيسة
  assert.equal(tenYearsInsuranceDateFrom(null), null);
  assert.equal(tenYearsInsuranceDateFrom('bad'), null);
}

function testInsuranceReachedMidYearSplitsRates() {
  // يكمل 10 سنوات تأمين في 2026-07-01: النصف الأول 21 والثاني 30 ⇒ بين 21 و30.
  const r = computeAnnualLeaveBalance({
    hireDate: '2020-01-01', year: 2026, tenYearsInsuranceDate: tenYearsInsuranceDateFrom('2016-07-01'),
  });
  assert.ok(r.rawDays > 21 && r.rawDays < 30, `raw=${r.rawDays}`);
}

function testNotYetHiredInYearGivesZero() {
  const r = computeAnnualLeaveBalance({ hireDate: '2027-02-01', year: 2026 });
  assert.equal(r.days, 0);
}

testFirstYearNineMonthsExample();
testSecondYearMixedRatesExample();
testHiredBeforeSept2025Gets21();
testHiredExactlyAtCutoffIsNotLegacy();
testHiredDayBeforeCutoffIsLegacy();
testOver50Gets30();
testExactly50DoesNotYetGet30UntilExceeded();
testTenYearsInsuranceGets30();
testUsableFromIsThreeMonthsAfterHire();
testTenYearsInsuranceDateDerivation();
testInsuranceReachedMidYearSplitsRates();
testNotYetHiredInYearGivesZero();
console.log('leaveBalance tests passed');
