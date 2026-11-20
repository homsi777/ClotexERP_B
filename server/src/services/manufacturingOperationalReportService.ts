import type {PoolClient} from 'pg';
import {z} from 'zod';

export const operationalReportFilters=z.object({
  stage:z.enum(['ALL','WARPING','SIZING','WEAVING']).default('ALL'),
  dateFrom:z.string().date().optional(),dateTo:z.string().date().optional(),
  machineId:z.string().uuid().optional(),employeeId:z.string().uuid().optional(),shiftId:z.string().uuid().optional(),
  search:z.string().trim().max(160).optional(),action:z.enum(['view','print','export']).default('view'),
}).refine(q=>!q.dateFrom||!q.dateTo||q.dateFrom<=q.dateTo,'فترة التقرير غير صالحة');
export type OperationalReportFilters=z.infer<typeof operationalReportFilters>;

/** One row per stage subject, activity or source issue. Never join workers to downtime/issue rows. */
export function buildOperationalReportQuery(company:string,q:OperationalReportFilters){
  const params:unknown[]=[company,q.dateFrom??null,q.dateTo??null,q.stage,q.machineId??null,q.employeeId??null,q.shiftId??null,q.search?`%${q.search}%`:null];
  const sql=`WITH
  subjects AS (
    SELECT 'WARPING'::text stage,x.id,x.company_id,x.work_order_id,x.warping_order_no operation_no,x.status,
      x.planned_length_m planned_m,x.warping_machine_id machine_id,x.operator_employee_id employee_id,x.shift_type_id shift_id,
      x.created_at,x.started_at,x.completed_at,
      COALESCE((SELECT SUM(b.length_m) FROM manufacturing_warp_beams b WHERE b.company_id=x.company_id AND b.warping_order_id=x.id),0) actual_m
    FROM manufacturing_warping_orders x WHERE x.company_id=$1
    UNION ALL
    SELECT 'SIZING',x.id,x.company_id,w.work_order_id,x.sizing_order_no,x.status,x.planned_length_m,
      x.sizing_machine_id,x.operator_employee_id,x.shift_type_id,x.created_at,x.started_at,x.completed_at,
      COALESCE((SELECT SUM(b.length_m) FROM manufacturing_sized_beams b WHERE b.company_id=x.company_id AND b.sizing_order_id=x.id),0)
    FROM manufacturing_sizing_orders x
    JOIN manufacturing_warp_beams b ON b.company_id=x.company_id AND b.id=x.input_beam_id
    JOIN manufacturing_warping_orders w ON w.company_id=b.company_id AND w.id=b.warping_order_id WHERE x.company_id=$1
    UNION ALL
    SELECT 'WEAVING',x.id,x.company_id,x.work_order_id,x.run_no,x.status,x.planned_length_m,
      x.loom_id,x.operator_employee_id,x.shift_type_id,x.created_at,x.started_at,x.completed_at,x.produced_length_m
    FROM manufacturing_weaving_runs x WHERE x.company_id=$1
  ),
  activities AS (
    SELECT e.id,e.company_id,e.stage,e.subject_id,(e.details->>'productionDate')::date production_date,
      e.created_at recorded_at,e.machine_id,e.shift_type_id shift_id,NULL::uuid operator_employee_id,
      (e.details->>'lengthM')::numeric produced_m,NULL::numeric counter_start,NULL::numeric counter_end,
      (SELECT COALESCE(SUM(d.minutes),0) FROM manufacturing_execution_downtimes d WHERE d.company_id=e.company_id AND d.record_id=e.id) downtime_minutes,
      e.id execution_record_id,NULL::uuid shift_log_id
    FROM manufacturing_execution_records e WHERE e.company_id=$1 AND e.operation='DAILY_LOG' AND e.stage IN ('WARPING','SIZING')
    UNION ALL
    SELECT s.id,s.company_id,'WEAVING',s.weaving_run_id,s.production_date,e.created_at,r.loom_id,
      COALESCE(s.shift_type_id,r.shift_type_id),COALESCE(s.operator_employee_id,r.operator_employee_id),
      s.produced_length_m,s.counter_start,s.counter_end,s.downtime_minutes,e.id,s.id
    FROM manufacturing_weaving_shift_logs s
    JOIN manufacturing_weaving_runs r ON r.company_id=s.company_id AND r.id=s.weaving_run_id
    LEFT JOIN manufacturing_execution_records e ON e.company_id=s.company_id AND e.shift_log_id=s.id AND e.stage='WEAVING' AND e.operation='DAILY_LOG'
    WHERE s.company_id=$1
  ),
  filtered_activities AS (
    SELECT a.* FROM activities a WHERE ($2::date IS NULL OR a.production_date >= $2::date)
    AND ($3::date IS NULL OR a.production_date <= $3::date)
    AND ($5::uuid IS NULL OR a.machine_id=$5) AND ($7::uuid IS NULL OR a.shift_id=$7)
    AND ($6::uuid IS NULL OR a.operator_employee_id=$6 OR EXISTS(
      SELECT 1 FROM manufacturing_execution_workers w WHERE w.company_id=a.company_id AND w.record_id=a.execution_record_id AND w.employee_id=$6))
  ),
  selected AS (
    SELECT s.*,w.work_order_no,spec.code specification_code,spec.name specification_name,m.code machine_code,
      (SELECT string_agg(DISTINCT co.order_no,', ' ORDER BY co.order_no) FROM manufacturing_work_order_allocations al
       JOIN customer_orders co ON co.company_id=al.company_id AND co.id=al.customer_order_id
       WHERE al.company_id=s.company_id AND al.work_order_id=s.work_order_id AND al.is_active) customer_orders
    FROM subjects s
    JOIN manufacturing_work_orders w ON w.company_id=s.company_id AND w.id=s.work_order_id
    JOIN manufacturing_specifications spec ON spec.company_id=w.company_id AND spec.id=w.specification_id
    LEFT JOIN manufacturing_machines m ON m.company_id=s.company_id AND m.id=s.machine_id
    WHERE ($4='ALL' OR s.stage=$4)
      AND (EXISTS(SELECT 1 FROM filtered_activities a WHERE a.company_id=s.company_id AND a.stage=s.stage AND a.subject_id=s.id)
        OR ((($2::date IS NULL OR s.created_at::date >= $2::date) AND ($3::date IS NULL OR s.created_at::date <= $3::date))
          AND ($5::uuid IS NULL OR s.machine_id=$5) AND ($6::uuid IS NULL OR s.employee_id=$6) AND ($7::uuid IS NULL OR s.shift_id=$7)))
      AND ($8::text IS NULL OR w.work_order_no ILIKE $8 OR s.operation_no ILIKE $8 OR spec.code ILIKE $8 OR spec.name ILIKE $8
        OR EXISTS(SELECT 1 FROM manufacturing_work_order_allocations al JOIN customer_orders co ON co.company_id=al.company_id AND co.id=al.customer_order_id
          WHERE al.company_id=s.company_id AND al.work_order_id=s.work_order_id AND al.is_active AND co.order_no ILIKE $8))
  ),
  activity_detail AS (
    SELECT a.id,a.stage,a.subject_id,s.operation_no,s.work_order_no,a.production_date::text,a.recorded_at,a.produced_m,
      a.counter_start,a.counter_end,a.downtime_minutes,m.code machine_code,sh.name shift_name,
      op.full_name operator_name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id',w.employee_id,'name',p.full_name,'minutes',w.minutes) ORDER BY p.full_name,w.employee_id)
        FROM manufacturing_execution_workers w JOIN payroll_employees p ON p.company_id=w.company_id AND p.id=w.employee_id
        WHERE w.company_id=a.company_id AND w.record_id=a.execution_record_id),'[]') workers,
      COALESCE((SELECT SUM(w.minutes) FROM manufacturing_execution_workers w WHERE w.company_id=a.company_id AND w.record_id=a.execution_record_id),0) worker_minutes,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('reason',r.name,'minutes',d.minutes,'notes',d.notes) ORDER BY d.id)
        FROM manufacturing_execution_downtimes d JOIN manufacturing_downtime_reasons r ON r.company_id=d.company_id AND r.id=d.reason_id
        WHERE d.company_id=a.company_id AND d.record_id=a.execution_record_id),'[]') downtimes,
      NULL::numeric runtime_minutes
    FROM filtered_activities a JOIN selected s ON s.company_id=a.company_id AND s.stage=a.stage AND s.id=a.subject_id
    LEFT JOIN manufacturing_machines m ON m.company_id=a.company_id AND m.id=a.machine_id
    LEFT JOIN attendance_shift_types sh ON sh.company_id=a.company_id AND sh.id=a.shift_id
    LEFT JOIN payroll_employees op ON op.company_id=a.company_id AND op.id=a.operator_employee_id
  ),
  activity_totals AS (
    SELECT stage,subject_id,SUM(produced_m) recorded_m,SUM(worker_minutes) worker_minutes,SUM(downtime_minutes) downtime_minutes,
      COUNT(*) activity_count FROM activity_detail GROUP BY stage,subject_id
  ),
  operation_detail AS (
    SELECT s.id,s.stage,s.operation_no,s.work_order_no,s.specification_code,s.specification_name,s.customer_orders,s.machine_code,s.status,
      s.created_at,s.started_at,s.completed_at,s.planned_m,s.actual_m,GREATEST(s.planned_m-s.actual_m,0) remaining_m,
      GREATEST(s.actual_m-s.planned_m,0) overproduction_m,
      CASE WHEN s.stage='WEAVING' THEN 'WEAVING_RUN_TOTAL' ELSE 'PHYSICAL_BEAM_OUTPUTS' END actual_basis,
      COALESCE(a.recorded_m,0) recorded_m,COALESCE(a.worker_minutes,0) worker_minutes,COALESCE(a.downtime_minutes,0) downtime_minutes,
      COALESCE(a.activity_count,0) activity_count,NULL::numeric runtime_minutes
    FROM selected s LEFT JOIN activity_totals a ON a.stage=s.stage AND a.subject_id=s.id
  ),
  source_yarn AS (
    SELECT l.id,'WARPING'::text stage,s.id subject_id,s.operation_no,s.work_order_no,i.issue_no source_no,i.status,
      l.yarn_lot_id,l.requested_weight_kg requested_kg,l.issued_weight_kg issued_kg,l.returned_weight_kg returned_kg,
      l.consumed_weight_kg consumed_kg,l.waste_weight_kg waste_kg,l.approved_difference_kg difference_kg,
      CASE WHEN l.consumed_weight_kg IS NULL THEN 'UNRECORDED' ELSE 'RECORDED' END consumption_basis,
      i.approved_at issued_at,i.closed_at settled_at
    FROM manufacturing_warping_yarn_issue_lines l
    JOIN manufacturing_warping_yarn_issues i ON i.company_id=l.company_id AND i.id=l.issue_id AND i.status IN ('ISSUED','CLOSED')
    JOIN selected s ON s.company_id=i.company_id AND s.id=i.warping_order_id AND s.stage='WARPING' WHERE l.company_id=$1
    UNION ALL
    SELECT e.id,s.stage,s.id,s.operation_no,s.work_order_no,e.id::text,'ISSUED',e.yarn_lot_id,NULL::numeric,e.weight_kg,
      COALESCE(ret.kg,0),CASE WHEN e.consumption_basis='RECORDED' THEN COALESCE(c.consumed_kg,0) ELSE NULL END,
      CASE WHEN e.consumption_basis='RECORDED' THEN COALESCE(c.waste_kg,0) ELSE e.waste_kg END,NULL::numeric,
      e.consumption_basis,e.created_at,NULL::timestamptz
    FROM manufacturing_material_entries e
    JOIN selected s ON s.company_id=e.company_id AND ((s.stage='SIZING' AND s.id=e.sizing_order_id) OR (s.stage='WEAVING' AND s.id=e.weaving_run_id))
    LEFT JOIN LATERAL (SELECT SUM(r.weight_kg) kg FROM manufacturing_material_entries r
      WHERE r.company_id=e.company_id AND r.source_entry_id=e.id AND r.kind='RETURN') ret ON true
    LEFT JOIN LATERAL (SELECT SUM(c.consumed_kg) consumed_kg,SUM(c.waste_kg) waste_kg FROM manufacturing_material_consumptions c
      WHERE c.company_id=e.company_id AND c.source_entry_id=e.id) c ON true
    WHERE e.company_id=$1 AND e.kind='ISSUE'
  ),
  yarn_detail AS (
    SELECT y.*,l.lot_no,l.barcode lot_barcode,f.name item_name,color.name_ar color_name,
      y.issued_kg-y.returned_kg net_issued_kg,
      CASE WHEN y.consumed_kg IS NOT NULL THEN y.issued_kg-y.returned_kg-y.consumed_kg-y.waste_kg-COALESCE(y.difference_kg,0) ELSE NULL END custody_kg
    FROM source_yarn y JOIN yarn_lots l ON l.company_id=$1 AND l.id=y.yarn_lot_id
    LEFT JOIN fabric_items f ON f.company_id=l.company_id AND f.id=l.item_id
    LEFT JOIN fabric_colors color ON color.company_id=l.company_id AND color.id=l.color_id
  )
  SELECT jsonb_build_object(
    'rows',COALESCE((SELECT jsonb_agg(r ORDER BY r.stage,r.operation_no,r.id) FROM (SELECT * FROM operation_detail ORDER BY stage,operation_no,id LIMIT 500) r),'[]'),
    'activities',COALESCE((SELECT jsonb_agg(r ORDER BY r.production_date DESC,r.id) FROM (SELECT * FROM activity_detail ORDER BY production_date DESC,id LIMIT 500) r),'[]'),
    'yarn',COALESCE((SELECT jsonb_agg(r ORDER BY r.stage,r.operation_no,r.id) FROM (SELECT * FROM yarn_detail ORDER BY stage,operation_no,id LIMIT 500) r),'[]'),
    'stageSummary',COALESCE((SELECT jsonb_agg(r ORDER BY r.stage) FROM (SELECT stage,COUNT(*) count,SUM(planned_m) planned_m,SUM(actual_m) actual_m,
      SUM(remaining_m) remaining_m,SUM(overproduction_m) overproduction_m,SUM(recorded_m) recorded_m,SUM(worker_minutes) worker_minutes,SUM(downtime_minutes) downtime_minutes FROM operation_detail GROUP BY stage) r),'[]'),
    'yarnSummary',COALESCE((SELECT jsonb_agg(r ORDER BY r.stage) FROM (SELECT stage,COUNT(*) count,SUM(issued_kg) issued_kg,SUM(returned_kg) returned_kg,
      SUM(net_issued_kg) net_issued_kg,SUM(consumed_kg) consumed_kg,SUM(waste_kg) waste_kg,SUM(difference_kg) difference_kg,SUM(custody_kg) custody_kg,
      COUNT(*) FILTER(WHERE consumed_kg IS NULL) unrecorded_count FROM yarn_detail GROUP BY stage) r),'[]'),
    'counts',jsonb_build_object('rows',(SELECT COUNT(*) FROM operation_detail),'activities',(SELECT COUNT(*) FROM activity_detail),'yarn',(SELECT COUNT(*) FROM yarn_detail)),
    'runtimeRecorded',false,'generatedAt',CURRENT_TIMESTAMP
  ) report`;
  return {sql,params};
}

export async function manufacturingAllStageReport(db:Pick<PoolClient,'query'>,company:string,q:OperationalReportFilters){
  const {sql,params}=buildOperationalReportQuery(company,q);
  return (await db.query(sql,params)).rows[0].report;
}
