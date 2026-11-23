-- M-0001: مكتبة بطاقات المواصفات.
-- بطاقة مرجعية (خامة + كود خامة + ربط اختياري بدليل الخامات) محتواها شبكة أوراق محفوظة كما هي.
-- لا تدخل أرقامها في أي حساب استهلاك أو حركة مخزون؛ هي للعرض والتعديل والطباعة والتصدير فقط.
CREATE TABLE IF NOT EXISTS spec_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  material_name text NOT NULL,
  material_code text NOT NULL,
  fabric_item_id uuid,
  notes text,
  sheets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sheets) = 'array'),
  illustrations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(illustrations) = 'array'),
  source_file_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spec_cards_name_not_blank CHECK (length(trim(material_name)) > 0),
  CONSTRAINT spec_cards_code_not_blank CHECK (length(trim(material_code)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_spec_cards_company ON spec_cards(company_id, is_active, material_name);
CREATE INDEX IF NOT EXISTS idx_spec_cards_item ON spec_cards(company_id, fabric_item_id) WHERE fabric_item_id IS NOT NULL;
