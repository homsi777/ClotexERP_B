import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {sendError} from '../middleware/errorHandler.js';
import {createHash} from 'node:crypto';
const pattern=z.array(z.object({sequenceNo:z.number().int().positive(),sourceCell:z.string().max(30).default('MANUAL'),colorName:z.string().trim().min(1).max(120),threadOrPickCount:z.number().finite().positive(),repeatCount:z.number().finite().positive().nullable()})).max(1000);
const input=z.object({requestId:z.string().uuid(),sourceVersionId:z.string().uuid(),targetCode:z.string().trim().min(1).max(64).optional(),targetName:z.string().trim().min(1).max(160).optional(),technicalFields:z.record(z.union([z.string().max(1000),z.number().finite(),z.boolean()])).refine(v=>Object.keys(v).length<=200),warpPattern:pattern.nullable(),weftPattern:pattern.nullable(),notes:z.string().trim().min(1).max(2000)}).strict();
export const manufacturingSpecificationRevisionRoutes:FastifyPluginAsync=async(app)=>{
  app.post('/specifications/revise',async(req,reply)=>{
    const u=req.user!;
    if(u.role!=='admin'&&!u.permissions.includes('manufacturing.specifications.import'))return sendError(reply,403,'لا تملك صلاحية إنشاء إصدار مواصفات','FORBIDDEN');
    const parsed=input.safeParse(req.body);if(!parsed.success)return sendError(reply,400,parsed.error.issues[0].message,'VALIDATION');
    const d=parsed.data,db=await getPool().connect(),fingerprint=createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    try{
      await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[u.companyId,d.requestId]);
      const prior=await db.query("SELECT details FROM audit_logs WHERE company_id=$1 AND action='SPECIFICATION_REVISED' AND details->>'requestId'=$2",[u.companyId,d.requestId]);
      if(prior.rows.length){await db.query('ROLLBACK');if(prior.rows[0].details.fingerprint!==fingerprint)return sendError(reply,409,'معرف الطلب مستخدم لتعديل مختلف','CONFLICT');return {ok:true,data:prior.rows[0].details.result};}
      const source=(await db.query(`SELECT v.*,s.code,s.name FROM manufacturing_specification_versions v JOIN manufacturing_specifications s ON s.company_id=v.company_id AND s.id=v.specification_id WHERE v.company_id=$1 AND v.id=$2 FOR UPDATE OF s`,[u.companyId,d.sourceVersionId])).rows[0];
      if(!source){await db.query('ROLLBACK');return sendError(reply,404,'إصدار المصدر غير موجود','NOT_FOUND');}
      let specId=source.specification_id;
      if(d.targetCode&&d.targetCode!==source.code)specId=(await db.query('INSERT INTO manufacturing_specifications(company_id,code,name,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$4) RETURNING id',[u.companyId,d.targetCode,d.targetName||source.name,u.sub])).rows[0].id;
      const next=Number((await db.query('SELECT COALESCE(MAX(version_no),0)+1 AS next FROM manufacturing_specification_versions WHERE company_id=$1 AND specification_id=$2',[u.companyId,specId])).rows[0].next);
      const data={...source.parsed_data,technicalFields:d.technicalFields,warp:source.parsed_data.warp?{...source.parsed_data.warp,pattern:d.warpPattern??source.parsed_data.warp.pattern,requirements:[]}:null,weft:source.parsed_data.weft?{...source.parsed_data.weft,pattern:d.weftPattern??source.parsed_data.weft.pattern,requirements:[]}:null,manualRevision:{sourceVersionId:source.id,reason:d.notes,requirementsReferenceOnly:true,sourceWorkbookRequirements:{warp:source.parsed_data.warp?.requirements??[],weft:source.parsed_data.weft?.requirements??[]}}};
      const version=(await db.query(`INSERT INTO manufacturing_specification_versions(company_id,specification_id,version_no,status,source_file_name,source_file_content,source_file_size,source_file_sha256,parsed_data,validation_warnings,notes,created_by_user_id)
        VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11) RETURNING id`,[u.companyId,specId,next,source.source_file_name,source.source_file_content,source.source_file_size,source.source_file_sha256,JSON.stringify(data),JSON.stringify(source.validation_warnings),d.notes,u.sub])).rows[0];
      const result={specificationId:specId,versionId:version.id,versionNo:next,status:'DRAFT'};
      await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'SPECIFICATION_REVISED','manufacturing_specification',$3,$4::jsonb)`,[u.companyId,u.sub,specId,JSON.stringify({requestId:d.requestId,sourceVersionId:source.id,fingerprint,result})]);
      await db.query('COMMIT');return reply.status(201).send({ok:true,data:result});
    }catch(e){await db.query('ROLLBACK');if((e as {code?:string}).code==='23505')return sendError(reply,409,'كود البطاقة مستخدم؛ اختر كوداً جديداً للنسخ','CONFLICT');throw e;}finally{db.release();}
  });
};
