-- Extend the existing weight-stock ledger rather than introduce parallel stock.
-- Migration 093 (warehouse zones) replaces this check after manufacturing 083.
-- Retain the union of both modules' movement types.
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check CHECK(movement_type IN (
 'OPENING','PURCHASE_RECEIPT','MANUAL_CREATE','TRANSFER_OUT','TRANSFER_IN','RESERVE','RELEASE_RESERVATION',
 'SALE','RETURN','ADJUSTMENT','DAMAGE','STATUS_CHANGE','EXTERNAL_JOB_SENT','EXTERNAL_JOB_RETURNED','CUT','LOCATION_MOVE','INTERNAL_PRODUCTION'
));
ALTER TABLE manufacturing_warping_yarn_issue_lines
 ADD COLUMN issued_unit_cost numeric(14,4), ADD COLUMN issued_currency_code text,
 ADD COLUMN issued_exchange_rate numeric(18,8);
CREATE TABLE manufacturing_material_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 work_order_id uuid NOT NULL, weaving_run_id uuid, sizing_order_id uuid,
 yarn_lot_id uuid NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ISSUE','RETURN')), source_entry_id uuid,
 weight_kg numeric(14,3) NOT NULL CHECK(weight_kg>0),
 waste_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK(waste_kg>=0 AND waste_kg<=weight_kg),
 unit_cost numeric(14,4),currency_code text,exchange_rate numeric(18,8) CHECK(exchange_rate>0),
 notes text NOT NULL CHECK(length(trim(notes))>0), created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),UNIQUE(company_id,request_id),
 CHECK((weaving_run_id IS NOT NULL)::int+(sizing_order_id IS NOT NULL)::int=1),
 CHECK((kind='RETURN')=(source_entry_id IS NOT NULL)),CHECK(kind='ISSUE' OR waste_kg=0),
 FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_work_orders(company_id,id),
 FOREIGN KEY(company_id,weaving_run_id) REFERENCES manufacturing_weaving_runs(company_id,id),
 FOREIGN KEY(company_id,sizing_order_id) REFERENCES manufacturing_sizing_orders(company_id,id),
 FOREIGN KEY(company_id,yarn_lot_id) REFERENCES yarn_lots(company_id,id),
 FOREIGN KEY(company_id,source_entry_id) REFERENCES manufacturing_material_entries(company_id,id)
);
CREATE INDEX manufacturing_material_entries_order ON manufacturing_material_entries(company_id,work_order_id);
CREATE INDEX manufacturing_material_entries_source ON manufacturing_material_entries(company_id,source_entry_id) WHERE source_entry_id IS NOT NULL;
CREATE INDEX manufacturing_output_roll_trace ON manufacturing_raw_roll_outputs(company_id,result_fabric_roll_id);
CREATE INDEX manufacturing_external_roll_trace ON external_job_return_lines(company_id,source_roll_id);
CREATE TABLE manufacturing_cost_charges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),work_order_id uuid NOT NULL,
 request_id uuid NOT NULL,request_hash text NOT NULL,kind text NOT NULL CHECK(kind IN ('LABOR','ENERGY','OVERHEAD','ADJUSTMENT')),
 amount numeric(14,4) NOT NULL CHECK(amount<>0),currency_code text NOT NULL,exchange_rate numeric(18,8) NOT NULL CHECK(exchange_rate>0),
 notes text NOT NULL CHECK(length(trim(notes))>0),created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,request_id),FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_work_orders(company_id,id)
);
ALTER TABLE external_jobs ADD CONSTRAINT external_jobs_company_identity UNIQUE(company_id,id);
CREATE TABLE manufacturing_external_links (
 company_id uuid NOT NULL,work_order_id uuid NOT NULL,job_id uuid NOT NULL,created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,job_id),FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_work_orders(company_id,id),
 FOREIGN KEY(company_id,job_id) REFERENCES external_jobs(company_id,id)
);
CREATE TABLE manufacturing_cost_closures (
 company_id uuid NOT NULL,work_order_id uuid NOT NULL,total_usd numeric(18,4) NOT NULL CHECK(total_usd>=0),
 accepted_length_m numeric(14,3) NOT NULL CHECK(accepted_length_m>0),unit_cost_usd numeric(18,8) NOT NULL CHECK(unit_cost_usd>=0),
 breakdown jsonb NOT NULL,created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,work_order_id),FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_work_orders(company_id,id)
);
CREATE TABLE manufacturing_cost_allocations (
 company_id uuid NOT NULL,work_order_id uuid NOT NULL,roll_id uuid NOT NULL REFERENCES fabric_rolls(id),length_m numeric(14,3) NOT NULL,
 allocated_usd numeric(18,4) NOT NULL,PRIMARY KEY(company_id,work_order_id,roll_id),
 FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_cost_closures(company_id,work_order_id)
);

-- Never sell uncosted production through a legacy inventory/invoice endpoint.
CREATE FUNCTION guard_manufacturing_uncosted_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status IN ('SOLD','RESERVED') AND NEW.status IS DISTINCT FROM OLD.status)
    OR (OLD.status='AVAILABLE' AND NEW.status IN ('AVAILABLE','SOLD','RESERVED') AND NEW.length_m<OLD.length_m) THEN
  IF EXISTS(WITH RECURSIVE ancestors(id) AS (
   SELECT OLD.id UNION SELECT q.source_roll_id FROM external_job_return_lines q JOIN ancestors a ON a.id=q.result_roll_id WHERE q.company_id=OLD.company_id
  ) SELECT 1 FROM ancestors a JOIN manufacturing_raw_roll_outputs o ON o.result_fabric_roll_id=a.id AND o.company_id=OLD.company_id
    JOIN manufacturing_weaving_runs r ON r.id=o.weaving_run_id AND r.company_id=o.company_id
    WHERE NOT EXISTS(SELECT 1 FROM manufacturing_cost_closures c WHERE c.company_id=r.company_id AND c.work_order_id=r.work_order_id)) THEN
   RAISE EXCEPTION 'يجب اعتماد تكلفة أمر الإنتاج قبل حجز أو بيع الرولات' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manufacturing_uncosted_sale_guard BEFORE UPDATE ON fabric_rolls FOR EACH ROW EXECUTE FUNCTION guard_manufacturing_uncosted_sale();

INSERT INTO permissions(code,name,category) VALUES
 ('manufacturing.cost.view','عرض تكاليف الإنتاج','manufacturing'),
 ('manufacturing.cost.manage','تسعير واعتماد تكاليف الإنتاج','manufacturing')
ON CONFLICT(code) DO NOTHING;
