import { apiFetch } from './client';

// TASK 009 (بشير): قص التوب والبيع المباشر — عميل API يستدعي محرك البيع الخلفي الحالي.

export interface RollCutPayload {
  originalRollId: string;
  cutLengthM: number;
  customerId: string;
  /** اختياري: غيابه = حفظ القص بلا تسعير (فاتورة معلّقة). الخادم يفرض الصلاحية. */
  unitPrice?: number;
  deferPricing?: boolean;
  unit?: 'meter' | 'yard';
  currencyCode?: string;
  exchangeRateToUsd?: number;
  invoiceDate?: string;
  paidAmount?: number;
  cashboxId?: string | null;
  notes?: string | null;
}

export interface RollCutResult {
  pricingStatus: 'PRICED' | 'PENDING';
  invoice: { id: string; invoiceNo: string } | null;
  originalRoll: { id: string; barcode: string; remainingLengthM: number };
  cutPiece: { id: string; barcode: string; lengthM: number };
  cutLogId: string;
}

export interface RollCutLogItem {
  id: string;
  pricing_status: 'PENDING' | 'PRICED';
  sales_invoice_id: string | null;
  sales_invoice_no: string | null;
  original_roll_id: string;
  cut_piece_roll_id: string;
  original_barcode: string;
  cut_barcode: string;
  cut_length_m: string;
  original_length_before_m: string;
  original_length_after_m: string;
  customer_name: string | null;
  item_name: string | null;
  created_at: string;
}

export async function cutAndSellRoll(payload: RollCutPayload): Promise<RollCutResult> {
  const res = await apiFetch<{ ok: boolean; data: RollCutResult }>('/api/inventory/rolls/cut', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function listRollCuts(params: { search?: string; limit?: number; pending?: boolean } = {}): Promise<RollCutLogItem[]> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.pending) q.set('pending', '1');
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: RollCutLogItem[] }>(`/api/inventory/rolls/cut-log${qs}`);
  return res.data;
}

export interface PriceRollCutPayload {
  unitPrice: number;
  currencyCode?: string;
  exchangeRateToUsd?: number;
  invoiceDate?: string;
  paidAmount?: number;
  cashboxId?: string | null;
  notes?: string | null;
}

export async function priceRollCut(cutId: string, payload: PriceRollCutPayload): Promise<{ cutId: string; invoice: { id: string; invoiceNo: string } }> {
  const res = await apiFetch<{ ok: boolean; data: { cutId: string; invoice: { id: string; invoiceNo: string } } }>(
    `/api/inventory/rolls/cut/${cutId}/price`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}
