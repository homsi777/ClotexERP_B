import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, type JwtPayload } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { addManufacturingCharge, costRate, finalizeManufacturingCost, linkManufacturingExternal, lockCostOrder, manufacturingCostReport, postManufacturingMaterial } from '../services/manufacturingCostService.js';
const has=(u:JwtPayload,p:string)=>u.role==='admin'||u.permissions.includes(p);
const price=(u:JwtPayload)=>['admin','accountant'].includes(u.role)||has(u,'manufacturing.cost.manage');
export const manufacturingCostRoutes:FastifyPluginAsync=async app=>{
 app.addHook('preHandler',authenticateRequest);
 app.get('/options',async(req,reply)=>{
  const u=req.user!;if(!has(u,'inventory.manage')&&!has(u,'manufacturing.work_orders.view')&&!price(u))return sendError(reply,403,'لا تملك صلاحية العرض','FORBIDDEN');
  const [orders,lots,stages,jobs]=await Promise.all([
   getPool().query("SELECT id,work_order_no,status FROM manufacturing_work_orders WHERE company_id=$1 AND status<>'CANCELLED' ORDER BY created_at DESC",[u.companyId]),
   getPool().query("SELECT y.id,y.barcode,y.weight_kg,f.name FROM yarn_lots y JOIN fabric_items f ON f.id=y.item_id AND f.company_id=y.company_id WHERE y.company_id=$1 AND y.status='AVAILABLE' ORDER BY f.name",[u.companyId]),
   getPool().query(`SELECT id,work_order_id,run_no name,'WEAVING' stage,status FROM manufacturing_weaving_runs WHERE company_id=$1 UNION ALL SELECT s.id,w.work_order_id,s.sizing_order_no name,'SIZING' stage,s.status FROM manufacturing_sizing_orders s JOIN manufacturing_warp_beams b ON b.id=s.input_beam_id AND b.company_id=s.company_id JOIN manufacturing_warping_orders w ON w.id=b.warping_order_id AND w.company_id=b.company_id WHERE s.company_id=$1`,[u.companyId]),
   getPool().query("SELECT id,job_no FROM external_jobs WHERE company_id=$1 AND job_kind='PROCESSING' AND document_status='CONFIRMED' ORDER BY created_at DESC",[u.companyId])]);
  return {ok:true,data:{orders:orders.rows,lots:lots.rows,stages:stages.rows,jobs:jobs.rows,canPrice:price(u),canViewCost:price(u)||has(u,'manufacturing.cost.view'),canPost:has(u,'inventory.manage')}};
 });
 app.get('/:id',async(req,reply)=>{
  const u=req.user!;if(!price(u)&&!has(u,'manufacturing.cost.view')&&!has(u,'inventory.manage'))return sendError(reply,403,'لا تملك صلاحية العرض','FORBIDDEN');
  const id=(req.params as {id:string}).id;if(!z.string().uuid().safeParse(id).success)return sendError(reply,400,'المعرف غير صالح','VALIDATION');
  try{
   const report=await manufacturingCostReport(getPool(),u.companyId,id);
   if(!price(u)&&!has(u,'manufacturing.cost.view'))return {ok:true,data:{work:report.work,materials:report.materials.map(m=>({id:m.id,kind:m.kind,yarn_lot_id:m.yarn_lot_id,weaving_run_id:m.weaving_run_id,sizing_order_id:m.sizing_order_id,weight_kg:m.weight_kg,waste_kg:m.waste_kg,notes:m.notes})),external:report.external.map(j=>({id:j.id,job_no:j.job_no,lifecycle_closed_at:j.lifecycle_closed_at})),rolls:report.rolls}};
   return {ok:true,data:report};
  }catch(e){return handle(e,reply);}
 });
 for(const action of ['materials','charges','external-link','price-material','finalize'] as const){
  app.post(`/:id/${action}`,async(req,reply)=>{
   const u=req.user!;if(action==='materials'?!has(u,'inventory.manage'):!price(u))return sendError(reply,403,'لا تملك صلاحية الإجراء','FORBIDDEN');
   const id=(req.params as {id:string}).id;if(!z.string().uuid().safeParse(id).success)return sendError(reply,400,'المعرف غير صالح','VALIDATION');
   const db=await getPool().connect();try{
    await db.query('BEGIN');let data:unknown;
    if(action==='materials')data=await postManufacturingMaterial(db,u.companyId,u.sub,id,req.body);
    else if(action==='charges')data=await addManufacturingCharge(db,u.companyId,u.sub,id,req.body);
    else if(action==='external-link')data=await linkManufacturingExternal(db,u.companyId,u.sub,id,z.object({jobId:z.string().uuid()}).parse(req.body).jobId);
    else if(action==='finalize')data=await finalizeManufacturingCost(db,u.companyId,u.sub,id);
    else{
     const p=z.object({source:z.enum(['WARP','MATERIAL']),entryId:z.string().uuid(),unitCost:z.number().finite().min(0).max(99999999),currencyCode:z.string().length(3).transform(s=>s.toUpperCase()),notes:z.string().trim().min(1).max(2000)}).strict().parse(req.body);
     await lockCostOrder(db,u.companyId,id);const rate=await costRate(db,u.companyId,p.currencyCode);if(!rate)throw Object.assign(new Error('سعر الصرف غير صالح'),{code:'VALIDATION'});
     if(p.source==='WARP')data=(await db.query(`UPDATE manufacturing_warping_yarn_issue_lines l SET issued_unit_cost=$4,issued_currency_code=$5,issued_exchange_rate=$6 FROM manufacturing_warping_yarn_issues i,manufacturing_warping_orders w WHERE l.company_id=$1 AND l.id=$3 AND i.id=l.issue_id AND i.company_id=l.company_id AND w.id=i.warping_order_id AND w.company_id=i.company_id AND w.work_order_id=$2 RETURNING l.id`,[u.companyId,id,p.entryId,p.unitCost,p.currencyCode,rate])).rows;
     else data=(await db.query(`UPDATE manufacturing_material_entries SET unit_cost=$4,currency_code=$5,exchange_rate=$6 WHERE company_id=$1 AND work_order_id=$2 AND ((id=$3 AND kind='ISSUE') OR source_entry_id=$3) RETURNING id`,[u.companyId,id,p.entryId,p.unitCost,p.currencyCode,rate])).rows;
     if(!(data as unknown[]).length)throw Object.assign(new Error('سطر التكلفة غير موجود'),{code:'NOT_FOUND'});
    }
    await db.query("INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'manufacturing_work_order',$4,$5::jsonb)",[u.companyId,u.sub,`MANUFACTURING_${action.toUpperCase()}`,id,JSON.stringify({input:req.body,result:data})]);
    await db.query('COMMIT');return {ok:true,data};
   }catch(e){await db.query('ROLLBACK').catch(()=>undefined);return handle(e,reply);}finally{db.release();}
  });
 }
};
function handle(e:unknown,reply:import('fastify').FastifyReply){const err=e as {code?:string;message?:string};if(e instanceof z.ZodError)return sendError(reply,400,e.issues[0]?.message??'بيانات غير صالحة','VALIDATION');if(err.code==='NOT_FOUND')return sendError(reply,404,err.message!,'NOT_FOUND');if(['VALIDATION','INVALID_STATE','INVALID_STOCK'].includes(err.code??''))return sendError(reply,400,err.message!,err.code!);if(['23505','DUPLICATE'].includes(err.code??''))return sendError(reply,409,'طلب مكرر أو متعارض','DUPLICATE');throw e;}
