-- أرصدة العملاء والموردين: ملف متابعة التحصيل لكل طرف (اختياري) + سجل ملاحظات المتابعة.
-- لا يغيّر أي قاعدة محاسبية: بيانات إدارية للمتابعة فقط.
CREATE TABLE IF NOT EXISTS party_collection_profiles (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('CUSTOMER', 'SUPPLIER')),
  party_id uuid NOT NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  credit_limit numeric(18,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  credit_limit_currency text,
  expected_collection_date date,
  promised_amount numeric(18,2) CHECK (promised_amount IS NULL OR promised_amount >= 0),
  promised_currency text,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, party_type, party_id),
  CHECK ((credit_limit IS NULL) = (credit_limit_currency IS NULL)),
  CHECK ((promised_amount IS NULL) = (promised_currency IS NULL))
);

CREATE TABLE IF NOT EXISTS party_collection_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('CUSTOMER', 'SUPPLIER')),
  party_id uuid NOT NULL,
  note text NOT NULL CHECK (length(trim(note)) > 0),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_party_collection_notes_party ON party_collection_notes(company_id, party_type, party_id, created_at DESC);
