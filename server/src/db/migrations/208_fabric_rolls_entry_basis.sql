-- N-0084: الأتواب المُدخلة بالوزن تُتابَع بالكيلو؛ طولها مشتق وليس فعلياً
ALTER TABLE fabric_rolls ADD COLUMN IF NOT EXISTS entry_basis text NOT NULL DEFAULT 'LENGTH';
DO $$ BEGIN
  ALTER TABLE fabric_rolls ADD CONSTRAINT fabric_rolls_entry_basis_chk CHECK (entry_basis IN ('LENGTH','WEIGHT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
