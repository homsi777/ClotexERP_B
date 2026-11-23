import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateRollLandedCost,
  computeLandedCostSummary,
} from './purchaseImportLandedCostService.js';

/** مكافئ toBeCloseTo(expected, digits): الفرق أقل من 0.5 × 10^-digits. */
function assertClose(actual: number, expected: number, digits: number) {
  assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -digits, `${actual} غير قريب من ${expected} (${digits} منازل)`);
}

describe('computeLandedCostSummary', () => {
  it('computes total landed cost and per-meter rate', () => {
    const s = computeLandedCostSummary({
      goodsValue: 50_000,
      shippingCost: 3_000,
      customsCost: 4_000,
      otherCost1: 300,
      otherCost2: 200,
      shipmentWeightKg: 4_200,
      totalLengthM: 10_172.4,
    });
    assert.equal(s.additionalCostsTotal, 7_500);
    assert.equal(s.totalLandedCost, 57_500);
    assertClose(s.landedCostPerMeter, 57_500 / 10_172.4, 4);
    assertClose(s.landedCostPerKg, 57_500 / 4_200, 4);
  });

  it('rejects zero goods value', () => {
    assert.throws(
      () =>
        computeLandedCostSummary({
          goodsValue: 0,
          shippingCost: 0,
          customsCost: 0,
          otherCost1: 0,
          otherCost2: 0,
          shipmentWeightKg: 100,
          totalLengthM: 100,
        }),
      /قيمة البضاعة/,
    );
  });
});

describe('allocateRollLandedCost', () => {
  const perMeter = 57_500 / 10_172.4;

  it('allocates roll cost by meters and estimates weight from shipment total', () => {
    const roll = allocateRollLandedCost({
      lengthM: 63,
      totalLengthM: 10_172.4,
      landedCostPerMeter: perMeter,
      shipmentWeightKg: 4_200,
      excelActualWeightKg: null,
    });
    assertClose(roll.unitCostPerMeter, perMeter, 4);
    assertClose(roll.rollLandedValue, perMeter * 63, 2);
    assertClose(roll.estimatedWeightKg, (63 / 10_172.4) * 4_200, 2);
  });

  it('prefers excel weight when present', () => {
    const roll = allocateRollLandedCost({
      lengthM: 50,
      totalLengthM: 100,
      landedCostPerMeter: 10,
      shipmentWeightKg: 200,
      excelActualWeightKg: 12.5,
    });
    assert.equal(roll.estimatedWeightKg, 12.5);
  });
});
