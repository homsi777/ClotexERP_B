import { apiFetch } from "./client";
const base = "/api/manufacturing/weaving";
export type WeavingRun = {
  id: string;
  run_no: string;
  work_order_no: string;
  loom_code: string;
  operator_name: string | null;
  shift_name: string | null;
  status: string;
  planned_length_m: number;
  produced_length_m: number;
  remaining_length_m: number;
  current_counter: number | null;
};
export type WeavingOptions = {
  beams: Array<{ id: string; beam_no: string; length_m: number }>;
  sizedBeams: Array<{ id: string; beam_no: string; length_m: number }>;
  looms: Array<{ id: string; code: string; name: string }>;
  employees: Array<{ id: string; employee_code: string; full_name: string }>;
  shifts: Array<{ id: string; code: string; name: string }>;
  downtimeReasons: Array<{ id: string; code: string; name: string }>;
};
export const listWeavingRuns = () => apiFetch<{ ok: true; data: WeavingRun[] }>(base).then((r) => r.data);
export const getWeavingOptions = () =>
  apiFetch<{ ok: true; data: WeavingOptions }>(`${base}/options`).then((r) => r.data);
export const createWeavingRun = (body: Record<string, unknown>) =>
  apiFetch(base, { method: "POST", body: JSON.stringify(body) });
export const startWeavingRun = (id: string) => apiFetch(`${base}/${id}/start`, { method: "POST", body: "{}" });
export const addWeavingShiftLog = (id: string, body: Record<string, unknown>) =>
  apiFetch(`${base}/${id}/shift-logs`, { method: "POST", body: JSON.stringify(body) });
export const completeWeavingRun=(id:string)=>apiFetch(`${base}/${id}/complete`,{method:'POST',body:'{}'});
