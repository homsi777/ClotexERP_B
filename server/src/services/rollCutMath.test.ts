/** TASK 009 — اختبارات validateRollCut (دالة صِرفة، بلا قاعدة بيانات). */
import assert from 'node:assert/strict';
import { validateRollCut } from './rollCutMath.js';

function ok(r: ReturnType<typeof validateRollCut>) {
  assert.equal(r.ok, true);
  return r as Extract<typeof r, { ok: true }>;
}

function testPartialCutLeavesRemainder() {
  const r = ok(validateRollCut({ currentLengthM: 100, cutLengthM: 30, status: 'AVAILABLE' }));
  assert.equal(r.remainingLengthM, 70);
  assert.equal(r.fullRoll, false);
}

function testCutEqualToFullLengthIsFullRoll() {
  const r = ok(validateRollCut({ currentLengthM: 50, cutLengthM: 50, status: 'AVAILABLE' }));
  assert.equal(r.fullRoll, true);
  assert.equal(r.remainingLengthM, 0);
}

function testReservedRollAllowed() {
  assert.equal(validateRollCut({ currentLengthM: 10, cutLengthM: 5, status: 'RESERVED' }).ok, true);
}

function testSoldRollRejected() {
  const r = validateRollCut({ currentLengthM: 10, cutLengthM: 5, status: 'SOLD' });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'NOT_AVAILABLE');
}

function testCutExceedingLengthRejected() {
  const r = validateRollCut({ currentLengthM: 20, cutLengthM: 25, status: 'AVAILABLE' });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'EXCEEDS_LENGTH');
}

function testZeroOrNegativeCutRejected() {
  assert.equal(validateRollCut({ currentLengthM: 20, cutLengthM: 0, status: 'AVAILABLE' }).ok, false);
  assert.equal(validateRollCut({ currentLengthM: 20, cutLengthM: -3, status: 'AVAILABLE' }).ok, false);
}

function testFloatingPointRemainderRounded() {
  const r = ok(validateRollCut({ currentLengthM: 12.5, cutLengthM: 4.2, status: 'AVAILABLE' }));
  assert.equal(r.remainingLengthM, 8.3);
}

testPartialCutLeavesRemainder();
testCutEqualToFullLengthIsFullRoll();
testReservedRollAllowed();
testSoldRollRejected();
testCutExceedingLengthRejected();
testZeroOrNegativeCutRejected();
testFloatingPointRemainderRounded();
console.log('rollCutMath tests passed');
