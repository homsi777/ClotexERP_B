-- ملاحظة بشير: إضافة السعر والتسعير في الأوردر صلاحية يمكن منحها.
INSERT INTO permissions (code, name, category)
VALUES ('orders.price', 'تسعير أوردرات العملاء', 'orders')
ON CONFLICT (code) DO NOTHING;

-- حتى لا يتغيّر سلوك اليوم: تُمنح للأدوار التي كانت تدخل الأسعار (المدير، مدير العمليات، المحاسب).
-- دور «المخزون» لا يُمنحها عمداً، ويمكن للمدير منحها لأي دور لاحقاً.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.code IN ('admin', 'manager', 'accountant')
   AND p.code = 'orders.price'
ON CONFLICT DO NOTHING;
