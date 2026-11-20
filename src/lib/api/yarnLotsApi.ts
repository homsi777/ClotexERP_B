import { apiFetch } from './client';

export type YarnProperties = {fiber?:string;spinningType?:string;count?:string;countSystem?:'Ne'|'Nm'|'Denier'|'Tex';blend?:Array<{fiber:string;percent:number}>};

export type YarnLotStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'DAMAGED' | 'TRANSFERRED' | 'INACTIVE';

export interface YarnLotDto {
  id: string;
  company_id: string;
  owner_type: 'COMPANY' | 'CUSTOMER';
  owner_customer_id: string | null;
  yarn_properties?: YarnProperties;
  weight_material_kind?:'YARN'|'CONSUMABLE'|null;
  color_code?: string;
  location_name?: string;
  location_code?: string;
  receipt_packages?: { count: number; weightPerPackageKg: number } | null;
  lot_no: string | null;
  barcode: string;
  item_id: string;
  color_id: string | null;
  supplier_id: string | null;
  warehouse_id: string;
  location_id: string | null;
  weight_kg: string;
  unit_cost: string | null;
  currency_code: string;
  batch_no: string | null;
  container_no: string | null;
  purchase_invoice_id: string | null;
  purchase_invoice_line_id: string | null;
  status: YarnLotStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  item_name?: string;
  item_internal_code?: string;
  color_name_ar?: string;
  supplier_name?: string | null;
  warehouse_name?: string;
}

export interface YarnLotListFilters {
  materialKind?:'YARN'|'CONSUMABLE';
  search?: string;
  itemId?: string;
  status?: YarnLotStatus;
  warehouseId?: string;
  onlyAvailable?: boolean;
  ownerType?: 'COMPANY' | 'CUSTOMER';
  ownerCustomerId?: string;
  page?: number;
  pageSize?: number;
}

export interface YarnLotListResult {
  data: YarnLotDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface YarnLotCreatePayload {
  grossWeightKg?:number;tareWeightKg?:number;
  ownerType?: 'COMPANY' | 'CUSTOMER';
  ownerCustomerId?: string | null;
  yarnProperties?: YarnProperties;
  packageBarcodes?: boolean;
  receiptPackages?: { count: number; weightPerPackageKg: number } | null;
  barcode?: string;
  lotNo?: string;
  itemId: string;
  colorId?: string | null;
  supplierId?: string | null;
  warehouseId: string;
  locationId?: string | null;
  weightKg: number;
  unitCost?: number | null;
  currencyCode?: string | null;
  batchNo?: string | null;
  containerNo?: string | null;
  notes?: string | null;
}

export interface YarnLotUpdatePayload {
  itemId?: string;
  colorId?: string | null;
  lotNo?: string | null;
  supplierId?: string | null;
  locationId?: string | null;

  unitCost?: number | null;
  currencyCode?: string | null;
  batchNo?: string | null;
  containerNo?: string | null;
  notes?: string | null;
}

export async function listYarnLots(filters: YarnLotListFilters = {}): Promise<YarnLotListResult> {
  const q = new URLSearchParams();
  if(filters.materialKind)q.set('materialKind',filters.materialKind);
  if (filters.ownerType) q.set('ownerType', filters.ownerType);
  if (filters.ownerCustomerId) q.set('ownerCustomerId', filters.ownerCustomerId);
  if (filters.search) q.set('search', filters.search);
  if (filters.itemId) q.set('itemId', filters.itemId);
  if (filters.status) q.set('status', filters.status);
  if (filters.warehouseId) q.set('warehouseId', filters.warehouseId);
  if (filters.onlyAvailable) q.set('onlyAvailable', 'true');
  if (filters.page) q.set('page', String(filters.page));
  if (filters.pageSize) q.set('pageSize', String(filters.pageSize));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<YarnLotListResult & { ok: boolean }>(`/api/inventory/yarn-lots${qs}`);
}

export async function getYarnLot(id: string): Promise<YarnLotDto> {
  const res = await apiFetch<{ ok: boolean; data: YarnLotDto }>(`/api/inventory/yarn-lots/${id}`);
  return res.data;
}

export async function createYarnLot(payload: YarnLotCreatePayload): Promise<YarnLotDto> {
  const res = await apiFetch<{ ok: boolean; data: YarnLotDto }>('/api/inventory/yarn-lots', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateYarnLot(id: string, payload: YarnLotUpdatePayload): Promise<YarnLotDto> {
  const res = await apiFetch<{ ok: boolean; data: YarnLotDto }>(`/api/inventory/yarn-lots/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function setYarnLotStatus(id: string, status: YarnLotStatus, notes?: string): Promise<void> {
  await apiFetch(`/api/inventory/yarn-lots/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, notes }),
  });
}

export async function postYarnStockOperation(id: string, payload: { type: 'ADJUST'; targetWeightKg: number; expectedWeightKg: number; reason: string; approved: true } | { type: 'TRANSFER'; weightKg: number; warehouseId: string; locationId?:string|null; reason: string }) {
  return apiFetch(`/api/inventory/yarn-lots/${id}/stock-operation`, { method: 'POST', body: JSON.stringify(payload) });
}
export async function listYarnMovements(id: string) {
  return apiFetch<{ data: { id: string; movement_type: string; weight_delta_kg: string; notes: string; created_at: string; created_by_user_id: string }[] }>(`/api/inventory/yarn-lots/${id}/movements`);
}
