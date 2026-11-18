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

export const MANUFACTURING_WORK_ORDER_STATUSES = ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type ManufacturingWorkOrderStatus = (typeof MANUFACTURING_WORK_ORDER_STATUSES)[number];

const WORK_ORDER_TRANSITIONS: Record<ManufacturingWorkOrderStatus, readonly ManufacturingWorkOrderStatus[]> = {
  DRAFT: ['RELEASED', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionManufacturingWorkOrder(from: ManufacturingWorkOrderStatus, to: ManufacturingWorkOrderStatus): boolean {
  return from !== to && WORK_ORDER_TRANSITIONS[from].includes(to);
}

export function validateWorkOrderAllocations(input: {
  targetLengthM: number;
  allocations: Array<{ customerOrderId: string; customerOrderLineId: string; allocatedLengthM: number }>;
}): string | null {
  if (!Number.isFinite(input.targetLengthM) || input.targetLengthM <= 0) return 'الطول المستهدف يجب أن يكون أكبر من صفر';
  const seen = new Set<string>();
  let total = 0;
  for (const allocation of input.allocations) {
    if (!allocation.customerOrderId || !allocation.customerOrderLineId) return 'مرجع أوردر العميل وسطره مطلوبان';
    if (!Number.isFinite(allocation.allocatedLengthM) || allocation.allocatedLengthM <= 0) return 'طول تخصيص الأوردر يجب أن يكون أكبر من صفر';
    if (seen.has(allocation.customerOrderLineId)) return 'لا يمكن تكرار سطر أوردر العميل في أمر الإنتاج نفسه';
    seen.add(allocation.customerOrderLineId);
    total += allocation.allocatedLengthM;
  }
  if (total - input.targetLengthM > 0.0005) return 'إجمالي الأطوال المخصصة لأوردرات العملاء يتجاوز طول أمر الإنتاج';
  return null;
}
