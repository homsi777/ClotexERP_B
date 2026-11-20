-- Operational records only. No attendance posting or specification mutation.
CREATE TABLE manufacturing_execution_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 stage text NOT NULL CHECK(stage IN ('WARPING','SIZING','WEAVING','WARP','SIZED')),
 subject_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('DAILY_LOG','HANDOVER','SELVEDGE_OVERRIDE')),
 request_id uuid NOT NULL,
 request_hash text NOT NULL,
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,request_id)
);
CREATE INDEX manufacturing_execution_history ON manufacturing_execution_records(company_id,stage,subject_id,created_at DESC);
CREATE UNIQUE INDEX manufacturing_execution_weaving_shift ON manufacturing_execution_records(company_id,(details->>'shiftLogId')) WHERE stage='WEAVING' AND operation='DAILY_LOG';
ALTER TABLE manufacturing_warping_orders ADD COLUMN selvedge_override jsonb;
ALTER TABLE manufacturing_warp_beams ADD COLUMN custody_employee_id uuid, ADD COLUMN custody_location text;
ALTER TABLE manufacturing_sized_beams ADD COLUMN custody_employee_id uuid, ADD COLUMN custody_location text;
ALTER TABLE manufacturing_warp_beams ADD FOREIGN KEY(company_id,custody_employee_id) REFERENCES payroll_employees(company_id,id);
ALTER TABLE manufacturing_sized_beams ADD FOREIGN KEY(company_id,custody_employee_id) REFERENCES payroll_employees(company_id,id);

-- Composite references keep operational history and workers in the same tenant.
ALTER TABLE manufacturing_execution_records ADD COLUMN warping_order_id uuid, ADD COLUMN sizing_order_id uuid, ADD COLUMN weaving_run_id uuid, ADD COLUMN warp_beam_id uuid, ADD COLUMN sized_beam_id uuid;
ALTER TABLE manufacturing_execution_records ADD FOREIGN KEY(company_id,warping_order_id) REFERENCES manufacturing_warping_orders(company_id,id), ADD FOREIGN KEY(company_id,sizing_order_id) REFERENCES manufacturing_sizing_orders(company_id,id), ADD FOREIGN KEY(company_id,weaving_run_id) REFERENCES manufacturing_weaving_runs(company_id,id), ADD FOREIGN KEY(company_id,warp_beam_id) REFERENCES manufacturing_warp_beams(company_id,id), ADD FOREIGN KEY(company_id,sized_beam_id) REFERENCES manufacturing_sized_beams(company_id,id), ADD UNIQUE(company_id,id);
ALTER TABLE manufacturing_execution_records ADD CHECK (
 (stage='WARPING' AND warping_order_id=subject_id AND sizing_order_id IS NULL AND weaving_run_id IS NULL AND warp_beam_id IS NULL AND sized_beam_id IS NULL AND warping_order_id IS NOT NULL) OR
 (stage='SIZING' AND sizing_order_id=subject_id AND warping_order_id IS NULL AND weaving_run_id IS NULL AND warp_beam_id IS NULL AND sized_beam_id IS NULL AND sizing_order_id IS NOT NULL) OR
 (stage='WEAVING' AND weaving_run_id=subject_id AND warping_order_id IS NULL AND sizing_order_id IS NULL AND warp_beam_id IS NULL AND sized_beam_id IS NULL AND weaving_run_id IS NOT NULL) OR
 (stage='WARP' AND warp_beam_id=subject_id AND warping_order_id IS NULL AND sizing_order_id IS NULL AND weaving_run_id IS NULL AND sized_beam_id IS NULL AND warp_beam_id IS NOT NULL) OR
 (stage='SIZED' AND sized_beam_id=subject_id AND warping_order_id IS NULL AND sizing_order_id IS NULL AND weaving_run_id IS NULL AND warp_beam_id IS NULL AND sized_beam_id IS NOT NULL)
);
CREATE TABLE manufacturing_execution_workers (
 company_id uuid NOT NULL, record_id uuid NOT NULL, employee_id uuid NOT NULL,
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440), PRIMARY KEY(company_id,record_id,employee_id),
 FOREIGN KEY(company_id,record_id) REFERENCES manufacturing_execution_records(company_id,id),
 FOREIGN KEY(company_id,employee_id) REFERENCES payroll_employees(company_id,id)
);
CREATE TABLE manufacturing_execution_downtimes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, record_id uuid NOT NULL, reason_id uuid NOT NULL,
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440), notes text,
 FOREIGN KEY(company_id,record_id) REFERENCES manufacturing_execution_records(company_id,id),
 FOREIGN KEY(company_id,reason_id) REFERENCES manufacturing_downtime_reasons(company_id,id)
);

ALTER TABLE manufacturing_execution_records
 ADD COLUMN shift_type_id uuid, ADD COLUMN machine_id uuid, ADD COLUMN shift_log_id uuid,
 ADD COLUMN sender_employee_id uuid, ADD COLUMN recipient_employee_id uuid,
 ADD FOREIGN KEY(company_id,shift_type_id) REFERENCES attendance_shift_types(company_id,id),
 ADD FOREIGN KEY(company_id,machine_id) REFERENCES manufacturing_machines(company_id,id),
 ADD FOREIGN KEY(company_id,shift_log_id) REFERENCES manufacturing_weaving_shift_logs(company_id,id),
 ADD FOREIGN KEY(company_id,sender_employee_id) REFERENCES payroll_employees(company_id,id),
 ADD FOREIGN KEY(company_id,recipient_employee_id) REFERENCES payroll_employees(company_id,id),
 ADD CHECK ((operation='DAILY_LOG' AND stage IN ('WARPING','SIZING','WEAVING') AND shift_type_id IS NOT NULL AND machine_id IS NOT NULL AND ((stage='WEAVING')=(shift_log_id IS NOT NULL))) OR (operation='HANDOVER' AND stage IN ('WARP','SIZED') AND sender_employee_id IS NOT NULL AND recipient_employee_id IS NOT NULL AND sender_employee_id<>recipient_employee_id) OR (operation='SELVEDGE_OVERRIDE' AND stage='WARPING'));
