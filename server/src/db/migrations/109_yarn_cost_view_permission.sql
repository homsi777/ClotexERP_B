INSERT INTO permissions(code,name,category) VALUES('inventory.yarn.cost.view','عرض تكلفة الخيط','inventory') ON CONFLICT(code) DO NOTHING;
