-- ملاحظة بشير: مخزون الكارتيلات بالعدد. يُدخَل العدد يدوياً لكل كارتيلة (أو لكل لون منها)،
-- وعند تسليم كارتيلة بنفس الباركود/الرقم التسلسلي يُخصم من العدد المتاح (المتاح = العدد − ما بعهدة العملاء).
-- لا قيود ولا حركات مالية ولا مخزون أقمشة. غياب السطر = الكارتيلة بلا تتبع عددي (السلوك السابق).
CREATE TABLE IF NOT EXISTS cartela_stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cartela_label_id uuid NOT NULL REFERENCES cartela_labels(id) ON DELETE CASCADE,
  color_id uuid REFERENCES cartela_label_colors(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity >= 0),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- مستوى واحد لكل (كارتيلة، لون) — color_id الفارغ = مستوى الكارتيلة كلها.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cartela_stock_level
  ON cartela_stock_levels(company_id, cartela_label_id, COALESCE(color_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_cartela_stock_levels_label ON cartela_stock_levels(company_id, cartela_label_id);
