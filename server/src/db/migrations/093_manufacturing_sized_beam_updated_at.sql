-- Weaving updates the lifecycle timestamp for either kind of input beam.
-- Older sized-beam definitions omitted this column, blocking the sizing path.
ALTER TABLE manufacturing_sized_beams
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
