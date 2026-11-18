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
  CONSTRAINT manufacturing_quality_defect_company_code_unique UNIQUE (company_id, code)
);

CREATE INDEX manufacturing_quality_defect_lookup
  ON manufacturing_quality_defect_catalog(company_id, inspection_type, is_active, name);

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
