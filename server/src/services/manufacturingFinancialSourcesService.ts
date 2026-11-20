import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';
type Db=Pick<PoolClient,'query'>;
const uuid=z.string().uuid();
const fail=(message:string,code='VALIDATION'):never=>{throw Object.assign(new Error(message),{code});};
export const payrollCostBasis=z.enum(['ELIGIBLE_EARNINGS','APPROVED_NET_SNAPSHOT']);
export type PayrollCostBasis=z.infer<typeof payrollCostBasis>;
/** Aggregates already include line-item effects. Never add payroll items twice. */
export function payrollAllocationSnapshot(line:Record<string,unknown>,run:Record<string,unknown>,basis:PayrollCostBasis,eligibleAmount?:number) {
 const baseSalary=Number(line.base_salary),allowances=Number(line.allowances),deductions=Number(line.deductions),netSalary=Number(line.net_salary);
 const grossEarnings=Math.round((baseSalary+allowances)*10000)/10000;
 if(![baseSalary,allowances,deductions,netSalary,grossEarnings].every(Number.isFinite))fail('مكونات مصدر الراتب غير صالحة');
 const cap=basis==='APPROVED_NET_SNAPSHOT'?netSalary:eligibleAmount;
 if(cap===undefined) throw Object.assign(new Error('حدد سقف مكونات الأجر المؤهلة صراحةً'),{code:'VALIDATION'});
 if(!Number.isFinite(cap)||cap<=0||Math.abs(cap*10000-Math.round(cap*10000))>0.00001)fail('حدد سقف مكونات الأجر المؤهلة صراحةً');
 if(basis==='APPROVED_NET_SNAPSHOT'&&eligibleAmount!==undefined&&eligibleAmount!==netSalary)fail('لقطة الصافي تحتفظ بصافي المسير دون تعديل');
 if(basis==='ELIGIBLE_EARNINGS'&&Math.round(cap*10000)>Math.round(grossEarnings*10000))fail('المبلغ المؤهل يتجاوز الأساسي والاستحقاقات المسجلة');
 return {basis,baseSalary,allowances,deductions,netSalary,grossEarnings,eligibleAmount:cap,
 excludedEarnings:Math.round((grossEarnings-cap)*10000)/10000,
 deductionsTreatment:basis==='ELIGIBLE_EARNINGS'?'EXPLICIT_ELIGIBILITY_NOT_AUTOMATIC_NETTING':'NET_SNAPSHOT_INCLUDES_SOURCE_DEDUCTIONS',
 currencyCode:run.currency_code,exchangeRate:Number(run.exchange_rate_to_usd),payrollRunId:run.id,payrollLineId:line.id,employeeId:line.employee_id};
}
export async function manufacturingAssetRegister(db:Db,company:string) {
 return (await db.query(`SELECT r.*,r.acquisition_date::text AS acquisition_date FROM manufacturing_asset_register r WHERE r.company_id=$1 ORDER BY r.code,r.machine_id`,[company])).rows;
}
/** Caller owns transaction. Optimistic machine version protects reference-editor changes. */
export async function setManufacturingAssetAcquisition(db:Db,company:string,user:string,raw:unknown) {
 const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'تاريخ الاقتناء غير صالح');
 const d=z.object({requestId:uuid,machineId:uuid,version:z.number().int().positive(),acquisitionDate:date.nullable(),notes:z.string().trim().min(1).max(2000)}).strict().parse(raw);
 const fingerprint=createHash('sha256').update(JSON.stringify(d)).digest('hex');
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[company+d.requestId]);
 const prior=(await db.query('SELECT request_hash,result FROM manufacturing_asset_register_requests WHERE company_id=$1 AND request_id=$2',[company,d.requestId])).rows[0];
 if(prior){if(prior.request_hash!==fingerprint)fail('معرف الطلب مستخدم بمحتوى مختلف','DUPLICATE');return prior.result;}
 const m=(await db.query('SELECT id,version FROM manufacturing_machines WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,d.machineId])).rows[0];
 if(!m)fail('الماكينة غير موجودة','NOT_FOUND');
 if(m.version!==d.version)fail('تغيرت بيانات الماكينة؛ حدّث السجل قبل الحفظ','DUPLICATE');
 const result=(await db.query(`UPDATE manufacturing_machines SET acquisition_date=$3,version=version+1,updated_by_user_id=$4,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING id,version,acquisition_date::text AS acquisition_date`,[company,d.machineId,d.acquisitionDate,user])).rows[0];
 await db.query(`INSERT INTO manufacturing_asset_register_requests(company_id,request_id,machine_id,request_hash,result,created_by_user_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,[company,d.requestId,d.machineId,fingerprint,JSON.stringify(result),user]);
 await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'MANUFACTURING_ASSET_ACQUISITION','manufacturing_machine',$3,$4::jsonb)`,[company,user,d.machineId,JSON.stringify({input:d,result})]);
 return result;
}
