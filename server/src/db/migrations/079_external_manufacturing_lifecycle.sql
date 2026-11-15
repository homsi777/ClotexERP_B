-- 078 is reserved by TASK 001 PR #2. Independent of that migration.
ALTER TABLE external_jobs ADD COLUMN previous_job_id uuid REFERENCES external_jobs(id);
ALTER TABLE external_job_lines ADD COLUMN sent_weight_kg numeric(14,3),
  ADD COLUMN sent_unit_cost numeric(14,4), ADD COLUMN sent_currency_code text REFERENCES currencies(code),
  ADD COLUMN sent_warehouse_id uuid REFERENCES warehouses(id),
  ADD COLUMN sent_item_id uuid REFERENCES fabric_items(id), ADD COLUMN sent_width_cm numeric(14,2),
  ADD COLUMN sent_gsm numeric(14,2), ADD COLUMN sent_roll_no text;
CREATE TABLE external_job_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  job_id uuid NOT NULL REFERENCES external_jobs(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  basis text NOT NULL CHECK (basis IN ('METER','KG','FIXED')),
  unit_price numeric(14,4) CHECK (unit_price >= 0),
  currency_code text REFERENCES currencies(code),
  approved_quantity numeric(14,3) CHECK (approved_quantity >= 0),
  total_usd numeric(14,4),
  priced_by uuid REFERENCES users(id),
  UNIQUE(company_id,job_id,id)
);
CREATE TABLE external_job_return_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  job_id uuid NOT NULL REFERENCES external_jobs(id),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  dye_paper_no text NOT NULL,
  notes text,
  attachments jsonb NOT NULL DEFAULT '[]',
  received_by uuid REFERENCES users(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,request_id),
  UNIQUE(company_id,job_id,id)
);
CREATE TABLE external_job_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  job_id uuid NOT NULL REFERENCES external_jobs(id),
  batch_id uuid NOT NULL REFERENCES external_job_return_batches(id),
  source_line_id uuid NOT NULL REFERENCES external_job_lines(id),
  source_roll_id uuid NOT NULL REFERENCES fabric_rolls(id),
  original_barcode text NOT NULL,
  result_roll_id uuid NOT NULL UNIQUE REFERENCES fabric_rolls(id),
  length_m numeric(14,3) NOT NULL CHECK (length_m > 0),
  weight_kg numeric(14,3) CHECK (weight_kg >= 0),
  defective boolean NOT NULL DEFAULT false,
  defect_reason text CHECK (defect_reason IN ('DYE_HOUSE','INTERNAL_KNITTING','OTHER')),
  responsible_party text,
  notes text,
  resolution text CHECK (resolution IN ('ACCEPT','REWORK','WRITE_OFF')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_notes text
);
CREATE INDEX external_job_return_lines_job ON external_job_return_lines(company_id,job_id,source_line_id);
CREATE INDEX external_job_quality_hold ON external_job_return_lines(company_id,result_roll_id) WHERE defective AND resolution IS NULL;
CREATE TABLE external_job_return_services (
  batch_id uuid NOT NULL REFERENCES external_job_return_batches(id),
  service_id uuid NOT NULL REFERENCES external_job_services(id),
  PRIMARY KEY(batch_id,service_id)
);
CREATE TABLE external_job_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  job_id uuid NOT NULL REFERENCES external_jobs(id),
  source_line_id uuid NOT NULL REFERENCES external_job_lines(id),
  amount_m numeric(14,3) NOT NULL CHECK (amount_m > 0),
  kind text NOT NULL DEFAULT 'SHORTAGE' CHECK(kind IN ('SHORTAGE','EXCESS')),
  reason text NOT NULL CHECK(length(trim(reason)) > 0),
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE external_jobs ADD COLUMN lifecycle_closed_at timestamptz;

-- Final backstop for legacy APIs: an unresolved inspection hold cannot be sold,
-- released, moved, edited down or consumed even if an old route omits a check.
CREATE FUNCTION guard_external_job_quality_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_job_lines l WHERE l.roll_id=OLD.id AND l.company_id=OLD.company_id
    AND l.line_status='SENT' AND EXISTS (SELECT 1 FROM external_job_return_batches b WHERE b.job_id=l.job_id AND b.company_id=l.company_id))
    AND (TG_OP='DELETE' OR NEW.status IS DISTINCT FROM OLD.status
      OR (NEW.length_m IS DISTINCT FROM OLD.length_m AND NEW.length_m IS DISTINCT FROM
        (SELECT GREATEST(0,l.sent_length_m
          -COALESCE((SELECT SUM(q.length_m) FROM external_job_return_lines q WHERE q.source_line_id=l.id AND q.company_id=l.company_id),0)
          -COALESCE((SELECT SUM(s.amount_m) FROM external_job_settlements s WHERE s.source_line_id=l.id AND s.company_id=l.company_id AND s.kind='SHORTAGE'),0))
         FROM external_job_lines l WHERE l.roll_id=OLD.id AND l.company_id=OLD.company_id AND l.line_status='SENT' LIMIT 1))
      OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    RAISE EXCEPTION 'الرولة الأصلية مرتبطة باستلام مصنعية على دفعات' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM external_job_return_lines q
    WHERE q.company_id=OLD.company_id AND q.result_roll_id=OLD.id
      AND q.defective AND q.resolution IS NULL)
    AND (TG_OP='DELETE' OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
      OR NEW.location_id IS DISTINCT FROM OLD.location_id
      OR NEW.length_m IS DISTINCT FROM OLD.length_m
      OR NEW.barcode IS DISTINCT FROM OLD.barcode
      OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    RAISE EXCEPTION 'البضاعة محجوزة للفحص؛ يلزم قرار مسؤول مخول' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER external_job_quality_hold_guard BEFORE UPDATE OR DELETE ON fabric_rolls
  FOR EACH ROW EXECUTE FUNCTION guard_external_job_quality_hold();

CREATE FUNCTION guard_external_job_hold_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lock the roll so inspection decisions and consuming movements serialize.
  PERFORM 1 FROM fabric_rolls WHERE id=NEW.roll_id AND company_id=NEW.company_id FOR UPDATE;
  IF NEW.movement_type IN ('SALE','TRANSFER_OUT','TRANSFER_IN','EXTERNAL_JOB_SENT','ADJUSTMENT','DAMAGE','RELEASE_RESERVATION')
    AND EXISTS (SELECT 1 FROM external_job_return_lines q WHERE q.result_roll_id=NEW.roll_id
      AND q.company_id=NEW.company_id AND q.defective AND q.resolution IS NULL) THEN
    RAISE EXCEPTION 'البضاعة محجوزة للفحص' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER external_job_hold_movement_guard BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION guard_external_job_hold_movement();
