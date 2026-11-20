-- إنهاء الاستلام المخزوني لمهمة المصنعية: بعده تنتقل المهمة للمحاسب (التسوية والتسعير والإغلاق).
ALTER TABLE external_jobs
  ADD COLUMN IF NOT EXISTS inventory_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inventory_completed_by uuid REFERENCES users(id);
