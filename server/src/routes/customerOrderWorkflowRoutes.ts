import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {authenticateRequest} from '../middleware/auth.js';
import {sendError} from '../middleware/errorHandler.js';
import {orderInventoryWorkflow,reserveOrderLine,releaseOrderLine} from '../services/customerOrderWorkflowService.js';

export const customerOrderWorkflowRoutes:FastifyPluginAsync=async(app)=>{
  app.addHook('preHandler',authenticateRequest);
  app.addHook('preHandler',async(req,reply)=>{
    const user=req.user!;
    const view=req.method==='GET';
    if(user.role!=='admin'&&!user.permissions.includes(view?'customers.view':'customers.manage'))return sendError(reply,403,'ليست لديك صلاحية متابعة الأوردر أو إدارة حجزه','FORBIDDEN');
    const ids=req.params as Record<string,string>;
    if(Object.values(ids).some(v=>!z.string().uuid().safeParse(v).success))return sendError(reply,400,'معرف غير صالح','VALIDATION');
  });
  app.get('/:id/workflow',async(req)=>{
    const db=await getPool().connect();
    try{return {ok:true,data:await orderInventoryWorkflow(db,req.user!.companyId,(req.params as {id:string}).id)};}finally{db.release();}
  });
  app.get('/:id/history',async(req)=>{
    const company=req.user!.companyId,id=(req.params as {id:string}).id;
    const rows=await getPool().query(`SELECT a.id,a.action,a.details,a.created_at,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id AND u.company_id=a.company_id WHERE a.company_id=$1 AND a.entity_type='customer_order' AND a.entity_id=$2 ORDER BY a.created_at DESC LIMIT 200`,[company,id]);
    return {ok:true,data:rows.rows};
  });
  for(const action of ['reserve','release'] as const)app.post(`/:id/lines/:lineId/${action}`,async(req,reply)=>{
    const ids=req.params as {id:string;lineId:string};
    const input=z.object({rollIds:z.array(z.string().uuid()).max(500).optional()}).safeParse(req.body??{});
    if(!input.success)return sendError(reply,400,'قائمة الرولات غير صالحة','VALIDATION');
    if(input.data.rollIds&&new Set(input.data.rollIds).size!==input.data.rollIds.length)return sendError(reply,400,'الرولات مكررة','VALIDATION');
    const db=await getPool().connect();
    try{await db.query('BEGIN');const data=action==='reserve'?await reserveOrderLine(db,req.user!.companyId,req.user!.sub,ids.id,ids.lineId,input.data.rollIds):await releaseOrderLine(db,req.user!.companyId,req.user!.sub,ids.id,ids.lineId);
      await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'customer_order',$4,$5::jsonb)`,[req.user!.companyId,req.user!.sub,action==='reserve'?'RESERVE':'RELEASE_RESERVATION',ids.id,JSON.stringify({lineId:ids.lineId,rollIds:input.data.rollIds??null})]);
      await db.query('COMMIT');return {ok:true,data};
    }catch(e){await db.query('ROLLBACK');const err=e as {code?:string;message:string};if(['VALIDATION','INVALID_STOCK','NOT_FOUND','23505'].includes(err.code??''))return sendError(reply,err.code==='NOT_FOUND'?404:409,err.message,err.code??'CONFLICT');throw e;}finally{db.release();}
  });
};
