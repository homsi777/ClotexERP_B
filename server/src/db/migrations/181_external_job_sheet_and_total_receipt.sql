-- ملاحظات بشير (المصنعية الخارجية):
-- 1) حقول الورقة العامة: العرض خام/محضّر ووزن المتر المربع خام/محضّر.
-- 2) الاستلام بمرجع الكمية الإجمالية: كل رول راجع يُوزَّع تلقائياً على بنود الإرسال (قد يغطي أكثر من بند)،
--    فلا يختار المستخدم «البكرة المرسلة». التوزيع يُخزَّن هنا ويُبنى عليه رصيد كل بند والإغلاق وتتبع الأوردر.

ALTER TABLE external_jobs
  ADD COLUMN IF NOT EXISTS raw_width_cm numeric(14,2) CHECK (raw_width_cm IS NULL OR raw_width_cm >= 0),
  ADD COLUMN IF NOT EXISTS finished_width_cm numeric(14,2) CHECK (finished_width_cm IS NULL OR finished_width_cm >= 0),
  ADD COLUMN IF NOT EXISTS raw_gsm numeric(14,2) CHECK (raw_gsm IS NULL OR raw_gsm >= 0),
  ADD COLUMN IF NOT EXISTS finished_gsm numeric(14,2) CHECK (finished_gsm IS NULL OR finished_gsm >= 0);

CREATE TABLE IF NOT EXISTS external_job_return_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  job_id uuid NOT NULL REFERENCES external_jobs(id),
  return_line_id uuid NOT NULL REFERENCES external_job_return_lines(id),
  source_line_id uuid NOT NULL REFERENCES external_job_lines(id),
  length_m numeric(14,3) NOT NULL CHECK (length_m > 0),
  UNIQUE (return_line_id, source_line_id)
);
CREATE INDEX IF NOT EXISTS external_return_alloc_source ON external_job_return_allocations(company_id, job_id, source_line_id);

-- السجلات الحالية: كل رول راجع منسوب بكامله لبند واحد (كما سُجِّل فعلاً).
INSERT INTO external_job_return_allocations (company_id, job_id, return_line_id, source_line_id, length_m)
SELECT company_id, job_id, id, source_line_id, length_m FROM external_job_return_lines
ON CONFLICT DO NOTHING;

-- أي إدراج مباشر لسطر راجع (بلا خدمة التوزيع) يحصل على توزيع افتراضي 1:1 فيبقى الحساب متسقاً.
CREATE OR REPLACE FUNCTION external_return_default_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO external_job_return_allocations (company_id, job_id, return_line_id, source_line_id, length_m)
  VALUES (NEW.company_id, NEW.job_id, NEW.id, NEW.source_line_id, NEW.length_m)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS external_return_default_alloc ON external_job_return_lines;
CREATE TRIGGER external_return_default_alloc AFTER INSERT ON external_job_return_lines
  FOR EACH ROW EXECUTE FUNCTION external_return_default_allocation();

-- أصول الرول الراجع (للتتبع والتكلفة): كل بند إرسال ساهم فيه، لا البند الأساسي فقط.
CREATE OR REPLACE VIEW external_job_return_sources AS
SELECT a.company_id, a.job_id, a.return_line_id, q.result_roll_id, a.source_line_id, l.roll_id AS source_roll_id, a.length_m
FROM external_job_return_allocations a
JOIN external_job_return_lines q ON q.id = a.return_line_id AND q.company_id = a.company_id
JOIN external_job_lines l ON l.id = a.source_line_id AND l.company_id = a.company_id;

-- حارس حجز الجودة (079): الطول المتوقع للرول الأصلي يُحسب من التوزيع لا من سطر الراجع.
CREATE OR REPLACE FUNCTION guard_external_job_quality_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_job_lines l WHERE l.roll_id=OLD.id AND l.company_id=OLD.company_id
    AND l.line_status='SENT' AND EXISTS (SELECT 1 FROM external_job_return_batches b WHERE b.job_id=l.job_id AND b.company_id=l.company_id))
    AND (TG_OP='DELETE' OR NEW.status IS DISTINCT FROM OLD.status
      OR (NEW.length_m IS DISTINCT FROM OLD.length_m AND NEW.length_m IS DISTINCT FROM
        (SELECT GREATEST(0,l.sent_length_m
          -COALESCE((SELECT SUM(a.length_m) FROM external_job_return_allocations a WHERE a.source_line_id=l.id AND a.company_id=l.company_id),0)
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

-- حارس بيع الإنتاج غير المكلَّف (096): تتبع الأصول عبر كل بنود الإرسال المساهمة.
CREATE OR REPLACE FUNCTION guard_manufacturing_uncosted_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status IN ('SOLD','RESERVED') AND NEW.status IS DISTINCT FROM OLD.status)
    OR (OLD.status='AVAILABLE' AND NEW.status IN ('AVAILABLE','SOLD','RESERVED') AND NEW.length_m<OLD.length_m) THEN
  IF EXISTS(WITH RECURSIVE ancestors(id) AS (
   SELECT OLD.id UNION SELECT s.source_roll_id FROM external_job_return_sources s JOIN ancestors a ON a.id=s.result_roll_id WHERE s.company_id=OLD.company_id
  ) SELECT 1 FROM ancestors a JOIN manufacturing_raw_roll_outputs o ON o.result_fabric_roll_id=a.id AND o.company_id=OLD.company_id
    JOIN manufacturing_weaving_runs r ON r.id=o.weaving_run_id AND r.company_id=o.company_id
    WHERE NOT EXISTS(SELECT 1 FROM manufacturing_cost_closures c WHERE c.company_id=r.company_id AND c.work_order_id=r.work_order_id)) THEN
   RAISE EXCEPTION 'يجب اعتماد تكلفة أمر الإنتاج قبل حجز أو بيع الرولات' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
