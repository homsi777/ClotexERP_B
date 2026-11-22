-- صور الشيكات المتعددة (وجه/ظهر) مع حفظ الأصل: التعديل (قص/تدوير) يُخزَّن بجانب الأصل ولا يستبدله.
-- checks.image_data يبقى «الصورة الأساسية الفعّالة» (أول صورة، المعدَّلة إن وُجد تعديل) كي تعمل الشاشات القديمة كما هي.
CREATE TABLE IF NOT EXISTS check_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  check_id uuid NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  side text NOT NULL DEFAULT 'FRONT' CHECK (side IN ('FRONT', 'BACK', 'OTHER')),
  sort_order int NOT NULL DEFAULT 0,
  original_data text NOT NULL,
  edited_data text,
  -- معاملات آخر تعديل (تدوير/قص) لإعادة فتح المحرر على نفس الحالة.
  edit_params jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_check_images_check ON check_images(company_id, check_id, sort_order);

-- نقل الصور الحالية كأصول (مرة واحدة لكل شيك لم تُنقل صورته بعد).
INSERT INTO check_images (company_id, check_id, side, sort_order, original_data, created_by_user_id)
SELECT c.company_id, c.id, 'FRONT', 0, c.image_data, c.created_by_user_id
  FROM checks c
 WHERE c.image_data IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM check_images ci WHERE ci.check_id = c.id);
