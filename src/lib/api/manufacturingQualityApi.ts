import { apiFetch } from "./client";

const base = "/api/manufacturing/quality";
export type ProductionBatch = {
  quality_checklist?: import("../../components/manufacturing/QualityChecklist").ChecklistRow[];
  inspected_by_user_id?: string|null;
  id: string; batch_no: string; status: "PENDING_INSPECTION" | "INSPECTED" | "APPROVED" | "CLOSED";
  run_no: string; work_order_no: string; loom_code: string; production_date: string;
  operator_name: string | null; shift_name: string | null; counter_start: number; counter_end: number;
  produced_length_m: number; clean_length_m: number; rework_length_m: number; rejected_length_m: number;
  pending_length_m: number; received_roll_length_m: number; inspection_notes: string | null;
};
export type ProductionQualityReport = { batch: ProductionBatch & Record<string, unknown>; defects: Array<Record<string, unknown>>; rolls: Array<Record<string, unknown>> };
export const listProductionBatches = () => apiFetch<{ ok: true; data: ProductionBatch[] }>(`${base}/batches`).then((r) => r.data);
export const getProductionQualityReport = (id: string) => apiFetch<{ ok: true; data: ProductionQualityReport }>(`${base}/batches/${id}/report`).then((r) => r.data);
export const saveBatchInspection = (id: string, body: Record<string, unknown>) => apiFetch(`${base}/batches/${id}/inspection`, { method: "PUT", body: JSON.stringify(body) });
export const approveBatchInspection = (id: string) => apiFetch(`${base}/batches/${id}/approve`, { method: "POST", body: "{}" });
export const receiveBatchRolls = (id: string, body: Record<string, unknown>) => apiFetch(`${base}/batches/${id}/rolls`, { method: "POST", body: JSON.stringify(body) });

export type QualityInboxRow = {kind:'RAW'|'FINISHED';id:string;job_id?:string;source_no:string;status:string;length_m:number|string;order_refs:Array<{customer_order_id:string|null;customer_order_line_id:string|null}>};
export const listQualityInbox = () => apiFetch<{ok:true;data:QualityInboxRow[]}>(`${base}/inbox`).then(r=>r.data);
export type FinishedQualityDetail = {
 id:string;job_id:string;batch_id:string;source_line_id:string;result_roll_id:string;job_no:string;dye_paper_no:string;barcode:string;sent_barcode:string;
 length_m:number|string;defective:boolean;defect_reason:string|null;responsible_party:string|null;resolution:string|null;resolution_notes:string|null;
 quality_checklist:import('../../components/manufacturing/QualityChecklist').ChecklistRow[];
 quality_defects:Array<{defectId:string;positionM?:number|null;imageUrls?:string[];quantity:number;severity:'MINOR'|'MAJOR'|'CRITICAL';notes:string}>;
 quality_images:string[];quality_decision:string;approval_required:boolean;
 quality_notes:string|null;inspector_name:string|null;approver_name:string|null;receiver_name:string|null;
 inspected_at:string|null;resolved_at:string|null;order_no:string|null;line_no:number|null;customer_order_id:string|null;customer_order_line_id:string|null;roll_status:string;
};
export const getFinishedQualityReport = (id:string) => apiFetch<{ok:true;data:FinishedQualityDetail}>(`${base}/finished/${id}/report`).then(r=>r.data);
export const finishedQualityAction = (id:string,action:'inspection'|'decision',body:unknown) => apiFetch(`${base}/finished/${id}/${action}`,{method:'POST',body:JSON.stringify(body)});

export const listQualityDefectOptions = (inspectionType:'WARP_BEAM'|'SIZED_BEAM'|'RAW_FABRIC'|'FINISHED_FABRIC') => apiFetch<{ok:true;data:import('./manufacturingReferenceApi').QualityDefect[]}>(`${base}/defect-options?inspectionType=${inspectionType}`).then(r=>r.data);
