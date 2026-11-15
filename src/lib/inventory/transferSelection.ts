export interface TransferRoll {
  id: string;
  item_id: string;
  color_id: string | null;
  warehouse_id: string;
  location_id: string | null;
  status: string;
  length_m: string;
  actual_weight_kg: string | null;
  calculated_weight_kg: string | null;
}

export function eligibleTransferRoll(r: TransferRoll, warehouseId: string, locationId?: string) {
  return r.warehouse_id === warehouseId && (!locationId || r.location_id === locationId)
    && r.status === 'AVAILABLE' && Number.isFinite(Number(r.length_m)) && Number(r.length_m) > 0;
}

export function mergeTransferSelection<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  return [...new Map([...current, ...incoming].map((r) => [r.id, r])).values()];
}

export function groupTransferRolls<T extends TransferRoll>(rolls: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const roll of rolls) {
    const key = `${roll.item_id}:${roll.color_id ?? '__no_color__'}`;
    const group = groups.get(key);
    if (group) group.push(roll);
    else groups.set(key, [roll]);
  }
  return [...groups.values()];
}

export function transferColorRolls<T extends TransferRoll>(rolls: T[], itemId: string, colorId: string | null): T[] {
  return rolls.filter((roll) => roll.item_id === itemId && roll.color_id === colorId);
}

export function transferTotals(rolls: TransferRoll[]) {
  let meters = 0, kilograms = 0, unknownWeight = 0, estimatedWeight = 0;
  for (const r of rolls) {
    meters += Number(r.length_m);
    const weight = r.actual_weight_kg ?? r.calculated_weight_kg;
    if (weight == null || !Number.isFinite(Number(weight))) unknownWeight++;
    else { kilograms += Number(weight); if (r.actual_weight_kg == null) estimatedWeight++; }
  }
  return { rolls: rolls.length, meters, kilograms, unknownWeight, estimatedWeight };
}

// No page cap: fail visibly if pagination is incomplete rather than silently selecting a partial fabric.
export async function loadAllTransferRolls<T extends TransferRoll>(
  loadPage: (page: number) => Promise<{ data: T[]; total: number }>,
  warehouseId: string, locationId?: string, cancelled: () => boolean = () => false,
): Promise<T[]> {
  const all = new Map<string, T>();
  for (let page = 1; ; page++) {
    if (cancelled()) return [];
    const result = await loadPage(page);
    if (cancelled()) return [];
    const previousSize = all.size;
    for (const roll of result.data) all.set(roll.id, roll);
    if (all.size >= result.total) return [...all.values()].filter((r) => eligibleTransferRoll(r, warehouseId, locationId));
    if (!result.data.length || previousSize === all.size) throw new Error('لم يكتمل تحميل الرولات؛ حدّث القائمة قبل التحديد');
  }
}
