-- Analytical allocations only: accounting/payroll remain authoritative.
ALTER TABLE payroll_run_lines ADD CONSTRAINT payroll_lines_company_identity_116 UNIQUE(company_id,id);
-- Register projects canonical machine fields; never maintains a second valuation.
ALTER TABLE manufacturing_machines ADD COLUMN acquisition_date date;
CREATE VIEW manufacturing_asset_register AS
 SELECT company_id,id AS machine_id,code,name,asset_value,asset_currency_code,
 acquisition_date,ownership_type,owner_name,is_active,version
 FROM manufacturing_machines;
CREATE TABLE manufacturing_asset_register_requests (
 company_id uuid NOT NULL REFERENCES companies(id),request_id uuid NOT NULL,
 machine_id uuid NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,request_id),
 FOREIGN KEY(company_id,machine_id) REFERENCES manufacturing_machines(company_id,id)
);
CREATE TABLE manufacturing_internal_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 request_id uuid NOT NULL, request_hash text NOT NULL, machine_id uuid NOT NULL,
 unit text NOT NULL CHECK(unit IN ('HOUR','METER','KG','UNIT')), kind text NOT NULL CHECK(kind IN ('ENERGY','OVERHEAD')),
 amount numeric(14,4) NOT NULL CHECK(amount>0), currency_code text NOT NULL REFERENCES currencies(code),
 asset_reference text, notes text NOT NULL CHECK(length(trim(notes))>0),
 status text NOT NULL DEFAULT 'UNAPPROVED' CHECK(status IN ('UNAPPROVED','APPROVED')),
 created_by_user_id uuid NOT NULL REFERENCES users(id), approved_by_user_id uuid REFERENCES users(id), approved_at timestamptz,
 UNIQUE(company_id,id), UNIQUE(company_id,request_id),
 FOREIGN KEY(company_id,machine_id) REFERENCES manufacturing_machines(company_id,id),
 CHECK((status='APPROVED')=(approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);
ALTER TABLE manufacturing_cost_charges
 ADD COLUMN approval_status text NOT NULL DEFAULT 'UNAPPROVED' CHECK(approval_status IN ('UNAPPROVED','APPROVED')),
 ADD COLUMN approved_by_user_id uuid REFERENCES users(id), ADD COLUMN approved_at timestamptz,
 ADD COLUMN payroll_cost_basis text CHECK(payroll_cost_basis IN ('ELIGIBLE_EARNINGS','APPROVED_NET_SNAPSHOT')),
 ADD COLUMN payroll_source_snapshot jsonb CHECK(payroll_source_snapshot IS NULL OR jsonb_typeof(payroll_source_snapshot)='object'),
 ADD COLUMN payroll_line_id uuid, ADD COLUMN internal_rate_id uuid, ADD COLUMN allocation_quantity numeric(14,3),
 ADD CONSTRAINT manufacturing_charge_payroll_fk FOREIGN KEY(company_id,payroll_line_id) REFERENCES payroll_run_lines(company_id,id),
 ADD CONSTRAINT manufacturing_charge_rate_fk FOREIGN KEY(company_id,internal_rate_id) REFERENCES manufacturing_internal_rates(company_id,id),
 ADD CONSTRAINT manufacturing_charge_source_chk CHECK(NOT(payroll_line_id IS NOT NULL AND internal_rate_id IS NOT NULL));
-- Prior allocations explicitly used net. Preserve that basis and original source
-- components instead of silently upgrading them to eligible earnings.
UPDATE manufacturing_cost_charges c SET payroll_cost_basis='APPROVED_NET_SNAPSHOT',
 payroll_source_snapshot=jsonb_build_object('basis','APPROVED_NET_SNAPSHOT',
 'baseSalary',l.base_salary,'allowances',l.allowances,'deductions',l.deductions,
 'netSalary',l.net_salary,'grossEarnings',l.base_salary+l.allowances,
 'eligibleAmount',l.net_salary,'currencyCode',r.currency_code,
 'exchangeRate',r.exchange_rate_to_usd,'payrollRunId',r.id,'payrollLineId',l.id,
 'employeeId',l.employee_id,'historicalNetBasis',true)
 FROM payroll_run_lines l JOIN payroll_runs r ON r.company_id=l.company_id AND r.id=l.payroll_run_id
 WHERE c.company_id=l.company_id AND c.payroll_line_id=l.id;
ALTER TABLE manufacturing_cost_charges ADD CONSTRAINT manufacturing_payroll_snapshot_required_116 CHECK(
 (payroll_line_id IS NULL AND payroll_cost_basis IS NULL AND payroll_source_snapshot IS NULL)
 OR (payroll_line_id IS NOT NULL AND payroll_cost_basis IS NOT NULL AND payroll_source_snapshot IS NOT NULL)
);
-- Preserve already frozen historical closures, leave open costs explicitly unapproved.
UPDATE manufacturing_cost_charges c SET approval_status='APPROVED',approved_by_user_id=x.created_by_user_id,approved_at=x.created_at
 FROM manufacturing_cost_closures x WHERE x.company_id=c.company_id AND x.work_order_id=c.work_order_id;
CREATE INDEX manufacturing_payroll_allocation_116 ON manufacturing_cost_charges(company_id,payroll_line_id);
CREATE FUNCTION manufacturing_financial_freeze_116() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='manufacturing_internal_rates' THEN
  IF OLD.status='APPROVED' THEN RAISE EXCEPTION 'Approved internal rate is immutable'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM manufacturing_cost_closures c WHERE c.company_id=OLD.company_id AND c.work_order_id=OLD.work_order_id)
   OR OLD.approval_status='APPROVED' THEN RAISE EXCEPTION 'Approved manufacturing cost is immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER manufacturing_rate_freeze_116 BEFORE UPDATE OR DELETE ON manufacturing_internal_rates FOR EACH ROW EXECUTE FUNCTION manufacturing_financial_freeze_116();
CREATE TRIGGER manufacturing_charge_freeze_116 BEFORE UPDATE OR DELETE ON manufacturing_cost_charges FOR EACH ROW EXECUTE FUNCTION manufacturing_financial_freeze_116();
-- Prevent authoritative payroll changes invalidating reserved or frozen allocations.
CREATE FUNCTION manufacturing_payroll_guard_116() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='payroll_runs' THEN
  IF EXISTS(SELECT 1 FROM payroll_run_lines l JOIN manufacturing_cost_charges c ON c.company_id=l.company_id AND c.payroll_line_id=l.id WHERE l.company_id=OLD.company_id AND l.payroll_run_id=OLD.id)
   AND (TG_OP='DELETE' OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.status NOT IN ('CONFIRMED','PAID') OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.exchange_rate_to_usd IS DISTINCT FROM OLD.exchange_rate_to_usd)
   THEN RAISE EXCEPTION 'Payroll has manufacturing allocations'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM manufacturing_cost_charges c WHERE c.company_id=OLD.company_id AND c.payroll_line_id=OLD.id)
   THEN RAISE EXCEPTION 'Payroll line has manufacturing allocations'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER manufacturing_payroll_run_guard_116 BEFORE UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION manufacturing_payroll_guard_116();
CREATE TRIGGER manufacturing_payroll_line_guard_116 BEFORE UPDATE OR DELETE ON payroll_run_lines FOR EACH ROW EXECUTE FUNCTION manufacturing_payroll_guard_116();
