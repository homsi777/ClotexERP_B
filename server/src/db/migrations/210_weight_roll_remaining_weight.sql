-- N-0095: توب الوزن — الوزن المتبقي الفعلي يتبع الكمية بعد البيع/المرتجع الجزئي، ويُحفظ الوزن الأصلي للسجل التاريخي
ALTER TABLE fabric_rolls ADD COLUMN IF NOT EXISTS original_weight_kg numeric(14,3);
UPDATE fabric_rolls SET original_weight_kg = actual_weight_kg WHERE entry_basis = 'WEIGHT' AND original_weight_kg IS NULL;

CREATE OR REPLACE FUNCTION fabric_rolls_weight_basis_sync() RETURNS trigger AS $$
BEGIN
  IF NEW.entry_basis = 'WEIGHT' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.original_weight_kg := COALESCE(NEW.original_weight_kg, NEW.actual_weight_kg, NEW.length_m);
    ELSIF NEW.length_m IS DISTINCT FROM OLD.length_m THEN
      -- كمية توب الوزن هي كيلوغرامات: أي تغيّر فيها (بيع/مرتجع/تسوية) يحدّث الوزن الفعلي المتبقي
      NEW.actual_weight_kg := NEW.length_m;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fabric_rolls_weight_basis_sync ON fabric_rolls;
CREATE TRIGGER trg_fabric_rolls_weight_basis_sync
  BEFORE INSERT OR UPDATE ON fabric_rolls
  FOR EACH ROW EXECUTE FUNCTION fabric_rolls_weight_basis_sync();
