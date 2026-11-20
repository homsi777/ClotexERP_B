import { apiFetch } from "./client";
export type WarpingStatus = "DRAFT" | "RELEASED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "CANCELLED";
export type WarpingOrder = {
  id: string;
  warping_order_no: string;
  work_order_id: string;
  work_order_no: string;
  status: WarpingStatus;
  planned_length_m: number;
  actual_length_m: number | null;
  warping_machine_id: string | null;
  machine_code: string | null;
  machine_name: string | null;
  target_loom_id: string | null;
  loom_code: string | null;
  loom_name: string | null;
  operator_name: string | null;
  shift_name: string | null;
  tie_count: number | null;
  beam_no: string | null;
  beam_barcode: string | null;
  quality_status: string;
  quality_notes: string | null;
  version: number;
  card_no: string | null;
  card_barcode: string | null;
  card_data: Record<string, unknown> | null;
  print_count: number | null;
  output_beams:Array<{id:string;beamNo:string;barcode:string;lengthM:number;status:string;qualityStatus:string}>;
};
export type WarpingOptions = {
  workOrders: Array<{ id: string; work_order_no: string; target_length_m: number; status: string }>;
  machines: Array<{
    id: string;
    code: string;
    name: string;
    machine_type: "WARPING" | "LOOM";
    operational_status: string;
  }>;
  employees: Array<{ id: string; employee_code: string; full_name: string }>;
  shifts: Array<{ id: string; code: string; name: string }>;
  yarnLots: Array<{ id: string; barcode: string; weight_kg: number; item_name: string; color_name: string | null }>;
};
const base = "/api/manufacturing/warping";
export const listWarpingOrders = () => apiFetch<{ ok: true; data: WarpingOrder[] }>(base).then((r) => r.data);
export const getWarpingOptions = () =>
  apiFetch<{ ok: true; data: WarpingOptions }>(`${base}/options`).then((r) => r.data);
export const createWarpingOrder = (body: Record<string, unknown>) =>
  apiFetch<{ ok: true; data: unknown }>(base, { method: "POST", body: JSON.stringify(body) }).then((r) => r.data);
export const releaseWarpingOrder = (id: string, version: number, nextStage?: "SIZING" | "WEAVING") =>
  apiFetch<{ ok: true; data: unknown }>(`${base}/${id}/release`, {
    method: "POST",
    body: JSON.stringify({ version, nextStage }),
  }).then((r) => r.data);
export const transitionWarpingOrder = (
  id: string,
  version: number,
  targetStatus: "IN_PROGRESS" | "CANCELLED",
  reason?: string,
) =>
  apiFetch<{ ok: true; data: unknown }>(`${base}/${id}/transition`, {
    method: "POST",
    body: JSON.stringify({ version, targetStatus, reason }),
  }).then((r) => r.data);
export const completeWarpingOrder = (
  id: string,
  body: {
    version: number;
    actualLengthM: number;
    closeOrder?: boolean;
    qualityStatus: "ACCEPTED" | "CONDITIONAL" | "REJECTED";
    nextStage?: "SIZING"|"WEAVING";
    qualityNotes?: string;
  },
) =>
  apiFetch<{ ok: true; data: unknown }>(`${base}/${id}/complete`, { method: "POST", body: JSON.stringify(body) }).then(
    (r) => r.data,
  );
export const recordAndGetWarpCardPrint = (id: string) =>
  apiFetch<{
    ok: true;
    data: { cardNo: string; barcode: string; cardData: Record<string, unknown>; printCount: number };
  }>(`${base}/${id}/card/printed`, { method: "POST", body: "{}" }).then((r) => r.data);
export const createWarpingYarnIssue = (
  warpingOrderId: string,
  body: { notes?: string; lines: Array<{ yarnLotId: string; requestedWeightKg: number }> },
) =>
  apiFetch<{ ok: true; data: { id: string; issueNo: string; status: string } }>(
    `${base}/${warpingOrderId}/yarn-issues`,
    { method: "POST", body: JSON.stringify(body) },
  ).then((r) => r.data);
export type WarpingYarnIssueLine={id:string;yarnLotId:string;barcode:string;itemName:string;requestedWeightKg:number;issuedWeightKg:number;returnedWeightKg:number;wasteWeightKg:number};
export type WarpingYarnIssue={id:string;issue_no:string;status:string;lines:WarpingYarnIssueLine[]};
export const listWarpingYarnIssues = (warpingOrderId: string) =>
  apiFetch<{ ok: true; data: WarpingYarnIssue[] }>(
    `${base}/${warpingOrderId}/yarn-issues`,
  ).then((r) => r.data);
export const approveWarpingYarnIssue = (issueId: string) =>
  apiFetch<{ ok: true; data: unknown }>(`${base}/yarn-issues/${issueId}/issue`, { method: "POST", body: "{}" }).then(
    (r) => r.data,
  );
export const closeWarpingYarnIssue=(issueId:string,lines:Array<{lineId:string;returnedWeightKg:number;wasteWeightKg:number;notes?:string}>)=>apiFetch<{ok:true;data:unknown}>(`${base}/yarn-issues/${issueId}/close`,{method:'POST',body:JSON.stringify({lines})}).then(r=>r.data);
