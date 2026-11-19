import { apiFetch } from "./client";

const base = "/api/manufacturing/quality";
export type ProductionBatch = {
  id: string; batch_no: string; status: "PENDING_INSPECTION" | "INSPECTED" | "APPROVED" | "CLOSED";
  run_no: string; work_order_no: string; loom_code: string; production_date: string;
  operator_name: string | null; shift_name: string | null; counter_start: number; counter_end: number;
  produced_length_m: number; clean_length_m: number; rework_length_m: number; rejected_length_m: number;
  pending_length_m: number; received_roll_length_m: number; inspection_notes: string | null;
};
export const listProductionBatches = () => apiFetch<{ ok: true; data: ProductionBatch[] }>(`${base}/batches`).then((r) => r.data);
export const saveBatchInspection = (id: string, body: Record<string, unknown>) => apiFetch(`${base}/batches/${id}/inspection`, { method: "PUT", body: JSON.stringify(body) });
export const approveBatchInspection = (id: string) => apiFetch(`${base}/batches/${id}/approve`, { method: "POST", body: "{}" });
export const receiveBatchRolls = (id: string, body: Record<string, unknown>) => apiFetch(`${base}/batches/${id}/rolls`, { method: "POST", body: JSON.stringify(body) });
