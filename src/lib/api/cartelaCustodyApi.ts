import { apiFetch } from './client';

export type CustodyStatus = 'HELD' | 'LATE' | 'RETURNED';

export interface ScannedCopy {
  copyId: string | null;
  barcode: string;
  cartelaId: string;
  cartelaTitle: string;
  artCode: string;
  serialNo: string;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  isRegisteredCopy: boolean;
  heldBy: { customerId: string; customerName: string; voucherNo: string } | null;
}

export interface CustodyRow {
  lineId: string;
  voucherId: string;
  voucherNo: string;
  customerId: string;
  customerName: string;
  barcode: string;
  cartelaTitle: string;
  artCode: string;
  colorCode: string | null;
  colorName: string | null;
  deliveredOn: string;
  dueDate: string | null;
  returnedOn: string | null;
  status: CustodyStatus;
  daysHeld: number;
  daysLate: number;
  dueUndefined: boolean;
}

export interface DeliveryPayload {
  customerId: string;
  deliveryDate?: string;
  notes?: string | null;
  lines: { barcode: string; days?: number | null; dueDate?: string | null }[];
}

export interface DeliveryResult {
  voucherId: string;
  voucherNo: string;
  customerId: string;
  customerName: string;
  deliveryDate: string;
  lines: { lineId: string; barcode: string; dueDate: string | null }[];
}

export interface CustodyFilterParams {
  customerId?: string;
  search?: string;
  from?: string;
  to?: string;
  status?: CustodyStatus | 'OPEN' | 'ALL';
}

const BASE = '/api/cartela-custody';

export async function scanCartelaCopy(barcode: string): Promise<ScannedCopy> {
  const res = await apiFetch<{ ok: boolean; data: ScannedCopy }>(`${BASE}/scan?barcode=${encodeURIComponent(barcode)}`);
  return res.data;
}

export async function createDeliveryVoucher(payload: DeliveryPayload): Promise<DeliveryResult> {
  const res = await apiFetch<{ ok: boolean; data: DeliveryResult }>(`${BASE}/vouchers`, { method: 'POST', body: JSON.stringify(payload) });
  return res.data;
}

export async function returnCartelaCopies(payload: { customerId: string; barcodes: string[]; returnedOn?: string }) {
  const res = await apiFetch<{ ok: boolean; data: { returnedOn: string; returned: { barcode: string; voucherNo: string }[] } }>(
    `${BASE}/returns`, { method: 'POST', body: JSON.stringify(payload) });
  return res.data;
}

export async function extendCartelaDue(payload: { lineId: string; newDueDate: string; reason?: string | null }) {
  const res = await apiFetch<{ ok: boolean; data: { lineId: string; oldDueDate: string | null; newDueDate: string } }>(
    `${BASE}/extend`, { method: 'POST', body: JSON.stringify(payload) });
  return res.data;
}

function qs(p: CustodyFilterParams): string {
  const q = new URLSearchParams();
  if (p.customerId) q.set('customerId', p.customerId);
  if (p.search) q.set('search', p.search);
  if (p.from) q.set('from', p.from);
  if (p.to) q.set('to', p.to);
  if (p.status) q.set('status', p.status);
  return q.toString() ? `?${q}` : '';
}

export async function listCustodyRows(p: CustodyFilterParams): Promise<CustodyRow[]> {
  const res = await apiFetch<{ ok: boolean; data: CustodyRow[] }>(`${BASE}/rows${qs(p)}`);
  return res.data;
}

export async function getCustomerCartelaStatement(customerId: string, p: Omit<CustodyFilterParams, 'customerId' | 'search'> = {}) {
  const res = await apiFetch<{
    ok: boolean;
    data: { customer: { id: string; name: string }; summary: { heldNow: number; late: number; noDue: number }; rows: CustodyRow[] };
  }>(`${BASE}/customers/${customerId}/statement${qs(p)}`);
  return res.data;
}

export async function listDueChanges(lineId: string) {
  const res = await apiFetch<{ ok: boolean; data: { old_due_date: string | null; new_due_date: string; reason: string | null; changed_at: string }[] }>(
    `${BASE}/lines/${lineId}/changes`);
  return res.data;
}

export async function generateCartelaCopies(payload: { cartelaId: string; colorId?: string | null; count: number }) {
  const res = await apiFetch<{ ok: boolean; data: { barcodes: string[] } }>(`${BASE}/copies/generate`, { method: 'POST', body: JSON.stringify(payload) });
  return res.data;
}
