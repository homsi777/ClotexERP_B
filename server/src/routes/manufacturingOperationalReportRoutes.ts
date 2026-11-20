import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {sendError} from '../middleware/errorHandler.js';
import type {Pool} from 'pg';
import {authenticateRequest} from '../middleware/auth.js';
import {manufacturingAllStageReport,operationalReportFilters} from '../services/manufacturingOperationalReportService.js';
export function createManufacturingOperationalReportRoutes(pool:()=>Pick<Pool,'query'>=getPool):FastifyPluginAsync{return async(app)=>{
  app.addHook('preHandler',async(req,reply)=>{if(!req.user)await authenticateRequest(req,reply);});
  app.get('/operations-report/stages',async(req,reply)=>{
    const parsed=operationalReportFilters.safeParse(req.query);
    if(!parsed.success)return sendError(reply,400,'فلاتر التقرير غير صالحة','VALIDATION');
    const u=req.user!,q=parsed.data;
    if(u.role!=='admin'&&!u.permissions.includes(`manufacturing.reports.${q.action}`)&&!(q.action==='view'&&u.permissions.includes('reports.view')))
      return sendError(reply,403,'لا تملك صلاحية إجراء التقرير','FORBIDDEN');
    try{
      const data=await manufacturingAllStageReport(pool(),u.companyId,q);
      reply.header('Cache-Control','no-store');
      return {ok:true,data};
    }catch(e){
      if((e as {code?:string}).code==='42P01')return sendError(reply,503,'بنية تقارير التنفيذ غير مكتملة في قاعدة البيانات؛ يلزم تطبيق الترحيلات المعتمدة بواسطة المسؤول','SCHEMA_NOT_READY');
      throw e;
    }
  });
  app.get('/operations-report/options',async(req,reply)=>{
    const u=req.user!;
    if(u.role!=='admin'&&!u.permissions.includes('manufacturing.reports.view')&&!u.permissions.includes('reports.view'))return sendError(reply,403,'لا تملك صلاحية التقارير','FORBIDDEN');
    const [machines,employees,shifts]=await Promise.all([pool().query('SELECT id,code,name FROM manufacturing_machines WHERE company_id=$1 ORDER BY code',[u.companyId]),pool().query('SELECT id,full_name AS name FROM payroll_employees WHERE company_id=$1 ORDER BY full_name',[u.companyId]),pool().query('SELECT id,name FROM attendance_shift_types WHERE company_id=$1 ORDER BY name',[u.companyId])]);
    return {ok:true,data:{machines:machines.rows,employees:employees.rows,shifts:shifts.rows}};
  });
  app.get('/operations-report',async(req,reply)=>{
    const u=req.user!,parsed=z.object({dateFrom:z.string().date().optional(),dateTo:z.string().date().optional(),machineId:z.string().uuid().optional(),employeeId:z.string().uuid().optional(),shiftId:z.string().uuid().optional(),search:z.string().trim().max(160).optional(),action:z.enum(['view','print','export']).default('view')}).safeParse(req.query);
    if(!parsed.success)return sendError(reply,400,'فلاتر التقرير غير صالحة','VALIDATION');
    const q=parsed.data,permission=`manufacturing.reports.${q.action}`;
    if(u.role!=='admin'&&!u.permissions.includes(permission)&&!(q.action==='view'&&u.permissions.includes('reports.view')))return sendError(reply,403,'لا تملك صلاحية إجراء التقرير','FORBIDDEN');
    if(q.dateFrom&&q.dateTo&&q.dateFrom>q.dateTo)return sendError(reply,400,'فترة التقرير غير صالحة','VALIDATION');
    const params:unknown[]=[u.companyId],where=['s.company_id=$1'];
    for(const [value,expression] of [[q.dateFrom,'s.production_date>='],[q.dateTo,'s.production_date<='],[q.machineId,'r.loom_id='],[q.employeeId,'COALESCE(s.operator_employee_id,r.operator_employee_id)='],[q.shiftId,'COALESCE(s.shift_type_id,r.shift_type_id)=']] as const)if(value){params.push(value);where.push(`${expression}$${params.length}`);}
    if(q.search){params.push(`%${q.search}%`);where.push(`(w.work_order_no ILIKE $${params.length} OR spec.code ILIKE $${params.length} OR spec.name ILIKE $${params.length} OR EXISTS(SELECT 1 FROM manufacturing_work_order_allocations a JOIN customer_orders co ON co.id=a.customer_order_id AND co.company_id=a.company_id WHERE a.company_id=w.company_id AND a.work_order_id=w.id AND a.is_active AND co.order_no ILIKE $${params.length}))`);}
    const cte=`WITH detail AS (SELECT s.id,s.production_date::text AS production_date,r.id AS run_id,r.run_no,w.work_order_no,
      spec.code AS specification_code,spec.name AS specification_name,m.code AS machine_code,m.name AS machine_name,e.full_name AS employee_name,sh.name AS shift_name,
      r.planned_length_m::float AS planned_m,r.produced_length_m::float AS run_produced_m,
      s.counter_start::float,s.counter_end::float,s.produced_length_m::float AS produced_m,s.downtime_minutes,reason.name AS downtime_reason,
      b.batch_no,b.status AS quality_status,CASE WHEN b.status IN ('APPROVED','CLOSED') THEN b.clean_length_m ELSE 0 END::float AS clean_m,
      CASE WHEN b.status IN ('APPROVED','CLOSED') THEN b.rejected_length_m ELSE 0 END::float AS rejected_m,
      CASE WHEN b.status IN ('APPROVED','CLOSED') THEN b.rework_length_m ELSE 0 END::float AS rework_m,
      CASE WHEN b.status IN ('APPROVED','CLOSED') THEN b.pending_length_m ELSE s.produced_length_m END::float AS pending_m,
      COALESCE((SELECT SUM(o.length_m) FROM manufacturing_raw_roll_outputs o WHERE o.company_id=b.company_id AND o.production_batch_id=b.id AND o.result_fabric_roll_id IS NOT NULL),0)::float AS received_m,
      (SELECT string_agg(DISTINCT co.order_no,', ') FROM manufacturing_work_order_allocations a JOIN customer_orders co ON co.company_id=a.company_id AND co.id=a.customer_order_id WHERE a.company_id=w.company_id AND a.work_order_id=w.id AND a.is_active) AS customer_orders
      FROM manufacturing_weaving_shift_logs s JOIN manufacturing_weaving_runs r ON r.company_id=s.company_id AND r.id=s.weaving_run_id
      JOIN manufacturing_work_orders w ON w.company_id=r.company_id AND w.id=r.work_order_id
      JOIN manufacturing_specifications spec ON spec.company_id=w.company_id AND spec.id=w.specification_id
      JOIN manufacturing_machines m ON m.company_id=r.company_id AND m.id=r.loom_id
      LEFT JOIN payroll_employees e ON e.company_id=s.company_id AND e.id=COALESCE(s.operator_employee_id,r.operator_employee_id)
      LEFT JOIN attendance_shift_types sh ON sh.company_id=s.company_id AND sh.id=COALESCE(s.shift_type_id,r.shift_type_id)
      LEFT JOIN manufacturing_downtime_reasons reason ON reason.company_id=s.company_id AND reason.id=s.downtime_reason_id
      LEFT JOIN manufacturing_production_batches b ON b.company_id=s.company_id AND b.shift_log_id=s.id
      WHERE ${where.join(' AND ')})`;
    const [rows,summary]=await Promise.all([
      pool().query(`${cte} SELECT * FROM detail ORDER BY production_date DESC,id LIMIT 500`,params),
      pool().query(`${cte} SELECT COUNT(*)::int AS row_count,COALESCE(SUM(produced_m),0)::float AS produced_m,COALESCE(SUM(clean_m),0)::float AS clean_m,COALESCE(SUM(rejected_m),0)::float AS rejected_m,COALESCE(SUM(rework_m),0)::float AS rework_m,COALESCE(SUM(pending_m),0)::float AS pending_m,COALESCE(SUM(received_m),0)::float AS received_m,COALESCE(SUM(downtime_minutes),0)::int AS downtime_minutes,(SELECT COALESCE(SUM(planned_m),0)::float FROM (SELECT run_id,MAX(planned_m) planned_m FROM detail GROUP BY run_id) plans) AS planned_m FROM detail`,params)
    ]);
    return {ok:true,data:{rows:rows.rows,summary:summary.rows[0],truncated:summary.rows[0].row_count>500,runTimeRecorded:false}};
  });
};}
export const manufacturingOperationalReportRoutes=createManufacturingOperationalReportRoutes();
