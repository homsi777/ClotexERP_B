import { apiFetch } from './client';
export type ServiceBasis = 'METER' | 'KG' | 'FIXED';
export interface ManufacturingService { id: string; name: string; quantity: string; basis: ServiceBasis; unit_price?: string | null; currency_code?: string | null; approved_quantity?: string | null; total_usd?: string | null }
export interface ManufacturingLine { customer_order_id: string | null; customer_order_line_id: string | null; customer_order_no?: string | null; customer_order_line_no?: number | null; id: string; roll_id: string; sent_barcode: string; barcode: string; roll_no: string | null; item_name: string; internal_code: string; color_name: string | null; item_id?: string; sent_item_id?: string | null; created_at?: string; sent_length_m: string; sent_weight_display: string | null; returned_m: string; shortage_m: string; excess_m: string; width_cm: string | null; gsm: string | null; line_status: string; received_at: string | null; new_barcode: string | null; receipt_notes: string | null }
export interface ReturnLine { customer_order_id: string | null; customer_order_line_id: string | null; id: string; source_line_id: string; original_barcode: string; barcode: string; length_m: number; weight_kg: number | null; defective: boolean; defect_reason: string | null; responsible_party: string | null; notes: string | null; resolution: string | null; resolution_notes: string | null; resolved_at: string | null; status: string }
export interface ManufacturingOverview {
  costShares?:Array<{id:string;work_order_id:string|null;work_order_no:string|null;allocated_usd?:string|null;approved_at:string|null}>;
  costAllocationTotalUsd?:number|null;
  job: { raw_width_cm?: string | null; finished_width_cm?: string | null; raw_gsm?: string | null; finished_gsm?: string | null; traceability_only?: boolean; job_no: string; supplier_name: string; document_status: string; previous_job_id: string | null; lifecycle_closed_at: string | null; fee_amount: string | null; fee_currency_code: string | null; fee_posted_at: string | null; production_cost_closed?: boolean };
  services: ManufacturingService[]; lines: ManufacturingLine[];
  batches: { id: string; dye_paper_no: string; received_at: string; notes: string | null; attachments: string[]; service_ids: string[]; lines: ReturnLine[] }[];
  settlements: { id: string; source_line_id: string; amount_m: string; kind: 'SHORTAGE' | 'EXCESS'; reason: string; approved_at: string }[];
  legacyMode: boolean;
  legacy: { id: string; returned_length_m: string; returned_weight_kg: string | null; shortage_approved_length_m: string; received_at: string; result_roll_barcode: string | null; destination_warehouse_name: string | null; notes: string | null }[];
}
export interface ManufacturingResponse { ok: boolean; data: ManufacturingOverview; canPrice: boolean; canManage: boolean; canReceive: boolean }
export const getManufacturing = (id: string) => apiFetch<ManufacturingResponse>(`/api/external-jobs/${id}/lifecycle`);
export const manufacturingAction = (id: string, action: 'returns' | 'services' | 'settlements' | 'resolve-defect' | 'service-pricing' | 'cost-allocation' | 'close', body: unknown) =>
  apiFetch<{ ok: boolean; data?: { id: string; duplicate?: boolean } }>(`/api/external-jobs/${id}/lifecycle/${action}`, { method: 'POST', body: JSON.stringify(body) });
