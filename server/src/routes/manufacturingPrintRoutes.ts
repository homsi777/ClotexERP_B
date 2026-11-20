import type {FastifyPluginAsync, preHandlerHookHandler} from 'fastify';
import type {Pool} from 'pg';
import {z} from 'zod';
import * as XLSX from 'xlsx';
import {getPool} from '../db/pool.js';
import {authenticateRequest} from '../middleware/auth.js';
import {sendError} from '../middleware/errorHandler.js';

/** Read cached values and formulas, without modifying or recalculating the original workbook. */
export function readManufacturingDraft(content: Buffer | null, sheetName?: string) {
  if (!content) return {sheetName:null, cells:[], limitation:'ملف Excel الأصلي غير متاح'};
  const workbook=XLSX.read(Buffer.from(content),{type:'buffer',cellFormula:true,cellHTML:false,bookVBA:false});
  const name=sheetName || workbook.SheetNames.find(n=>n.replace(/\s/g,'')==='التركيبواللقي');
  const sheet=name ? workbook.Sheets[name] : undefined;
  if (!sheet) return {sheetName:name??null,cells:[],limitation:'ورقة التركيب واللقي غير متاحة'};
  const addresses=Object.keys(sheet).filter(k=>/^[A-Z]+[1-9][0-9]*$/.test(k));
  if (addresses.length>20000) throw new Error('ورقة التركيب واللقي تتجاوز حد الطباعة الآمن');
  addresses.sort((a,b)=>{const x=XLSX.utils.decode_cell(a),y=XLSX.utils.decode_cell(b);return x.r-y.r||x.c-y.c;});
  return {sheetName:name,cells:addresses.filter(a=>sheet[a].v!=null||sheet[a].f).map(address=>({address,value:sheet[address].v??null,formula:sheet[address].f??null})),
    limitation:'عرض جدولي للقيم المحفوظة والمعادلات؛ الرسومات والأشكال والتنسيق البصري ليست مستنسخة'};
}

/** Register at /api/manufacturing/print. Injectable dependencies support isolated HTTP tests. */
export function createManufacturingPrintRoutes(deps:{pool?:()=>Pick<Pool,'connect'>;authenticate?:preHandlerHookHandler}={}):FastifyPluginAsync {
  return async app=>{
    app.addHook('preHandler',deps.authenticate??authenticateRequest);
    for(const kind of ['work-orders','warp-beams','sized-beams'] as const){
      app.post('/'+kind+'/:id',async(req,reply)=>{
        const u=req.user;
        if(!u)return sendError(reply,401,'يجب تسجيل الدخول','UNAUTHORIZED');
        const permission=kind==='work-orders'?'manufacturing.work_orders.view':kind==='warp-beams'?'manufacturing.warping.view':'manufacturing.sizing.view';
        if(u.role!=='admin'&&!u.permissions.includes(permission))return sendError(reply,403,'لا تملك صلاحية بيانات الطباعة','FORBIDDEN');
        const parsed=z.object({id:z.string().uuid()}).safeParse(req.params);
        if(!parsed.success)return sendError(reply,400,'معرف غير صالح','VALIDATION');
        const id=parsed.data.id,db=await(deps.pool??getPool)().connect();
        try{
          await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
          let data:Record<string,unknown>;
          if(kind==='work-orders'){
            const result=await db.query(`SELECT w.id,w.work_order_no,w.status,w.priority,w.target_length_m,w.planned_start_date,w.planned_end_date,w.notes,w.version,
              s.code AS specification_code,s.name AS specification_name,v.id AS specification_version_id,v.version_no,v.status AS specification_status,
              v.parsed_data,v.validation_warnings,v.source_file_name,v.source_file_sha256,v.source_file_content
              FROM manufacturing_work_orders w
              JOIN manufacturing_specifications s ON s.company_id=w.company_id AND s.id=w.specification_id
              JOIN manufacturing_specification_versions v ON v.company_id=w.company_id AND v.id=w.specification_version_id AND v.specification_id=w.specification_id
              WHERE w.company_id=$1 AND w.id=$2`,[u.companyId,id]);
            if(!result.rows.length){await db.query('ROLLBACK');return sendError(reply,404,'أمر الإنتاج غير موجود','NOT_FOUND');}
            const {source_file_content,...order}=result.rows[0];
            const allocations=await db.query(`SELECT a.allocated_length_m,a.notes,o.order_no,l.line_no,l.material_name,l.color_name,l.dsam_number
              FROM manufacturing_work_order_allocations a
              JOIN customer_orders o ON o.company_id=a.company_id AND o.id=a.customer_order_id
              JOIN customer_order_lines l ON l.company_id=a.company_id AND l.id=a.customer_order_line_id AND l.order_id=o.id
              WHERE a.company_id=$1 AND a.work_order_id=$2 AND a.is_active ORDER BY o.order_no,l.line_no`,[u.companyId,id]);
            const hasSheets=Array.isArray(order.parsed_data?.sheets)&&order.parsed_data.sheets.length>0;
            data={...order,allocations:allocations.rows,draft:hasSheets?undefined:readManufacturingDraft(source_file_content,order.parsed_data?.resolvedSheets?.weaveDraft)};
          }else{
            const sized=kind==='sized-beams';
            const result=await db.query(`SELECT b.id,b.beam_no,b.barcode,b.length_m,b.status,b.quality_status,b.notes,b.created_at,
              x.warping_order_no,w.work_order_no,s.code AS specification_code,s.name AS specification_name,v.version_no AS specification_version_no,
              ${sized?'b.weight_kg,b.sizing_order_id,b.input_beam_id,so.sizing_order_no,ib.beam_no AS input_beam_no':'x.id AS warping_order_id'}
              FROM ${sized?'manufacturing_sized_beams':'manufacturing_warp_beams'} b
              ${sized?'JOIN manufacturing_warp_beams ib ON ib.company_id=b.company_id AND ib.id=b.input_beam_id JOIN manufacturing_sizing_orders so ON so.company_id=b.company_id AND so.id=b.sizing_order_id':''}
              JOIN manufacturing_warping_orders x ON x.company_id=b.company_id AND x.id=${sized?'ib':'b'}.warping_order_id
              JOIN manufacturing_work_orders w ON w.company_id=x.company_id AND w.id=x.work_order_id
              JOIN manufacturing_specifications s ON s.company_id=w.company_id AND s.id=w.specification_id
              JOIN manufacturing_specification_versions v ON v.company_id=w.company_id AND v.id=w.specification_version_id AND v.specification_id=w.specification_id
              WHERE b.company_id=$1 AND b.id=$2`,[u.companyId,id]);
            if(!result.rows.length){await db.query('ROLLBACK');return sendError(reply,404,'المطواة غير موجودة','NOT_FOUND');}
            data={...result.rows[0],kind:sized?'SIZED':'WARP'};
          }
          const generatedAt=new Date().toISOString();
          await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details)
            VALUES($1,$2,'MANUFACTURING_PRINT_DATA_REQUESTED',$3,$4,$5::jsonb)`,[u.companyId,u.sub,kind,id,
            JSON.stringify({generatedAt,version:data.version??data.specification_version_no??data.version_no,physicalPrintConfirmed:false})]);
          await db.query('COMMIT');
          reply.header('Cache-Control','no-store');
          return {ok:true,data:{...data,generatedAt}};
        }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
      });
    }
  };
}
export const manufacturingPrintRoutes=createManufacturingPrintRoutes();
