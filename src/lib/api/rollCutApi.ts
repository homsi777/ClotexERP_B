import { apiFetch } from './client';

// TASK 009 (بشير): قص التوب والبيع المباشر — عميل API يستدعي محرك البيع الخلفي الحالي.

export interface RollCutPayload {
  originalRollId: string;
  cutLengthM: number;
  customerId: string;
  unitPrice: number;
  unit?: 'meter' | 'yard';
  currencyCode?: string;
  exchangeRateToUsd?: number;
  invoiceDate?: string;
  paidAmount?: number;
  cashboxId?: string | null;
  notes?: string | null;
}

export interface RollCutResult {
  invoice: { id: string; invoiceNo: string };
  originalRoll: { id: string; barcode: string; remainingLengthM: number };
  cutPiece: { id: string; barcode: string; lengthM: number };
  cutLogId: string;
}

export interface RollCutLogItem {
  id: string;
  sales_invoice_id: string;
  sales_invoice_no: string;
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

export async function listRollCuts(params: { search?: string; limit?: number } = {}): Promise<RollCutLogItem[]> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString() ? `?${q}` : '';
  const res = await apiFetch<{ ok: boolean; data: RollCutLogItem[] }>(`/api/inventory/rolls/cut-log${qs}`);
  return res.data;
}
