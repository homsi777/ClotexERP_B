-- قوالب صلاحيات مسمّاة (ملاحظة بشير: أدوار مخصصة بأسماء من عنده).
-- القالب مجموعة أكواد مصفوفة تُطبَّق على مستخدم (نسخ) — لا تغيّر أي صلاحية قائمة.
CREATE TABLE IF NOT EXISTS permission_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  codes text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
