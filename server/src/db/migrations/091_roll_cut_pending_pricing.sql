-- ملاحظة مدير بشير: التسعير صلاحية. من لديه صلاحية التسعير يسعّر القص؛ ومن بروفايل إدارة المخزون يحفظ القص فقط،
-- وتبقى الفاتورة معلّقة إلى أن يسعّرها المحاسب.
--
-- 1) fabric_roll_cuts: حالة التسعير (PENDING/PRICED). القص المعلّق بلا فاتورة بعد (المتر خُصم من التوب الأصلي
--    عند الحفظ بحركة CUT)، ويُنشئ المحاسب الفاتورة لاحقاً دون خصم ثانٍ (سطر الفاتورة يحمل rollCutPrededucted).
ALTER TABLE fabric_roll_cuts ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'PRICED';
ALTER TABLE fabric_roll_cuts DROP CONSTRAINT IF EXISTS fabric_roll_cuts_pricing_status_chk;
ALTER TABLE fabric_roll_cuts ADD CONSTRAINT fabric_roll_cuts_pricing_status_chk CHECK (pricing_status IN ('PENDING', 'PRICED'));

ALTER TABLE fabric_roll_cuts ALTER COLUMN sales_invoice_id DROP NOT NULL;
ALTER TABLE fabric_roll_cuts ALTER COLUMN sales_invoice_no DROP NOT NULL;

-- المسعَّر له فاتورة، والمعلَّق بلا فاتورة — لا حالة وسطى. (السجلات القائمة كلها PRICED ولها فاتورة.)
ALTER TABLE fabric_roll_cuts DROP CONSTRAINT IF EXISTS fabric_roll_cuts_invoice_matches_status_chk;
ALTER TABLE fabric_roll_cuts ADD CONSTRAINT fabric_roll_cuts_invoice_matches_status_chk
  CHECK ((pricing_status = 'PRICED') = (sales_invoice_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_fabric_roll_cuts_pending
  ON fabric_roll_cuts(company_id, created_at DESC) WHERE pricing_status = 'PENDING';

-- 2) صلاحية جديدة: invoices.price (تسعير الفواتير والقطع المقصوصة).
INSERT INTO permissions (code, name, category)
VALUES ('invoices.price', 'تسعير الفواتير والقطع المقصوصة', 'invoices')
ON CONFLICT (code) DO NOTHING;

-- منحها إضافياً للأدوار التي كانت تسعّر فعلاً (مدير النظام، مدير العمليات، المحاسب) حتى لا يتغيّر سلوكها اليوم.
-- دور «المخزون» لا يُمنَحها عمداً — هذا هو المطلوب: يحفظ القص فقط ويسعّره المحاسب.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.code IN ('admin', 'manager', 'accountant')
   AND p.code = 'invoices.price'
ON CONFLICT DO NOTHING;
