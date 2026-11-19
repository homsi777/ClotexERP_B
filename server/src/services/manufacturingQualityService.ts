const tolerance = 0.0005;

export function validateQualityBreakdown(input: {
  producedLengthM: number; cleanLengthM: number; reworkLengthM: number; rejectedLengthM: number; pendingLengthM: number;
}): { totalClassifiedM: number; differenceM: number; balanced: boolean } {
  const values = [input.producedLengthM, input.cleanLengthM, input.reworkLengthM, input.rejectedLengthM, input.pendingLengthM];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("INVALID_QUALITY_QUANTITY");
  const totalClassifiedM = input.cleanLengthM + input.reworkLengthM + input.rejectedLengthM + input.pendingLengthM;
  const differenceM = input.producedLengthM - totalClassifiedM;
  return { totalClassifiedM, differenceM, balanced: Math.abs(differenceM) <= tolerance };
}

export function calculateRollReceiptBalance(input: {
  approvedCleanLengthM: number; previouslyReceivedLengthM: number; newRollLengthsM: number[];
}): { receivedAfterM: number; differenceM: number; exceedsApproved: boolean; closesBatch: boolean } {
  const values = [input.approvedCleanLengthM, input.previouslyReceivedLengthM, ...input.newRollLengthsM];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("INVALID_ROLL_QUANTITY");
  const receivedAfterM = input.previouslyReceivedLengthM + input.newRollLengthsM.reduce((sum, value) => sum + value, 0);
  const differenceM = input.approvedCleanLengthM - receivedAfterM;
  return { receivedAfterM, differenceM, exceedsApproved: differenceM < -tolerance, closesBatch: Math.abs(differenceM) <= tolerance };
}
