-- TASK 008 Phase 1: حتى الآن، لا مسار تقارير واحد (69 مساراً بـreportRoutes.ts)
-- كان يتحقق من صلاحية 'reports.view' فعلياً بالخادم (authenticateRequest فقط
-- تتحقق من تسجيل الدخول) — بمعنى أن أي مستخدم مسجَّل دخول، بأي دور، كان
-- يستطيع فعلياً الوصول لكل التقارير بما فيها الحساسة (أرباح/تكاليف/رواتب/
-- خزينة)، بصرف النظر عما مُنح له بجدول role_permissions.

-- الآن بعد تفعيل الفحص الفعلي بالكود (reportRoutes.ts)، نُبقي على نفس سلوك
-- الوصول الحالي للتقارير العامة (دون تخفيض صلاحيات أي مستخدم موجود فجأة):
-- منح 'reports.view' لكل الأدوار الموجودة فعلاً إن لم تملكه بالفعل.
INSERT INTO permissions (code, name, category)
VALUES
  ('reports.view', 'عرض التقارير', 'reports'),
  ('reports.financial.view', 'عرض التقارير المالية الحساسة (أرباح، تكاليف، رواتب، خزينة)', 'reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code = 'reports.view'
ON CONFLICT DO NOTHING;

-- 'reports.financial.view' عمداً غير مُمنوحة تلقائياً لأي دور غير admin —
-- هذا هو هدف الإصلاح الأمني نفسه (P0): تقييد الوصول للتقارير المالية
-- الحساسة فقط لمن يُمنح الصلاحية صريحاً من صفحة إدارة الصلاحيات. دور admin
-- يتجاوز كل فحوصات الصلاحية بالكود بغض النظر عن هذا الجدول، فلا حاجة لمنحه
-- هنا أيضاً.
