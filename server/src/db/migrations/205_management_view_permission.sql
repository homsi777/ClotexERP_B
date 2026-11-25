-- لوحة إدارة الفرع صلاحية يمنحها المالك صراحةً (لا تظهر تلقائياً لدور المدير أو المحاسب).
INSERT INTO permissions(code, name, category) VALUES ('management.view', 'عرض لوحة إدارة الفرع ومركز التنبيهات', 'general') ON CONFLICT (code) DO NOTHING;
