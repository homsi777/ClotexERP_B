import { apiFetch } from './client';

export type LineStatus = 'NOT_RECEIVED' | 'PARTIAL' | 'COMPLETE' | 'OVER';
export type MaterialKind = 'FABRIC' | 'YARN' | 'OTHER';
export type ReceiveUnit = 'meter' | 'yard' | 'kg' | 'package' | 'piece';

/** لا حقول مالية هنا إطلاقاً: الخادم لا يُرجعها لهذا المسار. */
export interface ReceivingLine {
  id: string; lineNo: number; description: string; materialKind: MaterialKind; unit: string; quantity: number; received: number; remaining: number; diff: number;
  status: LineStatus; autoReceived: boolean; warehouseId: string | null; warehouseName: string | null; details: Record<string, unknown>;
}
export interface ReceivingInvoice {
  id: string; invoiceNo: string; supplierInvoiceNo: string | null; invoiceDate: string; supplierId: string; supplierName: string; documentStatus: string; receiveViaWarehouse: boolean;
  lines: ReceivingLine[]; overall: LineStatus;
}
export interface ReceiptView {
  id: string; receiptNo: string; invoiceId: string | null; invoiceNo: string | null; supplierName: string | null; warehouseName: string; status: string; notes: string | null; createdAt: string; createdBy: string | null; linkedAt: string | null;
  lines: Array<{ id: string; invoiceLineId: string | null; description: string; materialKind: string; unit: string; quantity: number; quantityInInvoiceUnit: number; conversionFactor: number | null; packageCount: number | null; rolls: number; lots: number }>;
}
export interface RollInput { barcode?: string; lengthM?: number; weightKg?: number; widthCm?: number; gsm?: number; lotNo?: string; colorName?: string; colorCode?: string; designCode?: string; materialName?: string }
export interface LotInput { weightKg: number; lotNo?: string; batchNo?: string; colorName?: string; colorCode?: string; designCode?: string; materialName?: string; packages?: number }
export interface ReceiptLineInput { catalogItemId?: string | null; operatingWarehouseId?: string | null; invoiceLineId?: string | null; description?: string; materialKind?: MaterialKind; unit: ReceiveUnit; quantity?: number; conversionFactor?: number; quantityInInvoiceUnit?: number; packageCount?: number; rolls?: RollInput[]; lots?: LotInput[] }
export interface ReceiptInput { clientRequestId?: string; allowOver?: boolean; invoiceId?: string | null; supplierId?: string | null; warehouseId?: string | null; notes?: string; lines: ReceiptLineInput[] }

export interface ReceivingFilters { search?: string; supplierId?: string; from?: string; to?: string; warehouseId?: string; materialKind?: string; status?: string; invoiceStatus?: string }
const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); return p.toString() ? `?${p}` : ''; };

export const listReceivingInvoices = async (f: ReceivingFilters = {}) => (await apiFetch<{ ok: boolean; data: ReceivingInvoice[] }>(`/api/purchase-receiving/invoices${qs({ ...f })}`)).data;
export const getReceivingInvoice = async (id: string) => (await apiFetch<{ ok: boolean; data: { invoice: ReceivingInvoice; receipts: ReceiptView[] } }>(`/api/purchase-receiving/invoices/${id}`)).data;
export const listReceipts = async (pending = false) => (await apiFetch<{ ok: boolean; data: ReceiptView[] }>(`/api/purchase-receiving/receipts${pending ? '?pending=1' : ''}`)).data;
export const createReceipt = async (body: ReceiptInput) => (await apiFetch<{ ok: boolean; data: { id: string; receiptNo: string; status: string; duplicate?: boolean; rollIds?: string[] } }>('/api/purchase-receiving/receipts', { method: 'POST', body: JSON.stringify(body) })).data;
export const linkReceipt = (id: string, body: { invoiceId: string; map: Array<{ receiptLineId: string; invoiceLineId: string; conversionFactor?: number; quantityInInvoiceUnit?: number }> }) =>
  apiFetch<{ ok: boolean }>(`/api/purchase-receiving/receipts/${id}/link`, { method: 'POST', body: JSON.stringify(body) });
