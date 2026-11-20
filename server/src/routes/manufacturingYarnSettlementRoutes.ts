import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {sendError} from '../middleware/errorHandler.js';
const kg=z.number().finite().min(0).max(999999999).refine(n=>Math.abs(n*1000-Math.round(n*1000))<.00001);
const lineSchema=z.object({lineId:z.string().uuid(),consumedKg:kg,returnedKg:kg,wasteKg:kg});
const proposal=z.object({version:z.number().int().min(0),reason:z.string().trim().min(3).max(2000),lines:z.array(lineSchema).min(1).max(100)});
type Line=z.infer<typeof lineSchema>&{differenceKg:number};
const fail=(message:string):never=>{throw Object.assign(new Error(message),{code:'VALIDATION'});};
export const manufacturingYarnSettlementRoutes:FastifyPluginAsync=async(app)=>{
  app.get('/yarn-issues/:issueId/settlement',async(req,reply)=>{
    const u=req.user!,id=(req.params as {issueId:string}).issueId;
    if(u.role!=='admin'&&!['manufacturing.warping.view','manufacturing.warping.manage','manufacturing.yarn_issue.approve'].some(p=>u.permissions.includes(p)))return sendError(reply,403,'لا تملك صلاحية عرض العهدة','FORBIDDEN');
    if(!z.string().uuid().safeParse(id).success)return sendError(reply,400,'معرف غير صالح','VALIDATION');
    return {ok:true,data:(await getPool().query('SELECT * FROM manufacturing_yarn_settlement_proposals WHERE company_id=$1 AND issue_id=$2',[u.companyId,id])).rows[0]??null};
  });
  for(const action of ['propose','approve'] as const)app.post(`/yarn-issues/:issueId/settlement/${action}`,async(req,reply)=>{
    const u=req.user!,id=(req.params as {issueId:string}).issueId;
    if(u.role!=='admin'&&!u.permissions.includes(action==='approve'?'manufacturing.yarn_issue.approve':'manufacturing.warping.manage'))return sendError(reply,403,'لا تملك صلاحية الإجراء','FORBIDDEN');
    if(!z.string().uuid().safeParse(id).success)return sendError(reply,400,'معرف غير صالح','VALIDATION');
    const db=await getPool().connect();
    try{
      await db.query('BEGIN');const issue=(await db.query('SELECT * FROM manufacturing_warping_yarn_issues WHERE company_id=$1 AND id=$2 FOR UPDATE',[u.companyId,id])).rows[0];
      if(!issue||issue.status!=='ISSUED')fail('العهدة غير موجودة أو لم تعد مفتوحة');
      const before=(await db.query('SELECT * FROM manufacturing_yarn_settlement_proposals WHERE company_id=$1 AND issue_id=$2',[u.companyId,id])).rows[0];
      const issued=(await db.query('SELECT * FROM manufacturing_warping_yarn_issue_lines WHERE company_id=$1 AND issue_id=$2 ORDER BY id FOR UPDATE',[u.companyId,id])).rows;
      if(action==='propose'){
        const d=proposal.parse(req.body);if(d.version!==(before?.version??0))fail('تغيرت التسوية؛ أعد تحميلها');
        if(d.lines.length!==issued.length||new Set(d.lines.map(l=>l.lineId)).size!==issued.length)fail('حدد كل سطور العهدة مرة واحدة');
        const lines=d.lines.map(line=>{const source=issued.find(l=>l.id===line.lineId);if(!source)fail('السطر لا يتبع العهدة');const differenceKg=Math.round((Number(source.issued_weight_kg)-line.consumedKg-line.returnedKg-line.wasteKg)*1000)/1000;if(differenceKg<0)fail('مجموع الكميات يتجاوز المصروف');return {...line,differenceKg};});
        await db.query(`INSERT INTO manufacturing_yarn_settlement_proposals(company_id,issue_id,version,lines,reason,proposed_by_user_id) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(company_id,issue_id) DO UPDATE SET version=EXCLUDED.version,lines=EXCLUDED.lines,reason=EXCLUDED.reason,proposed_by_user_id=EXCLUDED.proposed_by_user_id,proposed_at=clock_timestamp(),approved_at=NULL,approved_by_user_id=NULL`,[u.companyId,id,d.version+1,JSON.stringify(lines),d.reason,u.sub]);
      }else{
        const d=z.object({version:z.number().int().positive(),reason:z.string().trim().min(3).max(2000),receivedReturns:z.array(z.object({lineId:z.string().uuid(),weightKg:kg})).max(100)}).parse(req.body);
        if(!before||before.version!==d.version||before.approved_at)fail('تغيرت التسوية أو اعتمدت مسبقاً');
        const lines=before.lines as Line[];
        if(d.receivedReturns.length!==lines.length||new Set(d.receivedReturns.map(l=>l.lineId)).size!==lines.length)fail('أكد وزن كل مرتجع فعلياً');
        for(const line of [...lines].sort((a,b)=>a.lineId.localeCompare(b.lineId))){
          if(d.receivedReturns.find(r=>r.lineId===line.lineId)?.weightKg!==line.returnedKg)fail('الوزن المستلم يختلف؛ أعد التسوية قبل اعتمادها');
          const source=issued.find(l=>l.id===line.lineId);if(!source)fail('مرجع غير صالح');
          const lot=(await db.query('SELECT * FROM yarn_lots WHERE company_id=$1 AND id=$2 FOR UPDATE',[u.companyId,source.yarn_lot_id])).rows[0];
          if(!lot||lot.owner_type!=='COMPANY'||!['AVAILABLE','INACTIVE'].includes(lot.status))fail('لوط المرتجع غير مؤهل أو تغيرت ملكيته');
          if(line.returnedKg>0){await db.query("UPDATE yarn_lots SET weight_kg=weight_kg+$3,status='AVAILABLE',updated_at=now() WHERE company_id=$1 AND id=$2",[u.companyId,lot.id,line.returnedKg]);await db.query(`INSERT INTO yarn_lot_movements(company_id,yarn_lot_id,movement_type,weight_delta_kg,to_warehouse_id,reference_type,reference_id,notes,created_by_user_id) VALUES($1,$2,'MANUFACTURING_RETURN',$3,$4,'WARPING_YARN_ISSUE',$5,$6,$7)`,[u.companyId,lot.id,line.returnedKg,lot.warehouse_id,id,d.reason,u.sub]);}
          await db.query('UPDATE manufacturing_warping_yarn_issue_lines SET consumed_weight_kg=$3,returned_weight_kg=$4,waste_weight_kg=$5,approved_difference_kg=$6 WHERE company_id=$1 AND id=$2',[u.companyId,line.lineId,line.consumedKg,line.returnedKg,line.wasteKg,line.differenceKg]);
        }
        await db.query('UPDATE manufacturing_yarn_settlement_proposals SET approved_by_user_id=$3,approved_at=clock_timestamp(),approval_reason=$4 WHERE company_id=$1 AND issue_id=$2',[u.companyId,id,u.sub,d.reason]);
        await db.query("UPDATE manufacturing_warping_yarn_issues SET status='CLOSED',closed_by_user_id=$3,closed_at=now(),updated_at=now() WHERE company_id=$1 AND id=$2",[u.companyId,id,u.sub]);
      }
      await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'warping_yarn_issue',$4,$5::jsonb)`,[u.companyId,u.sub,action==='propose'?'YARN_SETTLEMENT_PROPOSED':'YARN_SETTLEMENT_APPROVED',id,JSON.stringify({before,input:req.body})]);
      await db.query('COMMIT');return {ok:true};
    }catch(e){await db.query('ROLLBACK');if(e instanceof z.ZodError)return sendError(reply,400,e.issues[0].message,'VALIDATION');if((e as {code?:string}).code==='VALIDATION')return sendError(reply,409,(e as Error).message,'CONFLICT');throw e;}finally{db.release();}
  });
};
