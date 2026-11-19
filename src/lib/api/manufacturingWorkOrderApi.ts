import { apiFetch } from './client';

export type ManufacturingWorkOrderStatus = 'DRAFT'|'RELEASED'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED';
export type ManufacturingWorkOrderPriority = 'LOW'|'NORMAL'|'HIGH'|'URGENT';

export type ManufacturingWorkOrderSummary = {
  id:string; work_order_no:string; status:ManufacturingWorkOrderStatus; priority:ManufacturingWorkOrderPriority;
  target_length_m:number|string; planned_start_date:string|null; planned_end_date:string|null; notes:string|null;
  version:number; released_at:string|null; completed_at:string|null; cancelled_at:string|null;
  specification_id:string; specification_code:string; specification_name:string;
  specification_version_id:string; specification_version_no:number;
  allocated_length_m:number|string; allocation_count:number; created_at:string; updated_at:string;
};

export type ManufacturingWorkOrderInput = {
  specificationVersionId:string; targetLengthM:number; priority:ManufacturingWorkOrderPriority;
  plannedStartDate?:string|null; plannedEndDate?:string|null; notes?:string|null;
  allocations?:Array<{customerOrderId:string;customerOrderLineId:string;allocatedLengthM:number;notes?:string|null}>;
  version?:number;
};

const base='/api/manufacturing/work-orders';
export const listManufacturingWorkOrders=()=>apiFetch<{ok:true;data:ManufacturingWorkOrderSummary[]}>(base).then(r=>r.data);
export const createManufacturingWorkOrder=(input:ManufacturingWorkOrderInput)=>apiFetch<{ok:true;data:{id:string;workOrderNo:string;status:'DRAFT'}}>(base,{method:'POST',body:JSON.stringify({...input,allocations:input.allocations??[]})}).then(r=>r.data);
export const updateManufacturingWorkOrder=(id:string,input:ManufacturingWorkOrderInput)=>apiFetch<{ok:true;data:{id:string;status:'DRAFT';version:number}}>(`${base}/${id}`,{method:'PUT',body:JSON.stringify({...input,allocations:input.allocations??[]})}).then(r=>r.data);
export const releaseManufacturingWorkOrder=(id:string,version:number)=>apiFetch<{ok:true;data:{id:string;status:'RELEASED';version:number}}>(`${base}/${id}/release`,{method:'POST',body:JSON.stringify({version})}).then(r=>r.data);
export const transitionManufacturingWorkOrder=(id:string,targetStatus:'IN_PROGRESS'|'COMPLETED'|'CANCELLED',version:number,reason?:string|null)=>apiFetch<{ok:true;data:{id:string;status:ManufacturingWorkOrderStatus;version:number}}>(`${base}/${id}/transition`,{method:'POST',body:JSON.stringify({targetStatus,version,reason:reason??null})}).then(r=>r.data);
