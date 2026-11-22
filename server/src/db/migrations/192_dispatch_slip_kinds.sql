-- إرساليات المخزون والشراء تسجّل أنواعاً أكثر: شراء، مخزون، مصنعية خارجية، وإنشاء مادة جديدة.
ALTER TABLE intake_dispatch_slips DROP CONSTRAINT IF EXISTS intake_dispatch_slips_slip_type_check;
ALTER TABLE intake_dispatch_slips
  ADD CONSTRAINT intake_dispatch_slips_slip_type_check CHECK (slip_type IN ('STOCK', 'PURCHASE', 'EXTERNAL', 'ITEM_CREATION'));

-- إرسالية «إنشاء مادة» لا مورد لها ولا عملية إدخال.
ALTER TABLE intake_dispatch_slips ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE intake_dispatch_slips DROP CONSTRAINT IF EXISTS intake_dispatch_slips_source_check;
ALTER TABLE intake_dispatch_slips
  ADD CONSTRAINT intake_dispatch_slips_source_check CHECK (
    intake_operation_id IS NOT NULL OR external_job_id IS NOT NULL OR slip_type = 'ITEM_CREATION'
  );

-- إرساليات استلام المصنعية الخارجية القائمة (كانت STOCK) تصير EXTERNAL.
UPDATE intake_dispatch_slips SET slip_type = 'EXTERNAL' WHERE external_job_id IS NOT NULL AND slip_type = 'STOCK';

CREATE INDEX IF NOT EXISTS idx_intake_dispatch_slips_type_date ON intake_dispatch_slips(company_id, slip_type, created_at DESC);
