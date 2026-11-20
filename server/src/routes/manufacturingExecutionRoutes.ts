import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {authenticateRequest} from '../middleware/auth.js';
import {sendError} from '../middleware/errorHandler.js';
import {executionStage,executionTables,executionInput,recordExecution,ExecutionError} from '../services/manufacturingExecutionService.js';
const params=z.object({stage:executionStage,id:z.string().uuid()});
export const manufacturingExecutionRoutes:FastifyPluginAsync=async app=>{
 app.addHook('preHandler',authenticateRequest);
 app.addHook('preHandler',async(req,reply)=>{
  const p=params.safeParse(req.params);if(!p.success)return sendError(reply,400,'مرحلة أو معرف غير صالح','VALIDATION');
  const stage=p.data.stage,area=stage==='WARP'?'warping':stage==='SIZED'?'sizing':stage.toLowerCase();
  const u=req.user!,write=req.method==='POST';
  if(u.role!=='admin'&&!u.permissions.includes(`manufacturing.${area}.manage`)&&(write||!u.permissions.includes(`manufacturing.${area}.view`)))return sendError(reply,403,'لا تملك صلاحية التشغيل','FORBIDDEN');
 });
 app.get('/:stage/:id',async(req,reply)=>{
  const {stage,id}=params.parse(req.params),company=req.user!.companyId;
  const subject=(await getPool().query(`SELECT * FROM ${executionTables[stage]} WHERE company_id=$1 AND id=$2`,[company,id])).rows[0];
  if(!subject)return sendError(reply,404,'السجل غير موجود','NOT_FOUND');
  const [history,employees,shifts,machines,reasons,shiftLogs]=await Promise.all([
   getPool().query('SELECT * FROM manufacturing_execution_records WHERE company_id=$1 AND stage=$2 AND subject_id=$3 ORDER BY created_at DESC',[company,stage,id]),
   getPool().query('SELECT id,full_name AS name FROM payroll_employees WHERE company_id=$1 AND is_active ORDER BY full_name',[company]),
   getPool().query('SELECT id,name FROM attendance_shift_types WHERE company_id=$1 ORDER BY name',[company]),
   getPool().query('SELECT id,name,machine_type FROM manufacturing_machines WHERE company_id=$1 AND is_active ORDER BY code',[company]),
   getPool().query('SELECT id,name,stage FROM manufacturing_downtime_reasons WHERE company_id=$1 AND is_active ORDER BY name',[company]),
   getPool().query('SELECT id,production_date,shift_type_id,produced_length_m,downtime_minutes FROM manufacturing_weaving_shift_logs WHERE company_id=$1 AND weaving_run_id=$2 ORDER BY created_at DESC',[company,id]),
  ]);
  return {ok:true,data:{subject,history:history.rows,employees:employees.rows,shifts:shifts.rows,machines:machines.rows,reasons:reasons.rows,shiftLogs:shiftLogs.rows}};
 });
 app.post('/:stage/:id',async(req,reply)=>{
  const p=executionInput.safeParse(req.body);if(!p.success)return sendError(reply,400,p.error.issues[0]?.message??'بيانات غير صالحة','VALIDATION');
  const {stage,id}=params.parse(req.params);
  try{return {ok:true,data:await recordExecution(req.user!.companyId,req.user!.sub,stage,id,p.data)};}catch(e){if(e instanceof ExecutionError)return sendError(reply,e.status,e.message,'EXECUTION_CONFLICT');throw e;}
 });
};
