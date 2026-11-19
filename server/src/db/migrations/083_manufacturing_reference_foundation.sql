-- Manufacturing reference foundation: departments, machines, maintenance,
-- downtime reasons and quality defects. Additive only; no legacy data changes.

INSERT INTO permissions (code, name, category) VALUES
  ('manufacturing.dashboard.view', 'عرض لوحة التصنيع', 'manufacturing'),
  ('manufacturing.reference.view', 'عرض تعريفات التصنيع', 'manufacturing'),
  ('manufacturing.reference.manage', 'إدارة تعريفات التصنيع', 'manufacturing'),
  ('manufacturing.specifications.view', 'عرض مكتبة مواصفات التصنيع', 'manufacturing'),
  ('manufacturing.specifications.import', 'استيراد إصدارات مواصفات التصنيع', 'manufacturing'),
  ('manufacturing.specifications.approve', 'اعتماد إصدارات مواصفات التصنيع', 'manufacturing'),
  ('manufacturing.work_orders.view', 'عرض أوامر إنتاج التصنيع', 'manufacturing'),
  ('manufacturing.work_orders.manage', 'إنشاء وتعديل أوامر إنتاج التصنيع', 'manufacturing'),
  ('manufacturing.work_orders.release', 'إصدار أوامر إنتاج التصنيع', 'manufacturing'),
  ('manufacturing.warping.view', 'عرض أوامر التسدية وكروتها', 'manufacturing'),
  ('manufacturing.warping.manage', 'إدارة وتنفيذ أوامر التسدية', 'manufacturing'),
  ('manufacturing.warping.quality', 'فحص واعتماد المطاوي', 'manufacturing'),
  ('manufacturing.yarn_issue.approve', 'اعتماد وصرف الخيط لأوامر التسدية', 'manufacturing'),
  ('manufacturing.sizing.view', 'عرض أوامر التصميغ والمطاوي', 'manufacturing'),
  ('manufacturing.sizing.manage', 'إدارة وتنفيذ أوامر التصميغ', 'manufacturing'),
  ('manufacturing.weaving.view', 'عرض تشغيل وإنتاج النسج', 'manufacturing'),
  ('manufacturing.weaving.manage', 'إدارة تشغيل وإنتاج النسج', 'manufacturing'),
  ('manufacturing.raw_inspection.manage', 'فحص واعتماد رولات القماش الخام', 'manufacturing'),
  ('manufacturing.machines.manage', 'إدارة الماكينات', 'manufacturing'),
  ('manufacturing.maintenance.manage', 'إدارة أعطال وصيانة الماكينات', 'manufacturing'),
  ('manufacturing.quality.catalog.manage', 'إدارة مكتبة عيوب الجودة', 'manufacturing')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'manufacturing.dashboard.view',
  'manufacturing.reference.view',
  'manufacturing.reference.manage',
  'manufacturing.specifications.view',
  'manufacturing.specifications.import',
  'manufacturing.specifications.approve',
  'manufacturing.work_orders.view',
  'manufacturing.work_orders.manage',
  'manufacturing.work_orders.release',
  'manufacturing.warping.view',
  'manufacturing.warping.manage',
  'manufacturing.warping.quality',
  'manufacturing.yarn_issue.approve',
  'manufacturing.sizing.view',
  'manufacturing.sizing.manage',
  'manufacturing.weaving.view',
  'manufacturing.weaving.manage',
  'manufacturing.raw_inspection.manage',
  'manufacturing.machines.manage',
  'manufacturing.maintenance.manage',
  'manufacturing.quality.catalog.manage'
)
WHERE r.code='admin'
ON CONFLICT DO NOTHING;

CREATE TABLE manufacturing_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_specifications_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT manufacturing_specifications_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT manufacturing_specifications_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT manufacturing_specifications_company_identity UNIQUE (company_id, id)
);

CREATE INDEX manufacturing_specifications_company_active
  ON manufacturing_specifications(company_id, is_active, code);

CREATE TABLE manufacturing_specification_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  specification_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','ARCHIVED')),
  source_file_name text NOT NULL,
  source_file_content bytea NOT NULL,
  source_file_size integer NOT NULL CHECK (source_file_size > 0 AND source_file_size <= 4194304),
  source_file_sha256 text NOT NULL CHECK (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  parsed_data jsonb NOT NULL CHECK (jsonb_typeof(parsed_data) = 'object'),
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_warnings) = 'array'),
  notes text,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  archived_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_specification_versions_specification_fk
    FOREIGN KEY (company_id, specification_id)
    REFERENCES manufacturing_specifications(company_id, id) ON DELETE CASCADE,
  CONSTRAINT manufacturing_specification_versions_number_unique UNIQUE (company_id, specification_id, version_no),
  CONSTRAINT manufacturing_specification_versions_company_identity UNIQUE (company_id, specification_id, id),
  CONSTRAINT manufacturing_specification_versions_approval_consistency CHECK (
    (status = 'APPROVED' AND approved_at IS NOT NULL)
    OR (status <> 'APPROVED')
  )
);

CREATE UNIQUE INDEX manufacturing_specification_versions_one_approved
  ON manufacturing_specification_versions(company_id, specification_id)
  WHERE status = 'APPROVED';
CREATE INDEX manufacturing_specification_versions_history
  ON manufacturing_specification_versions(company_id, specification_id, version_no DESC);
CREATE INDEX manufacturing_specification_versions_sha
  ON manufacturing_specification_versions(company_id, source_file_sha256);

ALTER TABLE customer_orders
  ADD CONSTRAINT customer_orders_company_identity UNIQUE (company_id, id);
ALTER TABLE customer_order_lines
  ADD CONSTRAINT customer_order_lines_company_order_identity UNIQUE (company_id, order_id, id);

CREATE TABLE manufacturing_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  work_order_no text NOT NULL,
  specification_id uuid NOT NULL,
  specification_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  target_length_m numeric(14,3) NOT NULL CHECK (target_length_m > 0),
  planned_start_date date,
  planned_end_date date,
  specification_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(specification_snapshot) = 'object'),
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  released_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  released_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_work_orders_company_no_unique UNIQUE (company_id, work_order_no),
  CONSTRAINT manufacturing_work_orders_company_identity UNIQUE (company_id, id),
  CONSTRAINT manufacturing_work_orders_specification_version_fk
    FOREIGN KEY (company_id, specification_id, specification_version_id)
    REFERENCES manufacturing_specification_versions(company_id, specification_id, id) ON DELETE RESTRICT,
  CONSTRAINT manufacturing_work_orders_dates_check CHECK (
    planned_start_date IS NULL OR planned_end_date IS NULL OR planned_end_date >= planned_start_date
  ),
  CONSTRAINT manufacturing_work_orders_release_consistency CHECK (
    status = 'DRAFT' OR status = 'CANCELLED' OR released_at IS NOT NULL
  ),
  CONSTRAINT manufacturing_work_orders_cancel_consistency CHECK (
    status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(trim(COALESCE(cancellation_reason,''))) > 0)
  )
);

CREATE INDEX manufacturing_work_orders_company_status
  ON manufacturing_work_orders(company_id, status, planned_start_date);
CREATE INDEX manufacturing_work_orders_specification
  ON manufacturing_work_orders(company_id, specification_id, specification_version_id);

CREATE TABLE manufacturing_work_order_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL,
  customer_order_id uuid NOT NULL,
  customer_order_line_id uuid NOT NULL,
  allocated_length_m numeric(14,3) NOT NULL CHECK (allocated_length_m > 0),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_work_order_allocations_work_order_fk
    FOREIGN KEY (company_id, work_order_id)
    REFERENCES manufacturing_work_orders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT manufacturing_work_order_allocations_customer_line_fk
    FOREIGN KEY (company_id, customer_order_id, customer_order_line_id)
    REFERENCES customer_order_lines(company_id, order_id, id) ON DELETE RESTRICT
);

CREATE INDEX manufacturing_work_order_allocations_customer_order
  ON manufacturing_work_order_allocations(company_id, customer_order_id, customer_order_line_id);
CREATE UNIQUE INDEX manufacturing_work_order_allocations_active_line_unique
  ON manufacturing_work_order_allocations(company_id, work_order_id, customer_order_line_id)
  WHERE is_active;

CREATE TABLE manufacturing_work_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','UPDATED','RELEASED','STARTED','COMPLETED','CANCELLED')),
  old_status text CHECK (old_status IS NULL OR old_status IN ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED')),
  new_status text NOT NULL CHECK (new_status IN ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_work_order_events_order_fk
    FOREIGN KEY (company_id, work_order_id)
    REFERENCES manufacturing_work_orders(company_id, id) ON DELETE CASCADE
);

CREATE INDEX manufacturing_work_order_events_history
  ON manufacturing_work_order_events(company_id, work_order_id, created_at DESC);

ALTER TABLE payroll_employees
  ADD CONSTRAINT payroll_employees_company_identity UNIQUE (company_id, id);
ALTER TABLE attendance_shift_types
  ADD CONSTRAINT attendance_shift_types_company_identity UNIQUE (company_id, id);
ALTER TABLE yarn_lots
  ADD CONSTRAINT yarn_lots_company_identity UNIQUE (company_id, id);

CREATE TABLE manufacturing_warping_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warping_order_no text NOT NULL,
  work_order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
  planned_length_m numeric(14,3) NOT NULL CHECK (planned_length_m > 0),
  actual_length_m numeric(14,3) CHECK (actual_length_m IS NULL OR actual_length_m >= 0),
  warping_machine_id uuid,
  target_loom_id uuid,
  operator_employee_id uuid,
  shift_type_id uuid,
  tie_count integer CHECK (tie_count IS NULL OR tie_count >= 0),
  beam_no text,
  beam_barcode text,
  quality_status text NOT NULL DEFAULT 'PENDING' CHECK (quality_status IN ('PENDING','ACCEPTED','CONDITIONAL','REJECTED')),
  quality_notes text,
  specification_snapshot jsonb NOT NULL CHECK (jsonb_typeof(specification_snapshot) = 'object'),
  execution_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(execution_snapshot) = 'object'),
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  released_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  released_at timestamptz,
  started_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_warping_orders_company_no_unique UNIQUE (company_id, warping_order_no),
  CONSTRAINT manufacturing_warping_orders_company_identity UNIQUE (company_id, id),
  CONSTRAINT manufacturing_warping_orders_work_order_fk
    FOREIGN KEY (company_id, work_order_id)
    REFERENCES manufacturing_work_orders(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT manufacturing_warping_orders_employee_fk
    FOREIGN KEY (company_id, operator_employee_id)
    REFERENCES payroll_employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT manufacturing_warping_orders_shift_fk
    FOREIGN KEY (company_id, shift_type_id)
    REFERENCES attendance_shift_types(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT manufacturing_warping_orders_cancel_consistency CHECK (
    status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(trim(COALESCE(cancellation_reason,''))) > 0)
  )
);

CREATE INDEX manufacturing_warping_orders_company_status
  ON manufacturing_warping_orders(company_id, status, created_at DESC);
CREATE INDEX manufacturing_warping_orders_work_order
  ON manufacturing_warping_orders(company_id, work_order_id);
-- A machine may legitimately serve more than one active order when the warp is
-- shared. Keep this as a lookup index, never as a uniqueness constraint.
CREATE INDEX manufacturing_warping_orders_active_machine
  ON manufacturing_warping_orders(company_id, warping_machine_id)
  WHERE warping_machine_id IS NOT NULL AND status IN ('RELEASED','IN_PROGRESS');
CREATE UNIQUE INDEX manufacturing_warping_orders_beam_barcode_unique
  ON manufacturing_warping_orders(company_id, beam_barcode)
  WHERE beam_barcode IS NOT NULL;

CREATE TABLE manufacturing_warp_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warping_order_id uuid NOT NULL,
  card_no text NOT NULL,
  card_version integer NOT NULL DEFAULT 1 CHECK (card_version > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REPLACED','VOID')),
  barcode text NOT NULL,
  card_data jsonb NOT NULL CHECK (jsonb_typeof(card_data) = 'object'),
  print_count integer NOT NULL DEFAULT 0 CHECK (print_count >= 0),
  replaced_by_card_id uuid REFERENCES manufacturing_warp_cards(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_warp_cards_company_no_unique UNIQUE (company_id, card_no),
  CONSTRAINT manufacturing_warp_cards_company_barcode_unique UNIQUE (company_id, barcode),
  CONSTRAINT manufacturing_warp_cards_order_version_unique UNIQUE (company_id, warping_order_id, card_version),
  CONSTRAINT manufacturing_warp_cards_order_fk
    FOREIGN KEY (company_id, warping_order_id)
    REFERENCES manufacturing_warping_orders(company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX manufacturing_warp_cards_one_active
  ON manufacturing_warp_cards(company_id, warping_order_id)
  WHERE status='ACTIVE';

CREATE TABLE manufacturing_warping_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warping_order_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','UPDATED','RELEASED','STARTED','QUALITY_COMPLETED','CANCELLED','CARD_PRINTED')),
  old_status text CHECK (old_status IS NULL OR old_status IN ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
  new_status text NOT NULL CHECK (new_status IN ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_warping_order_events_order_fk FOREIGN KEY (company_id, warping_order_id)
    REFERENCES manufacturing_warping_orders(company_id, id) ON DELETE CASCADE
);
CREATE INDEX manufacturing_warping_order_events_history
  ON manufacturing_warping_order_events(company_id, warping_order_id, created_at DESC);

CREATE TABLE manufacturing_warp_beams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warping_order_id uuid NOT NULL, beam_no text NOT NULL, barcode text NOT NULL,
  length_m numeric(14,3) NOT NULL CHECK(length_m>=0),
  status text NOT NULL CHECK(status IN ('READY_FOR_SIZING','READY_FOR_WEAVING','IN_SIZING','IN_WEAVING','REJECTED','CONSUMED')),
  quality_status text NOT NULL CHECK(quality_status IN ('ACCEPTED','CONDITIONAL','REJECTED')),
  notes text, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,beam_no), UNIQUE(company_id,barcode), UNIQUE(company_id,id),
  FOREIGN KEY(company_id,warping_order_id) REFERENCES manufacturing_warping_orders(company_id,id) ON DELETE RESTRICT
);
CREATE INDEX manufacturing_warp_beams_status ON manufacturing_warp_beams(company_id,status,created_at DESC);

CREATE TABLE manufacturing_sizing_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 sizing_order_no text NOT NULL, input_beam_id uuid NOT NULL, sizing_machine_id uuid, operator_employee_id uuid, shift_type_id uuid,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
 recipe jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(recipe)='object'), planned_length_m numeric(14,3) NOT NULL CHECK(planned_length_m>0),
 actual_length_m numeric(14,3), input_weight_kg numeric(12,3), output_weight_kg numeric(12,3), waste_weight_kg numeric(12,3),
 moisture_percent numeric(7,3), stretch_percent numeric(7,3), quality_status text NOT NULL DEFAULT 'PENDING' CHECK(quality_status IN ('PENDING','ACCEPTED','CONDITIONAL','REJECTED')),
 quality_notes text, notes text, version integer NOT NULL DEFAULT 1, started_at timestamptz, completed_at timestamptz,
 created_by_user_id uuid REFERENCES users(id), updated_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,sizing_order_no), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,input_beam_id) REFERENCES manufacturing_warp_beams(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,operator_employee_id) REFERENCES payroll_employees(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,shift_type_id) REFERENCES attendance_shift_types(company_id,id) ON DELETE RESTRICT
);
CREATE INDEX manufacturing_sizing_orders_status ON manufacturing_sizing_orders(company_id,status,created_at DESC);

CREATE TABLE manufacturing_sized_beams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 sizing_order_id uuid NOT NULL, input_beam_id uuid NOT NULL, beam_no text NOT NULL, barcode text NOT NULL,
 length_m numeric(14,3) NOT NULL CHECK(length_m>=0), weight_kg numeric(12,3), status text NOT NULL DEFAULT 'READY_FOR_WEAVING' CHECK(status IN ('READY_FOR_WEAVING','IN_WEAVING','REJECTED','CONSUMED')),
 quality_status text NOT NULL CHECK(quality_status IN ('ACCEPTED','CONDITIONAL','REJECTED')), notes text, created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,beam_no),UNIQUE(company_id,barcode),UNIQUE(company_id,id),
 FOREIGN KEY(company_id,sizing_order_id) REFERENCES manufacturing_sizing_orders(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,input_beam_id) REFERENCES manufacturing_warp_beams(company_id,id) ON DELETE RESTRICT
);

CREATE TABLE manufacturing_sizing_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,sizing_order_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('CREATED','STARTED','COMPLETED','REJECTED','CANCELLED')),details jsonb NOT NULL DEFAULT '{}',created_by_user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,sizing_order_id) REFERENCES manufacturing_sizing_orders(company_id,id) ON DELETE CASCADE
);

CREATE TABLE manufacturing_weaving_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,run_no text NOT NULL,
 work_order_id uuid NOT NULL,warp_beam_id uuid,sized_beam_id uuid,loom_id uuid NOT NULL,operator_employee_id uuid,shift_type_id uuid,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED')),
 planned_length_m numeric(14,3) NOT NULL CHECK(planned_length_m>0),produced_length_m numeric(14,3) NOT NULL DEFAULT 0 CHECK(produced_length_m>=0),
 opening_counter numeric(16,3),current_counter numeric(16,3),notes text,version integer NOT NULL DEFAULT 1,started_at timestamptz,completed_at timestamptz,
 created_by_user_id uuid REFERENCES users(id),updated_by_user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,run_no),UNIQUE(company_id,id),CHECK((warp_beam_id IS NOT NULL)::int+(sized_beam_id IS NOT NULL)::int=1),
 FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_work_orders(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,warp_beam_id) REFERENCES manufacturing_warp_beams(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,sized_beam_id) REFERENCES manufacturing_sized_beams(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,operator_employee_id) REFERENCES payroll_employees(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,shift_type_id) REFERENCES attendance_shift_types(company_id,id) ON DELETE RESTRICT
);
CREATE INDEX manufacturing_weaving_runs_status ON manufacturing_weaving_runs(company_id,status,created_at DESC);

CREATE TABLE manufacturing_weaving_shift_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,weaving_run_id uuid NOT NULL,
 operator_employee_id uuid,shift_type_id uuid,production_date date NOT NULL,counter_start numeric(16,3) NOT NULL,counter_end numeric(16,3) NOT NULL,
 produced_length_m numeric(14,3) NOT NULL CHECK(produced_length_m>=0),downtime_minutes integer NOT NULL DEFAULT 0 CHECK(downtime_minutes>=0),
 downtime_reason_id uuid,notes text,created_by_user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,weaving_run_id) REFERENCES manufacturing_weaving_runs(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,operator_employee_id) REFERENCES payroll_employees(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,shift_type_id) REFERENCES attendance_shift_types(company_id,id) ON DELETE RESTRICT
);

CREATE TABLE manufacturing_raw_roll_outputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,weaving_run_id uuid NOT NULL,
 production_batch_no text NOT NULL,roll_no text NOT NULL,production_barcode text NOT NULL,length_m numeric(14,3) NOT NULL CHECK(length_m>0),width_cm numeric(14,2),actual_weight_kg numeric(14,3),gsm numeric(14,2),
 inspection_status text NOT NULL DEFAULT 'PENDING' CHECK(inspection_status IN ('PENDING','ACCEPTED','CONDITIONAL','REJECTED')),
 grade text,inspection_notes text,result_fabric_roll_id uuid REFERENCES fabric_rolls(id),inspected_by_user_id uuid REFERENCES users(id),inspected_at timestamptz,
 created_by_user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,production_barcode),UNIQUE(company_id,weaving_run_id,roll_no),UNIQUE(company_id,id),
 FOREIGN KEY(company_id,weaving_run_id) REFERENCES manufacturing_weaving_runs(company_id,id) ON DELETE RESTRICT
);
CREATE INDEX manufacturing_raw_roll_outputs_status ON manufacturing_raw_roll_outputs(company_id,inspection_status,created_at DESC);

CREATE TABLE manufacturing_raw_roll_defects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,raw_roll_output_id uuid NOT NULL,defect_id uuid NOT NULL,
 position_m numeric(14,3),quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0),severity text CHECK(severity IN ('MINOR','MAJOR','CRITICAL')),notes text,created_by_user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,raw_roll_output_id) REFERENCES manufacturing_raw_roll_outputs(company_id,id) ON DELETE CASCADE
);

CREATE TABLE manufacturing_warping_yarn_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warping_order_id uuid NOT NULL, issue_no text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REQUESTED','ISSUED','CLOSED','CANCELLED')),
  notes text, requested_by_user_id uuid REFERENCES users(id), requested_at timestamptz,
  approved_by_user_id uuid REFERENCES users(id), approved_at timestamptz,
  closed_by_user_id uuid REFERENCES users(id), closed_at timestamptz,
  created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,issue_no), UNIQUE(company_id,id),
  FOREIGN KEY(company_id,warping_order_id) REFERENCES manufacturing_warping_orders(company_id,id) ON DELETE RESTRICT
);
CREATE INDEX manufacturing_warping_yarn_issues_order ON manufacturing_warping_yarn_issues(company_id,warping_order_id,created_at DESC);

CREATE TABLE manufacturing_warping_yarn_issue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL, yarn_lot_id uuid NOT NULL,
  requested_weight_kg numeric(12,3) NOT NULL CHECK(requested_weight_kg>0),
  issued_weight_kg numeric(12,3) NOT NULL DEFAULT 0 CHECK(issued_weight_kg>=0),
  returned_weight_kg numeric(12,3) NOT NULL DEFAULT 0 CHECK(returned_weight_kg>=0),
  waste_weight_kg numeric(12,3) NOT NULL DEFAULT 0 CHECK(waste_weight_kg>=0),
  notes text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,issue_id,yarn_lot_id),
  FOREIGN KEY(company_id,issue_id) REFERENCES manufacturing_warping_yarn_issues(company_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id,yarn_lot_id) REFERENCES yarn_lots(company_id,id) ON DELETE RESTRICT,
  CHECK(returned_weight_kg+waste_weight_kg<=issued_weight_kg)
);

CREATE TABLE manufacturing_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_departments_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT manufacturing_departments_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT manufacturing_departments_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT manufacturing_departments_company_identity UNIQUE (company_id, id)
);

CREATE INDEX manufacturing_departments_company_active
  ON manufacturing_departments(company_id, is_active, name);

CREATE TABLE manufacturing_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  department_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  machine_type text NOT NULL CHECK (machine_type IN ('WARPING','SIZING','LOOM','PROCESSING','INSPECTION','OTHER')),
  width_cm numeric(14,2) CHECK (width_cm IS NULL OR width_cm > 0),
  fixed_location text,
  manufacturer text,
  model text,
  serial_number text,
  manufacture_year integer CHECK (manufacture_year IS NULL OR manufacture_year BETWEEN 1800 AND 2100),
  power_kw numeric(14,3) CHECK (power_kw IS NULL OR power_kw > 0),
  rated_speed numeric(14,3) CHECK (rated_speed IS NULL OR rated_speed > 0),
  rated_speed_unit text CHECK (rated_speed_unit IS NULL OR rated_speed_unit IN ('RPM','PICKS_PER_MINUTE','METERS_PER_MINUTE','OTHER')),
  technical_specs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(technical_specs) = 'object'),
  asset_value numeric(18,2) CHECK (asset_value IS NULL OR asset_value >= 0),
  asset_currency_code text REFERENCES currencies(code),
  ownership_type text NOT NULL DEFAULT 'COMPANY' CHECK (ownership_type IN ('COMPANY','CUSTODY')),
  owner_name text,
  operational_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (operational_status IN ('ACTIVE','STOPPED','MAINTENANCE','OUT_OF_SERVICE')),
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_machines_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT manufacturing_machines_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT manufacturing_machines_custody_owner CHECK (
    ownership_type <> 'CUSTODY' OR length(trim(COALESCE(owner_name,''))) > 0
  ),
  CONSTRAINT manufacturing_machines_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT manufacturing_machines_company_identity UNIQUE (company_id, id),
  CONSTRAINT manufacturing_machines_department_fk
    FOREIGN KEY (company_id, department_id)
    REFERENCES manufacturing_departments(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX manufacturing_machines_company_status
  ON manufacturing_machines(company_id, operational_status, is_active);
CREATE INDEX manufacturing_machines_department
  ON manufacturing_machines(company_id, department_id);
CREATE INDEX manufacturing_machines_type
  ON manufacturing_machines(company_id, machine_type);
CREATE UNIQUE INDEX manufacturing_machines_company_serial_unique
  ON manufacturing_machines(company_id, lower(trim(serial_number)))
  WHERE serial_number IS NOT NULL AND length(trim(serial_number)) > 0;

-- Warping tables are declared earlier beside work orders. Add machine links only
-- after the machine reference table exists so a clean migration can run.
ALTER TABLE manufacturing_warping_orders
  ADD CONSTRAINT manufacturing_warping_orders_machine_fk
    FOREIGN KEY (company_id, warping_machine_id)
    REFERENCES manufacturing_machines(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT manufacturing_warping_orders_loom_fk
    FOREIGN KEY (company_id, target_loom_id)
    REFERENCES manufacturing_machines(company_id, id) ON DELETE RESTRICT;
ALTER TABLE manufacturing_sizing_orders ADD CONSTRAINT manufacturing_sizing_orders_machine_fk FOREIGN KEY(company_id,sizing_machine_id) REFERENCES manufacturing_machines(company_id,id) ON DELETE RESTRICT;
ALTER TABLE manufacturing_weaving_runs ADD CONSTRAINT manufacturing_weaving_runs_loom_fk FOREIGN KEY(company_id,loom_id) REFERENCES manufacturing_machines(company_id,id) ON DELETE RESTRICT;

CREATE TABLE manufacturing_machine_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL,
  old_status text NOT NULL CHECK (old_status IN ('ACTIVE','STOPPED','MAINTENANCE','OUT_OF_SERVICE')),
  new_status text NOT NULL CHECK (new_status IN ('ACTIVE','STOPPED','MAINTENANCE','OUT_OF_SERVICE')),
  reason text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_machine_status_events_machine_fk
    FOREIGN KEY (company_id, machine_id)
    REFERENCES manufacturing_machines(company_id, id) ON DELETE CASCADE,
  CONSTRAINT manufacturing_machine_status_changed CHECK (old_status <> new_status),
  CONSTRAINT manufacturing_machine_status_reason CHECK (length(trim(reason)) > 0)
);

CREATE INDEX manufacturing_machine_status_events_history
  ON manufacturing_machine_status_events(company_id, machine_id, created_at DESC);

CREATE TABLE manufacturing_machine_maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('BREAKDOWN','PREVENTIVE','CORRECTIVE','INSPECTION')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  occurred_at timestamptz NOT NULL,
  completed_at timestamptz,
  description text NOT NULL,
  resolution text,
  cost_amount numeric(18,2) CHECK (cost_amount IS NULL OR cost_amount >= 0),
  cost_currency_code text REFERENCES currencies(code),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_machine_maintenance_machine_fk
    FOREIGN KEY (company_id, machine_id)
    REFERENCES manufacturing_machines(company_id, id) ON DELETE CASCADE,
  CONSTRAINT manufacturing_machine_maintenance_description CHECK (length(trim(description)) > 0),
  CONSTRAINT manufacturing_machine_maintenance_completed_at CHECK (
    completed_at IS NULL OR completed_at >= occurred_at
  ),
  CONSTRAINT manufacturing_machine_maintenance_completion CHECK (
    status <> 'COMPLETED' OR completed_at IS NOT NULL
  )
);

CREATE INDEX manufacturing_machine_maintenance_history
  ON manufacturing_machine_maintenance_events(company_id, machine_id, occurred_at DESC);
CREATE INDEX manufacturing_machine_maintenance_open
  ON manufacturing_machine_maintenance_events(company_id, status, occurred_at DESC)
  WHERE status IN ('OPEN','IN_PROGRESS');

CREATE TABLE manufacturing_downtime_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'ALL'
    CHECK (stage IN ('ALL','WARPING','SIZING','WEAVING','PROCESSING','INSPECTION')),
  is_planned boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_downtime_reason_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT manufacturing_downtime_reason_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT manufacturing_downtime_reason_company_code_unique UNIQUE (company_id, code)
);

CREATE INDEX manufacturing_downtime_reasons_lookup
  ON manufacturing_downtime_reasons(company_id, stage, is_active, name);

ALTER TABLE manufacturing_weaving_shift_logs ADD CONSTRAINT manufacturing_weaving_shift_logs_downtime_fk FOREIGN KEY(company_id,downtime_reason_id) REFERENCES manufacturing_downtime_reasons(company_id,id) ON DELETE RESTRICT;

CREATE TABLE manufacturing_quality_defect_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  inspection_type text NOT NULL DEFAULT 'ALL'
    CHECK (inspection_type IN ('ALL','WARP_BEAM','SIZED_BEAM','RAW_FABRIC','FINISHED_FABRIC')),
  default_severity text CHECK (default_severity IS NULL OR default_severity IN ('MINOR','MAJOR','CRITICAL')),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_quality_defect_code_not_blank CHECK (length(trim(code)) > 0),
  CONSTRAINT manufacturing_quality_defect_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT manufacturing_quality_defect_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT manufacturing_quality_defect_company_identity UNIQUE (company_id, id)
);

CREATE INDEX manufacturing_quality_defect_lookup
  ON manufacturing_quality_defect_catalog(company_id, inspection_type, is_active, name);
ALTER TABLE manufacturing_raw_roll_defects ADD CONSTRAINT manufacturing_raw_roll_defects_catalog_fk FOREIGN KEY(company_id,defect_id) REFERENCES manufacturing_quality_defect_catalog(company_id,id) ON DELETE RESTRICT;

-- Preserve every movement type introduced by earlier migrations, including CUT.
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN (
  'OPENING','PURCHASE_RECEIPT','MANUAL_CREATE','TRANSFER_OUT','TRANSFER_IN','RESERVE','RELEASE_RESERVATION',
  'SALE','RETURN','ADJUSTMENT','DAMAGE','STATUS_CHANGE','EXTERNAL_JOB_SENT','EXTERNAL_JOB_RETURNED','CUT','INTERNAL_PRODUCTION'
));

-- Seed only neutral reference values explicitly stated in the approved task.
-- ON CONFLICT keeps the migration safe for companies that already use these codes.
INSERT INTO manufacturing_downtime_reasons (company_id, code, name, stage, is_planned)
SELECT c.id, v.code, v.name, 'WEAVING', v.planned
FROM companies c
CROSS JOIN (VALUES
  ('WAIT_WARP','انتظار السدى',false),
  ('WAIT_WEFT','انتظار اللحمة',false),
  ('BLADE_CHANGE','تغيير الشفرات',true),
  ('MECHANICAL_FAILURE','عطل ميكانيكي',false),
  ('ELECTRICAL_FAILURE','عطل كهربائي',false),
  ('REED_CHANGE','تغيير النير',true),
  ('OTHER','سبب آخر',false)
) AS v(code,name,planned)
ON CONFLICT (company_id, code) DO NOTHING;
