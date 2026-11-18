import { apiFetch } from './client';

export type MachineStatus = 'ACTIVE' | 'STOPPED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
export type MachineType = 'WARPING' | 'SIZING' | 'LOOM' | 'PROCESSING' | 'INSPECTION' | 'OTHER';
export type ManufacturingOverview = { departments:number; machines:number; active_machines:number; unavailable_machines:number; open_maintenance:number; downtime_reasons:number; quality_defects:number };
export type ManufacturingDepartment = { id:string; code:string; name:string; description:string|null; is_active:boolean };
export type ManufacturingMachine = { id:string; department_id:string|null; department_name:string|null; code:string; name:string; machine_type:MachineType; width_cm:number|null; fixed_location:string|null; asset_value:number|null; asset_currency_code:string|null; ownership_type:'COMPANY'|'CUSTODY'; owner_name:string|null; operational_status:MachineStatus; notes:string|null; version:number; is_active:boolean };
export type DowntimeReason = { id:string; code:string; name:string; stage:string; is_planned:boolean; is_active:boolean };
export type QualityDefect = { id:string; code:string; name:string; inspection_type:string; default_severity:string|null; description:string|null; is_active:boolean };
export type MachineHistory = { statusEvents:unknown[]; maintenanceEvents:unknown[] };
export type WorkbookWarning = { code:string; message:string; sheet?:string; cell?:string };
export type ManufacturingWorkbookPreview = {
  sheetNames:string[];
  resolvedSheets:Record<string,string>;
  technicalFields:Record<string,string|number|boolean>;
  warp:{yarnCount:string|number|boolean|null;pattern:unknown[];requirements:unknown[]}|null;
  weft:{yarnCount:string|number|boolean|null;pattern:unknown[];requirements:unknown[]}|null;
  weaveDraft:{range:string|null;populatedCells:number;styledCells:number;merges:number}|null;
  formulas:unknown[];
  warnings:WorkbookWarning[];
};
export type WarpCardTemplatePreview = {
  sheetName:string; range:string|null; logicalRecordCount:1; printCopiesInTemplate:number;
  fields:Array<{label:string;occurrences:string[]}>; missingFields:string[];
};

const base='/api/manufacturing/reference';
export const getManufacturingOverview=()=>apiFetch<{ok:true;data:ManufacturingOverview}>(`${base}/overview`).then(r=>r.data);
export const listManufacturingDepartments=()=>apiFetch<{ok:true;data:ManufacturingDepartment[]}>(`${base}/departments`).then(r=>r.data);
export const saveManufacturingDepartment=(input:{id?:string;code:string;name:string;description?:string|null;isActive?:boolean})=>apiFetch<{ok:true;data:ManufacturingDepartment}>(input.id?`${base}/departments/${input.id}`:`${base}/departments`,{method:input.id?'PUT':'POST',body:JSON.stringify(input)}).then(r=>r.data);
export const listManufacturingMachines=()=>apiFetch<{ok:true;data:ManufacturingMachine[]}>(`${base}/machines`).then(r=>r.data);
export const saveManufacturingMachine=(input:Record<string,unknown>&{id?:string})=>apiFetch<{ok:true;data:ManufacturingMachine}>(input.id?`${base}/machines/${input.id}`:`${base}/machines`,{method:input.id?'PUT':'POST',body:JSON.stringify(input)}).then(r=>r.data);
export const changeManufacturingMachineStatus=(id:string,status:MachineStatus,reason:string,version:number)=>apiFetch<{ok:true;data:ManufacturingMachine}>(`${base}/machines/${id}/status`,{method:'POST',body:JSON.stringify({status,reason,version})}).then(r=>r.data);
export const getManufacturingMachineHistory=(id:string)=>apiFetch<{ok:true;data:MachineHistory}>(`${base}/machines/${id}/history`).then(r=>r.data);
export const createManufacturingMaintenance=(id:string,input:Record<string,unknown>)=>apiFetch<{ok:true;data:unknown}>(`${base}/machines/${id}/maintenance`,{method:'POST',body:JSON.stringify(input)}).then(r=>r.data);
export const listDowntimeReasons=()=>apiFetch<{ok:true;data:DowntimeReason[]}>(`${base}/downtime-reasons`).then(r=>r.data);
export const saveDowntimeReason=(input:Record<string,unknown>&{id?:string})=>apiFetch<{ok:true;data:DowntimeReason}>(input.id?`${base}/downtime-reasons/${input.id}`:`${base}/downtime-reasons`,{method:input.id?'PUT':'POST',body:JSON.stringify(input)}).then(r=>r.data);
export const listQualityDefects=()=>apiFetch<{ok:true;data:QualityDefect[]}>(`${base}/quality-defects`).then(r=>r.data);
export const saveQualityDefect=(input:Record<string,unknown>&{id?:string})=>apiFetch<{ok:true;data:QualityDefect}>(input.id?`${base}/quality-defects/${input.id}`:`${base}/quality-defects`,{method:input.id?'PUT':'POST',body:JSON.stringify(input)}).then(r=>r.data);

function arrayBufferToBase64(buffer:ArrayBuffer):string {
  const bytes=new Uint8Array(buffer); let binary=''; const chunkSize=0x8000;
  for(let offset=0;offset<bytes.length;offset+=chunkSize) binary+=String.fromCharCode(...bytes.subarray(offset,offset+chunkSize));
  return btoa(binary);
}

export async function previewManufacturingWorkbook(file:File,documentType:'SPECIFICATION'|'WARP_CARD') {
  const maxBytes=4*1024*1024;
  if(file.size===0) throw new Error('ملف Excel فارغ');
  if(file.size>maxBytes) throw new Error('حجم ملف Excel يجب ألا يتجاوز 4 ميغابايت');
  if(!/\.xlsx?$/i.test(file.name)) throw new Error('يجب اختيار ملف Excel بصيغة xlsx أو xls');
  const base64=arrayBufferToBase64(await file.arrayBuffer());
  return apiFetch<{ok:true;data:ManufacturingWorkbookPreview|WarpCardTemplatePreview}>(`${base}/specifications/preview`,{
    method:'POST', body:JSON.stringify({fileName:file.name,documentType,base64}), timeoutMs:60_000,
  }).then(r=>r.data);
}
