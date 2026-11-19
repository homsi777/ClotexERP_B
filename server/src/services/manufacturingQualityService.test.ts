import assert from "node:assert/strict";
import { calculateRollReceiptBalance, validateQualityBreakdown } from "./manufacturingQualityService.js";

const balanced = validateQualityBreakdown({ producedLengthM: 100, cleanLengthM: 82, reworkLengthM: 8, rejectedLengthM: 5, pendingLengthM: 5 });
assert.equal(balanced.balanced, true);
assert.equal(balanced.differenceM, 0);
assert.equal(validateQualityBreakdown({ producedLengthM: 100, cleanLengthM: 90, reworkLengthM: 0, rejectedLengthM: 0, pendingLengthM: 0 }).balanced, false);
assert.throws(() => validateQualityBreakdown({ producedLengthM: 100, cleanLengthM: -1, reworkLengthM: 1, rejectedLengthM: 0, pendingLengthM: 100 }), /INVALID_QUALITY_QUANTITY/);

const partial = calculateRollReceiptBalance({ approvedCleanLengthM: 82, previouslyReceivedLengthM: 40, newRollLengthsM: [20, 12] });
assert.equal(partial.receivedAfterM, 72);
assert.equal(partial.differenceM, 10);
assert.equal(partial.exceedsApproved, false);
assert.equal(partial.closesBatch, false);
assert.equal(calculateRollReceiptBalance({ approvedCleanLengthM: 82, previouslyReceivedLengthM: 72, newRollLengthsM: [10] }).closesBatch, true);
assert.equal(calculateRollReceiptBalance({ approvedCleanLengthM: 82, previouslyReceivedLengthM: 72, newRollLengthsM: [11] }).exceedsApproved, true);
console.log("manufacturingQualityService tests passed");
