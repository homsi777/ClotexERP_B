-- Opt-in only: historical issues retain their original net-issue cost basis.
ALTER TABLE manufacturing_material_entries ADD COLUMN consumption_basis text NOT NULL DEFAULT 'LEGACY_NET_ISSUE'
 CHECK(consumption_basis IN ('LEGACY_NET_ISSUE','RECORDED'));
CREATE TABLE manufacturing_material_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 work_order_id uuid NOT NULL, source_entry_id uuid NOT NULL,
 request_id uuid NOT NULL, request_hash text NOT NULL,
 consumed_kg numeric(14,3) NOT NULL CHECK(consumed_kg>=0),
 waste_kg numeric(14,3) NOT NULL CHECK(waste_kg>=0),
 notes text NOT NULL CHECK(length(trim(notes))>0),
 approved_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(consumed_kg+waste_kg>0), UNIQUE(company_id,request_id),
 FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_work_orders(company_id,id),
 FOREIGN KEY(company_id,source_entry_id) REFERENCES manufacturing_material_entries(company_id,id)
);
CREATE INDEX manufacturing_consumption_source ON manufacturing_material_consumptions(company_id,source_entry_id);
ALTER TABLE manufacturing_cost_charges ADD COLUMN source_reference text;
CREATE UNIQUE INDEX manufacturing_charge_source ON manufacturing_cost_charges(company_id,source_reference) WHERE source_reference IS NOT NULL;
INSERT INTO permissions(code,name,category) VALUES
 ('manufacturing.reports.view','عرض تقارير الإنتاج','manufacturing'),
 ('manufacturing.reports.print','طباعة تقارير الإنتاج','manufacturing'),
 ('manufacturing.reports.export','تصدير تقارير الإنتاج','manufacturing') ON CONFLICT(code) DO NOTHING;
