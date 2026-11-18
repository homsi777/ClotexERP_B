import assert from 'node:assert/strict';
import {
  canTransitionMachineStatus,
  normalizeReferenceCode,
  validateMachineOwnership,
  validateMaintenanceCompletion,
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

console.log('manufacturingReferenceRules tests passed');
