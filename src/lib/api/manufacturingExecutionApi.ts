import {apiFetch} from './client';
export type ExecutionStage='WARPING'|'SIZING'|'WEAVING'|'WARP'|'SIZED';
export type ExecutionOption={id:string;name:string;stage?:string;machine_type?:string};
/** Local factory timestamps (YYYY-MM-DDTHH:mm[:ss]); durations exist only when both actual times were supplied. */
export type ExecutionRuntimeDetails={startedAt?:string;endedAt?:string;durationMinutes?:number;runtimeMinutes?:number};
export type ExecutionData={subject:{version:number;status:string;barcode?:string;specification_snapshot?:unknown;selvedge_override?:unknown;custody_location?:string;custody_employee_id?:string};history:Array<{id:string;operation:string;created_at:string;created_by_user_id:string;details:Record<string,unknown>&ExecutionRuntimeDetails}>;employees:ExecutionOption[];shifts:ExecutionOption[];machines:ExecutionOption[];reasons:ExecutionOption[];shiftLogs:Array<{id:string;production_date:string;shift_type_id:string;produced_length_m:number;downtime_minutes:number}>};
const path=(stage:ExecutionStage,id:string)=>`/api/manufacturing/warping/execution/${stage}/${id}`;
export const getExecutionTracking=(stage:ExecutionStage,id:string)=>apiFetch<{data:ExecutionData}>(path(stage,id)).then(r=>r.data);
export const saveExecutionTracking=(stage:ExecutionStage,id:string,body:Record<string,unknown>)=>apiFetch<{data:{id:string;version:number;replayed:boolean}}>(path(stage,id),{method:'POST',body:JSON.stringify(body)}).then(r=>r.data);
