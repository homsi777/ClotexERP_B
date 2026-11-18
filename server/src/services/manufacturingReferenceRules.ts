export const MACHINE_STATUSES = ['ACTIVE', 'STOPPED', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

const ALLOWED_MACHINE_STATUS_TRANSITIONS: Record<MachineStatus, readonly MachineStatus[]> = {
  ACTIVE: ['STOPPED', 'MAINTENANCE', 'OUT_OF_SERVICE'],
  STOPPED: ['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE'],
  MAINTENANCE: ['ACTIVE', 'STOPPED', 'OUT_OF_SERVICE'],
  OUT_OF_SERVICE: ['MAINTENANCE'],
};

export function canTransitionMachineStatus(from: MachineStatus, to: MachineStatus): boolean {
  return from !== to && ALLOWED_MACHINE_STATUS_TRANSITIONS[from].includes(to);
}

export function normalizeReferenceCode(value: string): string {
  return value.trim().replace(/\s+/g, '-').toUpperCase();
}

export function validateMachineOwnership(input: { ownershipType: 'COMPANY' | 'CUSTODY'; ownerName?: string | null }): string | null {
  if (input.ownershipType === 'CUSTODY' && !input.ownerName?.trim()) {
    return 'اسم المالك مطلوب عندما تكون الماكينة أمانة';
  }
  return null;
}

export function validateMaintenanceCompletion(input: {
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  occurredAt: Date;
  completedAt?: Date | null;
}): string | null {
  if (input.status === 'COMPLETED' && !input.completedAt) return 'وقت إكمال الصيانة مطلوب';
  if (input.completedAt && input.completedAt < input.occurredAt) return 'وقت الإكمال لا يمكن أن يسبق وقت بداية الحدث';
  return null;
}
