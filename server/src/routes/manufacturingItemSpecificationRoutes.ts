import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {authenticateRequest} from '../middleware/auth.js';
import {sendError} from '../middleware/errorHandler.js';
import {getPool} from '../db/pool.js';
import {setItemSpecification,confirmOrderLineProduction} from '../services/customerOrderWorkflowService.js';
export const manufacturingItemSpecificationRoutes:FastifyPluginAsync=async(app)=>{
 app.addHook('preHandler',authenticateRequest);
 app.addHook('preHandler',async(req,reply)=>{
 const production=req.url.includes('/production-confirmation');
 const permission=production?'manufacturing.work_orders.manage':req.method==='GET'?'manufacturing.specifications.view':'manufacturing.specifications.approve';
 if(req.user!.role!=='admin'&&!req.user!.permissions.includes(permission))return sendError(reply,403,'ليست لديك الصلاحية','FORBIDDEN');
 if(Object.values(req.params as Record<string,string>).some(id=>!z.string().uuid().safeParse(id).success))return sendError(reply,400,'معرف غير صالح','VALIDATION');
 });
 app.get('/item-specifications',async(req)=>{
 const company=req.user!.companyId;
 const result=await getPool().query(`SELECT f.id,f.internal_code,f.name,
 COALESCE((SELECT MAX(h.revision) FROM manufacturing_item_specifications h WHERE h.company_id=f.company_id AND h.item_id=f.id),0) AS revision,
 m.id AS mapping_id,m.specification_version_id,v.version_no,v.status AS specification_status,s.code AS specification_code
 FROM fabric_items f LEFT JOIN manufacturing_item_specifications m ON m.company_id=f.company_id AND m.item_id=f.id AND m.superseded_at IS NULL
 LEFT JOIN manufacturing_specification_versions v ON v.company_id=m.company_id AND v.specification_id=m.specification_id AND v.id=m.specification_version_id
 LEFT JOIN manufacturing_specifications s ON s.company_id=m.company_id AND s.id=m.specification_id
 WHERE f.company_id=$1 AND f.is_active ORDER BY f.internal_code,f.name`,[company]);
 return {ok:true,data:result.rows};
 });
 app.get('/item-specifications/:itemId/history',async(req)=>({ok:true,data:(await getPool().query(`SELECT m.*,u.username FROM manufacturing_item_specifications m LEFT JOIN users u ON u.company_id=m.company_id AND u.id=m.created_by_user_id WHERE m.company_id=$1 AND m.item_id=$2 ORDER BY m.revision DESC`,[req.user!.companyId,(req.params as {itemId:string}).itemId])).rows}));
 app.put('/item-specifications/:itemId',async(req,reply)=>{
 const parsed=z.object({specificationVersionId:z.string().uuid().nullable(),expectedRevision:z.number().int().min(0),reason:z.string().trim().min(1).max(2000)}).strict().safeParse(req.body);
 if(!parsed.success)return sendError(reply,400,'بيانات الربط غير صالحة','VALIDATION');
 const db=await getPool().connect();try{await db.query('BEGIN');const data=await setItemSpecification(db,req.user!.companyId,req.user!.sub,(req.params as {itemId:string}).itemId,parsed.data);await db.query('COMMIT');return {ok:true,data};}
 catch(e){await db.query('ROLLBACK');const error=e as {code?:string;message:string};if(['VALIDATION','CONFLICT','NOT_FOUND','23514','23505'].includes(error.code??''))return sendError(reply,error.code==='NOT_FOUND'?404:409,error.message,error.code!);throw e;}finally{db.release();}
 });
 app.post('/orders/:orderId/lines/:lineId/production-confirmation',async(req,reply)=>{
 const parsed=z.object({confirmed:z.literal(true),specificationVersionId:z.string().uuid(),mappingId:z.string().uuid().nullable(),targetLengthM:z.number().positive().multipleOf(0.001)}).strict().safeParse(req.body);
 if(!parsed.success)return sendError(reply,400,'راجع المواصفة والكمية وأكد الإنتاج','VALIDATION');
 const ids=req.params as {orderId:string;lineId:string},db=await getPool().connect();
 try{await db.query('BEGIN');const data=await confirmOrderLineProduction(db,req.user!.companyId,req.user!.sub,ids.orderId,ids.lineId,parsed.data);await db.query('COMMIT');return reply.code(201).send({ok:true,data});}
 catch(e){await db.query('ROLLBACK');const error=e as {code?:string;message:string};if(['VALIDATION','CONFLICT','NOT_FOUND'].includes(error.code??''))return sendError(reply,error.code==='NOT_FOUND'?404:409,error.message,error.code!);throw e;}finally{db.release();}
 });
};
