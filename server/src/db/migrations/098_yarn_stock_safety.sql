-- GAP-007: additive yarn metadata; historical ownership remains company.
ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'COMPANY' CHECK (owner_type IN ('COMPANY','CUSTOMER'));
ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS owner_customer_id uuid REFERENCES customers(id);
ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS yarn_properties jsonb NOT NULL DEFAULT '{}';
ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS receipt_packages jsonb;
ALTER TABLE yarn_lots ADD CONSTRAINT yarn_owner_consistency CHECK ((owner_type='COMPANY' AND owner_customer_id IS NULL) OR (owner_type='CUSTOMER' AND owner_customer_id IS NOT NULL));
ALTER TABLE yarn_lots ADD CONSTRAINT yarn_customer_not_available CHECK (owner_type='COMPANY' OR status <> 'AVAILABLE');
ALTER TABLE yarn_lot_movements ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'COMPANY';
ALTER TABLE yarn_lot_movements ADD COLUMN IF NOT EXISTS owner_customer_id uuid REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_yarn_owner ON yarn_lots(company_id,owner_type,owner_customer_id,warehouse_id);
