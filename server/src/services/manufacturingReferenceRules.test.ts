import assert from 'node:assert/strict';
import {
  canTransitionMachineStatus,
  normalizeReferenceCode,
  validateMachineOwnership,
  validateMaintenanceCompletion,
  canTransitionManufacturingWorkOrder,
  validateWorkOrderAllocations,
} from './manufacturingReferenceRules.js';

assert.equal(canTransitionMachineStatus('ACTIVE', 'MAINTENANCE'), true);
assert.equal(canTransitionMachineStatus('ACTIVE', 'ACTIVE'), false);
assert.equal(canTransitionMachineStatus('OUT_OF_SERVICE', 'ACTIVE'), false);
assert.equal(canTransitionMachineStatus('OUT_OF_SERVICE', 'MAINTENANCE'), true);
assert.equal(normalizeReferenceCode(' loom  12 '), 'LOOM-12');
assert.equal(validateMachineOwnership({ ownershipType: 'CUSTODY', ownerName: ' ' }), 'اسم المالك مطلوب عندما تكون الماكينة أمانة');
assert.equal(validateMachineOwnership({ ownershipType: 'CUSTODY', ownerName: 'شركة النسيج' }), null);

const started = new Date('2026-01-01T10:00:00Z');
assert.equal(validateMaintenanceCompletion({ status: 'COMPLETED', occurredAt: started }), 'وقت إكمال الصيانة مطلوب');
assert.equal(
  validateMaintenanceCompletion({ status: 'COMPLETED', occurredAt: started, completedAt: new Date('2026-01-01T09:00:00Z') }),
  'وقت الإكمال لا يمكن أن يسبق وقت بداية الحدث',
);
assert.equal(
  validateMaintenanceCompletion({ status: 'COMPLETED', occurredAt: started, completedAt: new Date('2026-01-01T11:00:00Z') }),
  null,
);

assert.equal(canTransitionManufacturingWorkOrder('DRAFT', 'RELEASED'), true);
assert.equal(canTransitionManufacturingWorkOrder('RELEASED', 'IN_PROGRESS'), true);
assert.equal(canTransitionManufacturingWorkOrder('IN_PROGRESS', 'COMPLETED'), true);
assert.equal(canTransitionManufacturingWorkOrder('COMPLETED', 'DRAFT'), false);
assert.equal(canTransitionManufacturingWorkOrder('CANCELLED', 'RELEASED'), false);
assert.equal(validateWorkOrderAllocations({ targetLengthM: 1000, allocations: [] }), null);
assert.equal(validateWorkOrderAllocations({ targetLengthM: 1000, allocations: [
  { customerOrderId: 'o1', customerOrderLineId: 'l1', allocatedLengthM: 400 },
  { customerOrderId: 'o2', customerOrderLineId: 'l2', allocatedLengthM: 600 },
] }), null);
assert.equal(validateWorkOrderAllocations({ targetLengthM: 1000, allocations: [
  { customerOrderId: 'o1', customerOrderLineId: 'l1', allocatedLengthM: 1001 },
] }), 'إجمالي الأطوال المخصصة لأوردرات العملاء يتجاوز طول أمر الإنتاج');
assert.equal(validateWorkOrderAllocations({ targetLengthM: 1000, allocations: [
  { customerOrderId: 'o1', customerOrderLineId: 'l1', allocatedLengthM: 200 },
  { customerOrderId: 'o1', customerOrderLineId: 'l1', allocatedLengthM: 200 },
] }), 'لا يمكن تكرار سطر أوردر العميل في أمر الإنتاج نفسه');

console.log('manufacturingReferenceRules tests passed');
