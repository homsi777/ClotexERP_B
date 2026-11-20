-- Quality evidence only; no stock/quantity ledger or historical approvals fabricated.
ALTER TABLE manufacturing_production_batches ADD COLUMN IF NOT EXISTS quality_checklist jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(quality_checklist)='array');
ALTER TABLE external_job_return_lines
 ADD COLUMN IF NOT EXISTS quality_checklist jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(quality_checklist)='array'),
 ADD COLUMN IF NOT EXISTS quality_defects jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(quality_defects)='array'),
 ADD COLUMN IF NOT EXISTS quality_notes text,
 ADD COLUMN IF NOT EXISTS inspected_by_user_id uuid REFERENCES users(id),
 ADD COLUMN IF NOT EXISTS inspected_at timestamptz;
CREATE INDEX IF NOT EXISTS external_return_quality_inbox ON external_job_return_lines(company_id,job_id,batch_id) WHERE defective AND resolution IS NULL;

ALTER TABLE external_job_return_lines ADD COLUMN IF NOT EXISTS quality_images jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(quality_images)='array');
