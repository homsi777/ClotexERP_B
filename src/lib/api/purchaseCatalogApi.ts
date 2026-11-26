import { apiFetch } from './client';

export type CatalogKind = 'FABRIC' | 'YARN' | 'OTHER';
export type CatalogUnit = 'meter' | 'yard' | 'kg' | 'package' | 'piece';
export interface CatalogItem {
  id: string; materialKind: CatalogKind; name: string; defaultUnit: CatalogUnit; designCode: string | null; colorName: string | null; colorCode: string | null;
  widthCm: number | null; gsm: number | null; operatingWarehouseId: string | null; operatingWarehouseName: string | null; isActive: boolean;
}
export interface CatalogInput {
  materialKind: CatalogKind; name: string; defaultUnit: CatalogUnit; designCode?: string | null; colorName?: string | null; colorCode?: string | null;
  widthCm?: number | null; gsm?: number | null; operatingWarehouseId?: string | null;
}
export interface OperatingWarehouse { id: string; name: string; notes: string | null; isActive: boolean; items: number }
export interface OperatingStockRow { catalogItemId: string; name: string; unit: string; designCode: string | null; colorName: string | null; colorCode: string | null; quantity: number; received: number; disposed: number }
export interface OperatingMovement { id: string; type: string; quantity: number; unit: string; notes: string | null; createdAt: string; itemName: string; by: string | null }
export type DisposeType = 'CONSUMPTION' | 'WASTE' | 'GIFT' | 'OTHER_OUT';

export const listCatalog = async (kind?: CatalogKind) => (await apiFetch<{ ok: boolean; data: CatalogItem[] }>(`/api/purchase-invoices/catalog${kind ? `?kind=${kind}` : ''}`)).data;
export const createCatalogItem = async (body: CatalogInput) => (await apiFetch<{ ok: boolean; data: CatalogItem }>('/api/purchase-invoices/catalog', { method: 'POST', body: JSON.stringify(body) })).data;
export const updateCatalogItem = async (id: string, body: { operatingWarehouseId?: string | null; isActive?: boolean }) => (await apiFetch<{ ok: boolean; data: CatalogItem }>(`/api/purchase-invoices/catalog/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).data;

const OP = '/api/purchase-receiving/operating';
export const listOperatingWarehouses = async () => (await apiFetch<{ ok: boolean; data: OperatingWarehouse[] }>(`${OP}/warehouses`)).data;
export const createOperatingWarehouse = async (body: { name: string; notes?: string | null }) => (await apiFetch<{ ok: boolean; data: { id: string; name: string } }>(`${OP}/warehouses`, { method: 'POST', body: JSON.stringify(body) })).data;
export const listOperatingStock = async (id: string) => (await apiFetch<{ ok: boolean; data: OperatingStockRow[] }>(`${OP}/warehouses/${id}/stock`)).data;
export const listOperatingMovements = async (id: string, catalogItemId?: string) => (await apiFetch<{ ok: boolean; data: OperatingMovement[] }>(`${OP}/warehouses/${id}/movements${catalogItemId ? `?catalogItemId=${catalogItemId}` : ''}`)).data;
export const disposeOperatingStock = async (body: { warehouseId: string; catalogItemId: string; quantity: number; type: DisposeType; notes?: string }) => (await apiFetch<{ ok: boolean; data: { remaining: number } }>(`${OP}/dispose`, { method: 'POST', body: JSON.stringify(body) })).data;
