import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {sendError} from '../middleware/errorHandler.js';
export const manufacturingBeamQualityRoutes:FastifyPluginAsync=async(app)=>{
  app.get('/beam-quality',async(req,reply)=>{
    const u=req.user!,kind=(req.query as {kind?:string}).kind==='SIZED'?'SIZED':'WARP';
    const permission=kind==='WARP'?'manufacturing.warping.quality':'manufacturing.sizing.manage';
    if(u.role!=='admin'&&!u.permissions.includes(permission))return sendError(reply,403,'لا تملك صلاحية فحص المطاوي','FORBIDDEN');
    const table=kind==='WARP'?'manufacturing_warp_beams':'manufacturing_sized_beams';
    return {ok:true,data:(await getPool().query(`SELECT id,barcode,beam_no,length_m,status,version FROM ${table} WHERE company_id=$1 AND status='NEEDS_REPAIR' ORDER BY created_at`,[u.companyId])).rows};
  });
  app.post('/beam-quality/:kind/:id',async(req,reply)=>{
    const u=req.user!,params=z.object({kind:z.enum(['WARP','SIZED']),id:z.string().uuid()}).safeParse(req.params),input=z.object({version:z.number().int().positive(),result:z.enum(['ACCEPTED','REJECTED']),notes:z.string().trim().min(3).max(2000)}).safeParse(req.body);
    if(!params.success||!input.success)return sendError(reply,400,'بيانات إعادة الفحص غير صالحة','VALIDATION');
    const {kind,id}=params.data,d=input.data;
    if(u.role!=='admin'&&!u.permissions.includes(kind==='WARP'?'manufacturing.warping.quality':'manufacturing.sizing.manage'))return sendError(reply,403,'لا تملك صلاحية الفحص','FORBIDDEN');
    const db=await getPool().connect();try{
      await db.query('BEGIN');const table=kind==='WARP'?'manufacturing_warp_beams':'manufacturing_sized_beams';
      const beam=(await db.query(`SELECT * FROM ${table} WHERE company_id=$1 AND id=$2 FOR UPDATE`,[u.companyId,id])).rows[0];
      if(!beam||beam.status!=='NEEDS_REPAIR'||beam.version!==d.version){await db.query('ROLLBACK');return sendError(reply,409,'المطواة تغيرت أو لا تنتظر المعالجة','CONFLICT');}
      const next=d.result==='REJECTED'?'REJECTED':kind==='SIZED'?'READY_FOR_WEAVING':beam.next_stage==='SIZING'?'READY_FOR_SIZING':'READY_FOR_WEAVING';
      await db.query(`UPDATE ${table} SET status=$3,quality_status=$4,notes=$5,version=version+1,updated_at=now() WHERE company_id=$1 AND id=$2`,[u.companyId,id,next,d.result,d.notes]);
      if(kind==='SIZED'){
        await db.query('UPDATE manufacturing_sizing_orders SET status=$3,quality_status=$4,quality_notes=$5,version=version+1,updated_at=now(),updated_by_user_id=$6 WHERE company_id=$1 AND id=$2',[u.companyId,beam.sizing_order_id,d.result==='REJECTED'?'REJECTED':'COMPLETED',d.result,d.notes,u.sub]);
        await db.query('UPDATE manufacturing_warp_beams SET status=$3,version=version+1,updated_at=now() WHERE company_id=$1 AND id=$2',[u.companyId,beam.input_beam_id,d.result==='REJECTED'?'REJECTED':'CONSUMED']);
      }
      await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'BEAM_REINSPECTION',$3,$4,$5::jsonb)`,[u.companyId,u.sub,table,id,JSON.stringify({before:beam,result:d})]);await db.query('COMMIT');return {ok:true};
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  });
  app.post('/beam-quality/warp-orders/:id/close',async(req,reply)=>{
    const u=req.user!,id=(req.params as {id:string}).id;
    if(u.role!=='admin'&&!u.permissions.includes('manufacturing.warping.quality'))return sendError(reply,403,'لا تملك صلاحية إغلاق التسدية','FORBIDDEN');
    if(!z.string().uuid().safeParse(id).success)return sendError(reply,400,'معرف غير صالح','VALIDATION');
    const db=await getPool().connect();try{
      await db.query('BEGIN');const order=(await db.query("SELECT id FROM manufacturing_warping_orders WHERE company_id=$1 AND id=$2 AND status='IN_PROGRESS' FOR UPDATE",[u.companyId,id])).rows[0];
      const beams=(await db.query('SELECT status,quality_status FROM manufacturing_warp_beams WHERE company_id=$1 AND warping_order_id=$2',[u.companyId,id])).rows;
      const issues=(await db.query("SELECT 1 FROM manufacturing_warping_yarn_issues WHERE company_id=$1 AND warping_order_id=$2 AND status IN ('REQUESTED','ISSUED') LIMIT 1",[u.companyId,id])).rows;
      if(!order||!beams.length||beams.some(b=>b.status==='NEEDS_REPAIR')||issues.length){await db.query('ROLLBACK');return sendError(reply,409,'يجب حسم فحص جميع المطاوي وتسوية الخيط قبل الإغلاق','CONFLICT');}
      await db.query("UPDATE manufacturing_warping_orders SET status=$3,quality_status=$4,version=version+1,completed_at=now(),completed_by_user_id=$5,updated_at=now() WHERE company_id=$1 AND id=$2",[u.companyId,id,beams.some(b=>b.quality_status==='ACCEPTED')?'COMPLETED':'REJECTED',beams.some(b=>b.quality_status==='ACCEPTED')?'ACCEPTED':'REJECTED',u.sub]);
      await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id) VALUES($1,$2,'WARPING_CLOSED_AFTER_INSPECTION','warping_order',$3)`,[u.companyId,u.sub,id]);await db.query('COMMIT');return {ok:true};
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  });
};
