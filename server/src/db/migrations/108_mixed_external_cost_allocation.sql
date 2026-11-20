CREATE TABLE manufacturing_external_cost_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,job_id uuid NOT NULL,work_order_id uuid,
 allocated_usd numeric(14,4) CHECK(allocated_usd>=0),approved_by_user_id uuid REFERENCES users(id),approved_at timestamptz,
 FOREIGN KEY(company_id,job_id) REFERENCES external_jobs(company_id,id),
 FOREIGN KEY(company_id,work_order_id) REFERENCES manufacturing_work_orders(company_id,id)
);
CREATE UNIQUE INDEX mixed_external_cost_owner ON manufacturing_external_cost_shares(company_id,job_id,COALESCE(work_order_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX mixed_external_cost_order ON manufacturing_external_cost_shares(company_id,work_order_id);
