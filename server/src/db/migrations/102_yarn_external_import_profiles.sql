-- GAP-007 only. Additive; no production data is rewritten.
ALTER TABLE yarn_lots ADD COLUMN parent_yarn_lot_id uuid REFERENCES yarn_lots(id);
ALTER TABLE yarn_lots ADD COLUMN receipt_key uuid;
CREATE UNIQUE INDEX yarn_receipt_key ON yarn_lots(company_id,receipt_key) WHERE receipt_key IS NOT NULL;
CREATE INDEX yarn_parent_lot ON yarn_lots(company_id,parent_yarn_lot_id);

CREATE TABLE yarn_item_profiles (
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES fabric_items(id),
  properties jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,item_id)
);
CREATE TABLE yarn_profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES fabric_items(id),
  properties jsonb NOT NULL,
  version integer NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,item_id,version)
);

CREATE TABLE yarn_external_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  source_lot_id uuid NOT NULL REFERENCES yarn_lots(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  owner_type text NOT NULL CHECK(owner_type IN ('COMPANY','CUSTOMER')),
  owner_customer_id uuid REFERENCES customers(id),
  dispatched_kg numeric(12,3) NOT NULL CHECK(dispatched_kg > 0),
  returned_kg numeric(12,3) NOT NULL DEFAULT 0 CHECK(returned_kg >= 0),
  shortage_kg numeric(12,3) NOT NULL DEFAULT 0 CHECK(shortage_kg >= 0),
  request_key uuid NOT NULL,
  notes text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,request_key),
  CHECK(returned_kg + shortage_kg <= dispatched_kg),
  CHECK((owner_type='COMPANY' AND owner_customer_id IS NULL) OR (owner_type='CUSTOMER' AND owner_customer_id IS NOT NULL))
);
CREATE TABLE yarn_external_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  dispatch_id uuid NOT NULL REFERENCES yarn_external_dispatches(id),
  result_lot_id uuid REFERENCES yarn_lots(id),
  returned_kg numeric(12,3) NOT NULL CHECK(returned_kg >= 0),
  shortage_kg numeric(12,3) NOT NULL CHECK(shortage_kg >= 0),
  request_key uuid NOT NULL,
  notes text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,request_key),
  CHECK(returned_kg + shortage_kg > 0)
);
CREATE INDEX yarn_external_source ON yarn_external_dispatches(company_id,source_lot_id);
CREATE INDEX yarn_external_return_dispatch ON yarn_external_returns(company_id,dispatch_id);

CREATE TABLE yarn_opening_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  content_sha256 text NOT NULL,
  source_csv text NOT NULL,
  row_count integer NOT NULL CHECK(row_count > 0),
  total_kg numeric(15,3) NOT NULL CHECK(total_kg >= 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,file_sha256),
  UNIQUE(company_id,content_sha256)
);
