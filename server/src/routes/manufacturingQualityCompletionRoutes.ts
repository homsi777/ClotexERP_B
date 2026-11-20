import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { sendError } from '../middleware/errorHandler.js';
import { listQualityInbox,externalQualityDetail,inspectExternalQuality,decideExternalQuality } from '../services/manufacturingQualityCompletionService.js';
// Registered inside manufacturingQualityRoutes: inherits authentication, no application registration changes.
export const manufacturingQualityCompletionRoutes: FastifyPluginAsync = async app => {
  const rawView = (u: NonNullable<import('../middleware/auth.js').JwtPayload>) => u.role==='admin'||u.permissions.some(p=>['manufacturing.weaving.view','manufacturing.raw_inspection.manage','inventory.manage'].includes(p));
  const externalView = (u: NonNullable<import('../middleware/auth.js').JwtPayload>) => ['admin','accountant'].includes(u.role)||u.permissions.includes('inventory.manage')||u.permissions.includes('manufacturing.raw_inspection.manage');
  app.get('/defect-options',async(req,reply)=>{
    const u=req.user!;
    if(!rawView(u)&&!externalView(u)&&!u.permissions.some(p=>['manufacturing.warping.quality','manufacturing.sizing.manage','manufacturing.reference.view'].includes(p)))return sendError(reply,403,'ليست لديك صلاحية عرض العيوب','FORBIDDEN');
    const parsed=z.object({inspectionType:z.enum(['WARP_BEAM','SIZED_BEAM','RAW_FABRIC','FINISHED_FABRIC'])}).safeParse(req.query);
    if(!parsed.success)return sendError(reply,400,'حدد نوع الفحص','VALIDATION');
    const rows=await getPool().query(`SELECT id,code,name,inspection_type,default_severity,description FROM manufacturing_quality_defect_catalog WHERE company_id=$1 AND is_active AND inspection_type IN('ALL',$2) ORDER BY code,name`,[u.companyId,parsed.data.inspectionType]);
    return {ok:true,data:rows.rows};
  });
  app.get('/inbox',async(req,reply)=>{
    const u=req.user!;
    if(!rawView(u)&&!externalView(u))return sendError(reply,403,'ليست لديك صلاحية عرض الجودة','FORBIDDEN');
    return {ok:true,data:await listQualityInbox(getPool(),u.companyId,rawView(u),externalView(u))};
  });
  app.get('/finished/:id/report',async(req,reply)=>{
    if(!externalView(req.user!))return sendError(reply,403,'ليست لديك صلاحية عرض الجودة','FORBIDDEN');
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);
    if(!id.success)return sendError(reply,400,'معرف غير صالح','VALIDATION');
    try{return {ok:true,data:await externalQualityDetail(getPool(),req.user!.companyId,id.data)};}catch(e){return handle(e,reply);}
  });
  for(const action of ['inspection','decision'] as const)app.post(`/finished/:id/${action}`,async(req,reply)=>{
    const u=req.user!;
    const allowed=action==='decision'?['admin','accountant'].includes(u.role):u.role==='admin'||u.permissions.includes('manufacturing.raw_inspection.manage')||u.permissions.includes('inventory.manage');
    if(!allowed)return sendError(reply,403,'ليست لديك صلاحية هذا الإجراء','FORBIDDEN');
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);
    if(!id.success)return sendError(reply,400,'معرف غير صالح','VALIDATION');
    const db=await getPool().connect();
    try{await db.query('BEGIN');const data=await (action==='inspection'?inspectExternalQuality:decideExternalQuality)(db,u.companyId,u.sub,id.data,req.body);await db.query('COMMIT');return {ok:true,data};}
    catch(e){await db.query('ROLLBACK');return handle(e,reply);}finally{db.release();}
  });
};
function handle(e:unknown,reply:import('fastify').FastifyReply){
  if(e instanceof z.ZodError)return sendError(reply,400,'بيانات الجودة غير صالحة','VALIDATION');
  const err=e as {code?:string;message:string};
  if(['NOT_FOUND','INVALID_STATE','VALIDATION'].includes(err.code??''))return sendError(reply,err.code==='NOT_FOUND'?404:err.code==='VALIDATION'?400:409,err.message,err.code!);
  if(['23505','23503','40001','40P01'].includes(err.code??''))return sendError(reply,409,'تعارض؛ حدث بيانات الجودة','CONFLICT');
  throw e;
}
