/** TASK 011 — اختبارات بنود تفصيل سطر الراتب (دالة صِرفة). */
import assert from 'node:assert/strict';
import {
  applyItemsChange,
  isAdditionKind,
  payrollItemSchema,
  sumPayrollItems,
  validatePayrollItems,
} from './payrollLineItems.js';

function testKindSigns() {
  for (const k of ['BONUS', 'TRANSPORT', 'ANNUAL_INCREASE', 'SALARY_ADJUSTMENT', 'SETTLEMENT_ADD', 'OVERTIME'] as const) {
    assert.equal(isAdditionKind(k), true, k);
  }
  for (const k of ['PURCHASE_DEDUCTION', 'SETTLEMENT_DEDUCT'] as const) {
    assert.equal(isAdditionKind(k), false, k);
  }
}

function testAttendanceKindsAreDeductionsAndNeedNoNote() {
  for (const k of ['ATTENDANCE_ABSENCE_DEDUCTION', 'ATTENDANCE_HALF_PAY_DEDUCTION'] as const) {
    assert.equal(isAdditionKind(k), false, k);
    assert.equal(payrollItemSchema.safeParse({ kind: k, amount: 100 }).success, true, k);
    assert.equal(validatePayrollItems([{ kind: k, amount: 100 }]), null, k);
  }
  const r = applyItemsChange({ baseSalary: 9000, allowances: 0, deductions: 0 }, [], [
    { kind: 'ATTENDANCE_ABSENCE_DEDUCTION', amount: 2325 },
    { kind: 'ATTENDANCE_HALF_PAY_DEDUCTION', amount: 300 },
  ]);
  assert.deepEqual(r, { baseSalary: 9000, allowances: 0, deductions: 2625, net: 6375 });
}

function testSumSeparatesAdditionsAndDeductions() {
  const t = sumPayrollItems([
    { kind: 'BONUS', amount: 300 },
    { kind: 'TRANSPORT', amount: 150.5 },
    { kind: 'PURCHASE_DEDUCTION', amount: 200 },
    { kind: 'SETTLEMENT_DEDUCT', amount: 50.25 },
  ]);
  assert.deepEqual(t, { additions: 450.5, deductions: 250.25 });
}

function testSalaryAdjustmentRequiresReason() {
  const bad = validatePayrollItems([{ kind: 'SALARY_ADJUSTMENT', amount: 500, note: '  ' }]);
  assert.match(bad ?? '', /السبب/);
  assert.equal(validatePayrollItems([{ kind: 'SALARY_ADJUSTMENT', amount: 500, note: 'ترقية' }]), null);
}

function testSettlementsRequireNoteButBonusDoesNot() {
  assert.ok(validatePayrollItems([{ kind: 'SETTLEMENT_ADD', amount: 10 }]));
  assert.ok(validatePayrollItems([{ kind: 'SETTLEMENT_DEDUCT', amount: 10, note: null }]));
  assert.equal(validatePayrollItems([{ kind: 'BONUS', amount: 10 }]), null);
}

function testSchemaRejectsZeroNegativeAndUnknownKind() {
  assert.equal(payrollItemSchema.safeParse({ kind: 'BONUS', amount: 0 }).success, false);
  assert.equal(payrollItemSchema.safeParse({ kind: 'BONUS', amount: -5 }).success, false);
  assert.equal(payrollItemSchema.safeParse({ kind: 'GIFT', amount: 5 }).success, false);
  assert.equal(payrollItemSchema.safeParse({ kind: 'BONUS', amount: '12.5' }).success, true);
}

function testApplyKeepsImportedAmountsAndUpdatesNet() {
  // سطر مستورد: أساسي 10000، استحقاقات مستوردة 2000، استقطاعات مستوردة 1500.
  const line = { baseSalary: 10000, allowances: 2000, deductions: 1500 };
  const r1 = applyItemsChange(line, [], [
    { kind: 'BONUS', amount: 300 },
    { kind: 'PURCHASE_DEDUCTION', amount: 200 },
  ]);
  assert.deepEqual(r1, { baseSalary: 10000, allowances: 2300, deductions: 1700, net: 10600 });
}

function testReapplyingSameItemsIsIdempotentNotDoubleCounted() {
  const items = [
    { kind: 'BONUS' as const, amount: 300 },
    { kind: 'PURCHASE_DEDUCTION' as const, amount: 200 },
  ];
  const once = applyItemsChange({ baseSalary: 10000, allowances: 2000, deductions: 1500 }, [], items);
  // إعادة الحفظ بنفس البنود: السابق = items، الجديد = items ⇒ لا تغيير.
  const twice = applyItemsChange(once, items, items);
  assert.deepEqual(twice, once);
}

function testReplacingItemsSwapsOnlyTheItemEffect() {
  const base = { baseSalary: 10000, allowances: 2000, deductions: 1500 };
  const first = applyItemsChange(base, [], [{ kind: 'BONUS', amount: 300 }]);
  const second = applyItemsChange(first, [{ kind: 'BONUS', amount: 300 }], [{ kind: 'BONUS', amount: 500 }]);
  assert.equal(second.allowances, 2500);
  assert.equal(second.net, 11000);
}

function testRemovingAllItemsRestoresOriginal() {
  const base = { baseSalary: 10000, allowances: 2000, deductions: 1500 };
  const items = [{ kind: 'TRANSPORT' as const, amount: 400 }];
  const withItems = applyItemsChange(base, [], items);
  const back = applyItemsChange(withItems, items, []);
  assert.deepEqual(back, { ...base, net: 10500 });
}

testKindSigns();
testAttendanceKindsAreDeductionsAndNeedNoNote();
testSumSeparatesAdditionsAndDeductions();
testSalaryAdjustmentRequiresReason();
testSettlementsRequireNoteButBonusDoesNot();
testSchemaRejectsZeroNegativeAndUnknownKind();
testApplyKeepsImportedAmountsAndUpdatesNet();
testReapplyingSameItemsIsIdempotentNotDoubleCounted();
testReplacingItemsSwapsOnlyTheItemEffect();
testRemovingAllItemsRestoresOriginal();
console.log('payrollLineItems tests passed');
