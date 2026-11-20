-- 1) أسباب تسوية الفرق: نقص / زيادة / هالك / خيسان.
ALTER TABLE external_job_settlements
  ADD COLUMN IF NOT EXISTS reason_category text CHECK (reason_category IS NULL OR reason_category IN ('SHORTAGE','EXCESS','WASTE','SPOILAGE'));

-- 2) ربط تسوية المهمة بشاشة «تسوية إرساليات المصنعية»: يُسجَّل اعتماد النقص بنفس جدول المطابقة.
ALTER TABLE external_job_line_matches DROP CONSTRAINT IF EXISTS external_job_line_matches_match_type_check;
ALTER TABLE external_job_line_matches
  ADD CONSTRAINT external_job_line_matches_match_type_check CHECK (match_type IN ('PURCHASE_INVOICE', 'SHORTAGE_APPROVED', 'LIFECYCLE_SETTLEMENT'));

-- 3) إرسالية مخزون لكل رجعة مصنعية تظهر في «إرساليات المخزون والشراء» (بلا عملية إدخال).
ALTER TABLE intake_dispatch_slips ALTER COLUMN intake_operation_id DROP NOT NULL;
ALTER TABLE intake_dispatch_slips
  ADD COLUMN IF NOT EXISTS external_job_id uuid REFERENCES external_jobs(id),
  ADD COLUMN IF NOT EXISTS return_batch_id uuid REFERENCES external_job_return_batches(id);
CREATE UNIQUE INDEX IF NOT EXISTS intake_dispatch_slips_return_batch ON intake_dispatch_slips(return_batch_id) WHERE return_batch_id IS NOT NULL;
ALTER TABLE intake_dispatch_slips DROP CONSTRAINT IF EXISTS intake_dispatch_slips_source_check;
ALTER TABLE intake_dispatch_slips
  ADD CONSTRAINT intake_dispatch_slips_source_check CHECK (intake_operation_id IS NOT NULL OR external_job_id IS NOT NULL);
