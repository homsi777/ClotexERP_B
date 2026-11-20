import type {PoolClient} from 'pg';
import {z} from 'zod';
import {lockCostOrder} from './manufacturingCostService.js';
type Db=Pick<PoolClient,'query'>;
export async function assertExternalCostUnfrozen(db:Db,company:string,job:string){
  const frozen=await db.query(`SELECT 1 FROM manufacturing_cost_closures c WHERE c.company_id=$1 AND c.work_order_id IN (SELECT work_order_id FROM manufacturing_external_links WHERE company_id=$1 AND job_id=$2 UNION SELECT work_order_id FROM manufacturing_external_cost_shares WHERE company_id=$1 AND job_id=$2) LIMIT 1`,[company,job]);
  if(frozen.rows.length)throw Object.assign(new Error('تكلفة الإنتاج معتمدة؛ لا يمكن إلغاء المصنعية أو تعديل أجرتها'),{code:'INVALID_STATE'});
}
export async function mixedExternalOrigins(db:Db,company:string,rollIds:string[]){
  const rows=(await db.query(`WITH RECURSIVE ancestors(seed,id) AS (SELECT r,r FROM unnest($2::uuid[]) r
    UNION SELECT a.seed,q.source_roll_id FROM external_job_return_sources q JOIN ancestors a ON a.id=q.result_roll_id WHERE q.company_id=$1)
    SELECT DISTINCT a.seed,r.work_order_id FROM ancestors a JOIN manufacturing_raw_roll_outputs o ON o.company_id=$1 AND o.result_fabric_roll_id=a.id
    JOIN manufacturing_weaving_runs r ON r.company_id=o.company_id AND r.id=o.weaving_run_id ORDER BY r.work_order_id`,[company,rollIds])).rows;
  if(rollIds.some(id=>new Set(rows.filter(r=>r.seed===id).map(r=>r.work_order_id)).size>1))throw Object.assign(new Error('مصدر إحدى الرولات متعدد وغير محسوم؛ راجع التتبع قبل توزيع التكلفة'),{code:'VALIDATION'});
  const orders=[...new Set(rows.map(r=>String(r.work_order_id)))].sort();
  for(const id of orders)await lockCostOrder(db,company,id);
  return [...orders,...(rollIds.some(id=>!rows.some(r=>r.seed===id))?[null]:[])];
}
export async function registerMixedCost(db:Db,company:string,job:string,origins:Array<string|null>){
  for(const order of origins)await db.query('INSERT INTO manufacturing_external_cost_shares(company_id,job_id,work_order_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[company,job,order]);
}
export async function getMixedCostShares(db:Db,company:string,job:string){
  return (await db.query(`SELECT a.id,a.work_order_id,w.work_order_no,a.allocated_usd,a.approved_at FROM manufacturing_external_cost_shares a LEFT JOIN manufacturing_work_orders w ON w.company_id=a.company_id AND w.id=a.work_order_id WHERE a.company_id=$1 AND a.job_id=$2 ORDER BY w.work_order_no NULLS LAST`,[company,job])).rows;
}
export async function allocateMixedCost(db:PoolClient,company:string,user:string,jobId:string,raw:unknown){
  const input=z.object({reason:z.string().trim().min(3).max(2000),lines:z.array(z.object({shareId:z.string().uuid(),amountUsd:z.number().finite().min(0).max(999999999).refine(n=>Math.abs(n*10000-Math.round(n*10000))<.00001)})).min(1).max(200)}).strict().parse(raw);
  const shares=await getMixedCostShares(db,company,jobId);
  for(const id of shares.flatMap(s=>s.work_order_id?[String(s.work_order_id)]:[]).sort())await lockCostOrder(db,company,id);
  const job=(await db.query('SELECT fee_amount,fee_exchange_rate_to_usd,document_status,traceability_only FROM external_jobs WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,jobId])).rows[0];
  if(!job||job.document_status!=='CONFIRMED'||!job.traceability_only||job.fee_amount==null||!(Number(job.fee_exchange_rate_to_usd)>0))throw Object.assign(new Error('سعّر مهمة المصنعية المختلطة أولاً'),{code:'VALIDATION'});
  if((await db.query('SELECT 1 FROM external_job_services WHERE company_id=$1 AND job_id=$2 AND total_usd IS NULL LIMIT 1',[company,jobId])).rows.length)throw Object.assign(new Error('أكمل تسعير جميع الخدمات قبل توزيع الأجرة'),{code:'VALIDATION'});
  if(input.lines.length!==shares.length||new Set(input.lines.map(s=>s.shareId)).size!==shares.length||input.lines.some(l=>!shares.some(s=>s.id===l.shareId)))throw Object.assign(new Error('حدد حصة كل مصدر من مصادر المهمة مرة واحدة'),{code:'VALIDATION'});
  const total=input.lines.reduce((n,l)=>n+Math.round(l.amountUsd*10000),0),fee=Math.round(Number(job.fee_amount)/Number(job.fee_exchange_rate_to_usd)*10000);
  if(total!==fee)throw Object.assign(new Error('مجموع الحصص لا يساوي أجرة المهمة بالدولار'),{code:'VALIDATION'});
  for(const line of input.lines)await db.query('UPDATE manufacturing_external_cost_shares SET allocated_usd=$3,approved_by_user_id=$4,approved_at=clock_timestamp() WHERE company_id=$1 AND job_id=$2 AND id=$5',[company,jobId,line.amountUsd,user,line.shareId]);
  await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'MIXED_EXTERNAL_COST_ALLOCATED','external_job',$3,$4::jsonb)`,[company,user,jobId,JSON.stringify({before:shares,input})]);
  return {totalUsd:total/10000};
}
