/** TASK 011 — اختبارات تركيب الأجر الشامل والصافي (دالة صِرفة). */
import assert from 'node:assert/strict';
import { computeComprehensiveWage, computeNetWage } from './payrollComposition.js';

function testComprehensiveSumsAllDefinedParts() {
  const c = computeComprehensiveWage({
    baseSalary: 12000,
    annualIncreases: 1000,
    salaryAdjustment: 500,
    transportAllowance: 800,
    otherAllowances: 200,
  });
  assert.equal(c, 14500);
}

function testComprehensiveIgnoresMissingParts() {
  assert.equal(computeComprehensiveWage({ baseSalary: 9000 }), 9000);
}

function testNetAddsEntitlementsSubtractsDeductions() {
  const r = computeNetWage({
    comprehensiveWage: 14500,
    overtime: 650,
    bonus: 300,
    settlementsAdd: 100,
    absenceDeduction: 2325,
    purchaseDeductions: 500,
    settlementsDeduct: 75,
  });
  assert.equal(r.totalAdditions, 1050);
  assert.equal(r.totalDeductions, 2900);
  assert.equal(r.netWage, 12650);
}

function testNetWithNoAdjustmentsEqualsComprehensive() {
  const r = computeNetWage({ comprehensiveWage: 9000 });
  assert.equal(r.netWage, 9000);
}

testComprehensiveSumsAllDefinedParts();
testComprehensiveIgnoresMissingParts();
testNetAddsEntitlementsSubtractsDeductions();
testNetWithNoAdjustmentsEqualsComprehensive();
console.log('payrollComposition tests passed');
