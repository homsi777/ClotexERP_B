import { apiFetch } from './client';

export interface ZoneRoll {
  warehouse_id: string;
  warehouse_name: string;
  id: string;
  barcode: string;
  item_id: string;
  item_name: string;
  color_id: string | null;
  color_name: string | null;
  color_code: string | null;
  length_m: number;
  weight_kg: number | null;
  created_at: string;
  location_id: string | null;
  zone_name: string | null;
  status: string;
}

export interface ZoneTotals { count: number; meters: number; weightKg: number }
export interface ZoneRollGroup {warehouseId:string;warehouseName:string;zoneId:string|null;zoneName:string;rolls:ZoneRoll[];totals:ZoneTotals}
export async function groupZoneBarcodes(barcodes:string[]):Promise<ZoneRollGroup[]>{return(await apiFetch<{ok:true;data:ZoneRollGroup[]}>(`${B}/group-rolls`,{method:'POST',body:JSON.stringify({barcodes})})).data;}

export interface ZoneSummary {
  warehouseId: string;
  warehouseName: string;
  zonesEnabled: boolean;
  zones: { id: string; code: string; name: string; is_active: boolean; rolls: number; meters: number }[];
  unassigned: { rolls: number; meters: number };
}

export interface ZoneContents {
  totals: ZoneTotals;
  groups: { itemId: string; itemName: string; colorId: string | null; colorName: string | null; colorCode: string | null; rolls: ZoneRoll[]; totals: ZoneTotals }[];
}

export type ZoneScope = { type: 'PENDING' } | { type: 'ZONE'; zoneId: string } | { type: 'REFERENCE'; referenceId: string };
export type ZonePick =
  | { mode: 'ALL' }
  | { mode: 'ITEM'; itemId: string }
  | { mode: 'COLOR'; itemId: string; colorId: string | null }
  | { mode: 'ROLLS'; barcodes: string[] };

const B = '/api/warehouse-zones';

export async function getZoneSummary(warehouseId: string): Promise<ZoneSummary> {
  return (await apiFetch<{ ok: boolean; data: ZoneSummary }>(`${B}/${warehouseId}/summary`)).data;
}
export async function setZonesEnabled(warehouseId: string, enabled: boolean) {
  return (await apiFetch<{ ok: boolean; data: { zonesEnabled: boolean } }>(`${B}/${warehouseId}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) })).data;
}
export async function addZone(warehouseId: string, name: string) {
  return (await apiFetch<{ ok: boolean; data: { id: string; code: string; name: string } }>(`${B}/${warehouseId}/zones`, { method: 'POST', body: JSON.stringify({ name }) })).data;
}
export async function renameZone(zoneId: string, code: string, name: string) {
  await apiFetch(`/api/warehouse-locations/${zoneId}`, { method: 'PUT', body: JSON.stringify({ code, name }) });
}
export async function getZoneContents(warehouseId: string, zoneId: string | null): Promise<ZoneContents> {
  return (await apiFetch<{ ok: boolean; data: ZoneContents }>(`${B}/${warehouseId}/contents?zoneId=${zoneId ?? 'none'}`)).data;
}
export async function pickZoneRolls(warehouseId: string, scope: ZoneScope, pick: ZonePick) {
  return (await apiFetch<{ ok: boolean; data: { rolls: ZoneRoll[]; rejected: string[]; totals: ZoneTotals } }>(
    `${B}/${warehouseId}/pick`, { method: 'POST', body: JSON.stringify({ scope, pick }) })).data;
}
export async function assignZoneRolls(payload: { warehouseId: string; toZoneId: string; rollIds: string[]; expectedFrom: string }) {
  return (await apiFetch<{ ok: boolean; data: { movedCount: number; unchangedCount: number; toZone: string } }>(
    `${B}/assign`, { method: 'POST', body: JSON.stringify(payload) })).data;
}
export async function getPendingZoneAlerts() {
  return (await apiFetch<{ ok: boolean; data: { warehouse_id: string; name: string; pending: number }[] }>(`${B}/alerts`)).data;
}
export async function getItemZoneDistribution(warehouseId: string, itemId: string) {
  return (await apiFetch<{ ok: boolean; data: { zone_id: string | null; zone_name: string; color_name: string | null; color_code: string | null; rolls: number; meters: number }[] }>(
    `${B}/${warehouseId}/items/${itemId}/distribution`)).data;
}
