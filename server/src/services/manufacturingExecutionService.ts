import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {getPool} from '../db/pool.js';

export const executionStage = z.enum(['WARPING','SIZING','WEAVING','WARP','SIZED']);
export type ExecutionStage = z.infer<typeof executionStage>;
export const executionTables = {WARPING:'manufacturing_warping_orders',SIZING:'manufacturing_sizing_orders',WEAVING:'manufacturing_weaving_runs',WARP:'manufacturing_warp_beams',SIZED:'manufacturing_sized_beams'} as const;
const uuid=z.string().uuid();
const note=z.string().trim().min(3).max(2000);
const common={requestId:uuid,version:z.number().int().positive()};
// Local factory wall time, without an inferred timezone or a fabricated timestamp.
const executionTime=z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
 .refine(value=>z.string().date().safeParse(value.slice(0,10)).success,'Invalid execution date');
export const executionInput=z.discriminatedUnion('operation',[
 z.object({...common,operation:z.literal('DAILY_LOG'),productionDate:z.string().date(),startedAt:executionTime.optional(),endedAt:executionTime.optional(),shiftTypeId:uuid,machineId:uuid,workers:z.array(z.object({employeeId:uuid,minutes:z.number().int().min(1).max(1440)}).strict()).min(1).max(100),lengthM:z.number().finite().min(0).max(1e9),shiftLogId:uuid.optional(),downtimes:z.array(z.object({reasonId:uuid,minutes:z.number().int().min(1).max(1440),notes:z.string().trim().max(2000).optional()})).max(100),notes:note}).strict(),
 z.object({...common,operation:z.literal('HANDOVER'),barcode:z.string().trim().min(1).max(200),senderEmployeeId:uuid,recipientEmployeeId:uuid,fromLocation:z.string().trim().min(1).max(300),toLocation:z.string().trim().min(1).max(300),notes:note}).strict(),
 z.object({...common,operation:z.literal('SELVEDGE_OVERRIDE'),threadCount:z.number().int().min(0).max(1000000),yarnDescription:z.string().trim().min(1).max(300),notes:note}).strict(),
]);
export type ExecutionInput=z.infer<typeof executionInput>;
export class ExecutionError extends Error {constructor(public status:number,message:string){super(message);}}
const fail=(message:string,status=409):never=>{throw new ExecutionError(status,message);};
export function executionRuntime(d:Extract<ExecutionInput,{operation:'DAILY_LOG'}>){
 if(!d.startedAt&&!d.endedAt)return undefined;
 if(!d.startedAt||!d.endedAt)fail('أدخل بداية التشغيل ونهايته معاً',400);
 const start=executionTime.safeParse(d.startedAt),end=executionTime.safeParse(d.endedAt);
 if(!start.success||!end.success)return fail('وقت التشغيل غير صالح',400);
 if(start.data.slice(0,10)!==d.productionDate||end.data.slice(0,10)!==d.productionDate)
  fail('يجب أن تكون بداية التشغيل ونهايته في يوم الإنتاج نفسه',400);
 const seconds=(value:string)=>Number(value.slice(11,13))*3600+Number(value.slice(14,16))*60+Number(value.slice(17,19)||0);
 const durationMinutes=(seconds(end.data)-seconds(start.data))/60;
 if(durationMinutes<=0)fail('نهاية التشغيل يجب أن تكون بعد بدايته',400);
 const downtimeMinutes=d.downtimes.reduce((sum,item)=>sum+item.minutes,0);
 if(downtimeMinutes>durationMinutes)fail('التوقفات تتجاوز مدة التشغيل المسجلة',400);
 return {durationMinutes,runtimeMinutes:durationMinutes-downtimeMinutes};
}
export function validateExecution(stage:ExecutionStage,d:ExecutionInput){
 if(d.operation==='HANDOVER'&&!['WARP','SIZED'].includes(stage))fail('التسليم متاح للمطاوي فقط',400);
 if(d.operation==='SELVEDGE_OVERRIDE'&&stage!=='WARPING')fail('تجاوز الحاشية متاح للتسدية فقط',400);
 if(d.operation==='DAILY_LOG'){
  executionRuntime(d);
  if(!['WARPING','SIZING','WEAVING'].includes(stage))fail('مرحلة تشغيل غير صالحة',400);
  if(new Set(d.workers.map(w=>w.employeeId)).size!==d.workers.length)fail('العامل مكرر',400);
  if(d.downtimes.reduce((n,x)=>n+x.minutes,0)>1440)fail('إجمالي التوقف يتجاوز اليوم',400);
  if((stage==='WEAVING')!==Boolean(d.shiftLogId))fail('سجل وردية النسج مطلوب للنسج فقط',400);
 }
 if(d.operation==='HANDOVER'&&d.senderEmployeeId===d.recipientEmployeeId)fail('المرسل والمستلم يجب أن يختلفا',400);
}
async function reference(db:PoolClient,company:string,table:string,id:string,condition=''){
 const row=await db.query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2 ${condition} FOR SHARE`,[company,id]);
 if(!row.rows.length)fail('مرجع غير صالح أو غير تابع للشركة',400);
 return row.rows[0];
}
export async function recordExecution(company:string,user:string,stage:ExecutionStage,id:string,d:ExecutionInput){
 validateExecution(stage,d);
 const db=await getPool().connect();
 try{
  await db.query('BEGIN');
  // Serialize retries even when they target different subjects; never accept a reused key with different content.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[company,d.requestId]);
  const hash=createHash('sha256').update(JSON.stringify({stage,id,d})).digest('hex');
  const previous=(await db.query('SELECT id,request_hash,details FROM manufacturing_execution_records WHERE company_id=$1 AND request_id=$2',[company,d.requestId])).rows[0];
  if(previous){if(previous.request_hash!==hash)fail('مفتاح الطلب مستخدم لبيانات أخرى');await db.query('COMMIT');return {id:previous.id,...previous.details.result,replayed:true};}
  const table=executionTables[stage];
  const subject=(await db.query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2 FOR UPDATE`,[company,id])).rows[0];
  if(!subject)fail('السجل غير موجود',404);
  if(subject.version!==d.version)fail('تغير السجل، حدّث البيانات');
  let extra:Record<string,unknown>=d.operation==='DAILY_LOG'?executionRuntime(d)??{}:{};
  if(d.operation==='DAILY_LOG'){
   if(!['IN_PROGRESS','PAUSED'].includes(subject.status))fail('التشغيل غير مفتوح');
   for(const w of d.workers)await reference(db,company,'payroll_employees',w.employeeId,'AND is_active');
   await reference(db,company,'attendance_shift_types',d.shiftTypeId);
   const machine=await reference(db,company,'manufacturing_machines',d.machineId,'AND is_active');
   if(machine.machine_type!==(stage==='WEAVING'?'LOOM':stage))fail('نوع الماكينة غير صحيح',400);
   const assigned=subject[stage==='WARPING'?'warping_machine_id':stage==='SIZING'?'sizing_machine_id':'loom_id'];
   if(assigned&&assigned!==d.machineId)fail('الماكينة تختلف عن ماكينة الأمر',400);
   for(const x of d.downtimes){const r=await reference(db,company,'manufacturing_downtime_reasons',x.reasonId,'AND is_active');if(!['ALL',stage].includes(r.stage))fail('سبب التوقف غير مناسب',400);}
   if(stage==='WEAVING'){
    const shift=await reference(db,company,'manufacturing_weaving_shift_logs',d.shiftLogId!);
    if(shift.weaving_run_id!==id||String(shift.production_date instanceof Date?shift.production_date.toISOString().slice(0,10):shift.production_date)!==d.productionDate||shift.shift_type_id!==d.shiftTypeId||Number(shift.produced_length_m)!==d.lengthM)fail('بيانات التشغيل تختلف عن وردية الإنتاج',400);
    // The existing aggregate remains authoritative for reports; detail must reconcile with it.
    if(Number(shift.downtime_minutes)!==d.downtimes.reduce((n,x)=>n+x.minutes,0))fail('تفاصيل التوقف لا تطابق إجمالي الوردية',400);
   }
  }else if(d.operation==='HANDOVER'){
   if(['CONSUMED','REJECTED'].includes(subject.status))fail('المطواة مغلقة');
   if(subject.barcode!==d.barcode)fail('الباركود لا يطابق المطواة',400);
   await reference(db,company,'payroll_employees',d.senderEmployeeId,'AND is_active');
   await reference(db,company,'payroll_employees',d.recipientEmployeeId,'AND is_active');
   if(subject.custody_employee_id&&subject.custody_employee_id!==d.senderEmployeeId)fail('المرسل ليس صاحب العهدة الحالي');
   if(subject.custody_location&&subject.custody_location!==d.fromLocation)fail('الموقع السابق لا يطابق العهدة');
   extra={previousCustody:{employeeId:subject.custody_employee_id,location:subject.custody_location},initialHandover:!subject.custody_employee_id};
   await db.query(`UPDATE ${table} SET custody_employee_id=$3,custody_location=$4 WHERE company_id=$1 AND id=$2`,[company,id,d.recipientEmployeeId,d.toLocation]);
  }else{
   if(!['DRAFT','RELEASED','IN_PROGRESS'].includes(subject.status))fail('أمر التسدية مغلق');
   extra={originalSpecification:subject.specification_snapshot,previousOverride:subject.selvedge_override};
   await db.query('UPDATE manufacturing_warping_orders SET selvedge_override=$3::jsonb WHERE company_id=$1 AND id=$2',[company,id,JSON.stringify({threadCount:d.threadCount,yarnDescription:d.yarnDescription,reason:d.notes})]);
  }
  const result={version:d.version+1};
  await db.query(`UPDATE ${table} SET version=version+1,updated_at=now() WHERE company_id=$1 AND id=$2`,[company,id]);
  const subjectColumn={WARPING:"warping_order_id",SIZING:"sizing_order_id",WEAVING:"weaving_run_id",WARP:"warp_beam_id",SIZED:"sized_beam_id"}[stage];
  const saved=(await db.query(`INSERT INTO manufacturing_execution_records(company_id,stage,subject_id,operation,request_id,request_hash,details,created_by_user_id,${subjectColumn},shift_type_id,machine_id,shift_log_id,sender_employee_id,recipient_employee_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$3,$9,$10,$11,$12,$13) RETURNING id`,[company,stage,id,d.operation,d.requestId,hash,JSON.stringify({...d,...extra,result}),user,d.operation==='DAILY_LOG'?d.shiftTypeId:null,d.operation==='DAILY_LOG'?d.machineId:null,d.operation==='DAILY_LOG'?d.shiftLogId??null:null,d.operation==='HANDOVER'?d.senderEmployeeId:null,d.operation==='HANDOVER'?d.recipientEmployeeId:null])).rows[0];
  if(d.operation==='DAILY_LOG'){
   for(const w of d.workers)await db.query('INSERT INTO manufacturing_execution_workers(company_id,record_id,employee_id,minutes) VALUES($1,$2,$3,$4)',[company,saved.id,w.employeeId,w.minutes]);
   for(const x of d.downtimes)await db.query('INSERT INTO manufacturing_execution_downtimes(company_id,record_id,reason_id,minutes,notes) VALUES($1,$2,$3,$4,$5)',[company,saved.id,x.reasonId,x.minutes,x.notes??null]);
  }
  await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[company,user,'MANUFACTURING_'+d.operation,table,id,JSON.stringify({recordId:saved.id,...d,...extra})]);
  await db.query('COMMIT');return {id:saved.id,...result,replayed:false};
 }catch(e){await db.query('ROLLBACK');if((e as {code?:string}).code==='23505')fail('تم تسجيل تفاصيل هذه الوردية مسبقاً');throw e;}finally{db.release();}
}
