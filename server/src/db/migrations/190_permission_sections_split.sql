-- تقسيم وحدات الصلاحيات: الكارتيلات ← (توليد/مكتبة) + (عهدة وتسليم)، والمصنعية الخارجية ← (مهام) + (إدخال المصنعية)، وإضافة «الشركاء».
-- من كانت له صلاحيات الوحدة الأم يحتفظ بما كان يستطيعه (تُنسخ منحاته للوحدة المنفصلة) كي لا تضيع صلاحيات قائمة.
INSERT INTO user_permission_grants (user_id, company_id, permission_code, granted_by)
SELECT user_id, company_id, regexp_replace(permission_code, '^p:cartela\.', 'p:cartela.custody.'), granted_by
  FROM user_permission_grants WHERE permission_code LIKE 'p:cartela.%' AND permission_code NOT LIKE 'p:cartela.custody.%'
ON CONFLICT (user_id, permission_code) DO NOTHING;

INSERT INTO user_permission_grants (user_id, company_id, permission_code, granted_by)
SELECT user_id, company_id, regexp_replace(permission_code, '^p:external\.jobs\.', 'p:external.entry.'), granted_by
  FROM user_permission_grants WHERE permission_code IN ('p:external.jobs.view', 'p:external.jobs.create', 'p:external.jobs.edit', 'p:external.jobs.delete', 'p:external.jobs.print')
ON CONFLICT (user_id, permission_code) DO NOTHING;

-- «الشركاء» كانت صفحة بلا وحدة: من كان يراها (وضع مخصّص) يحتفظ برؤيتها فقط إن كانت له صلاحية عامة ما — لا منح تلقائي.
