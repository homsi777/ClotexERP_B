-- Additive only. Existing transfers remain unchanged. Apply to an isolated local test DB first.
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS client_request_id uuid;
ALTER TABLE inventory_transfers ADD COLUMN IF NOT EXISTS request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_transfer_request
  ON inventory_transfers(company_id, client_request_id) WHERE client_request_id IS NOT NULL;
