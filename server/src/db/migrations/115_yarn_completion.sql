-- Package labels have no independently spendable balance. Parent lot is stock authority.
CREATE UNIQUE INDEX IF NOT EXISTS yarn_lots_company_identity ON yarn_lots(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS fabric_items_company_identity ON fabric_items(company_id,id);
CREATE TABLE IF NOT EXISTS yarn_package_labels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 yarn_lot_id uuid NOT NULL REFERENCES yarn_lots(id),
 package_number integer NOT NULL CHECK(package_number BETWEEN 1 AND 1000),
 barcode text NOT NULL,
 nominal_weight_kg numeric(12,3) NOT NULL CHECK(nominal_weight_kg>0),
 UNIQUE(company_id,barcode), UNIQUE(company_id,yarn_lot_id,package_number),
 FOREIGN KEY(company_id,yarn_lot_id) REFERENCES yarn_lots(company_id,id)
);
CREATE TABLE IF NOT EXISTS yarn_minimum_stock (
 company_id uuid NOT NULL REFERENCES companies(id),
 item_id uuid NOT NULL REFERENCES fabric_items(id),
 minimum_kg numeric(12,3) NOT NULL CHECK(minimum_kg>=0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,item_id),
 FOREIGN KEY(company_id,item_id) REFERENCES fabric_items(company_id,id)
);
INSERT INTO permissions(code,name,category) VALUES
 ('inventory.yarn.receiving','استلام الغزول','inventory'),
 ('inventory.yarn.profile','تصنيفات الغزول والحد الأدنى','inventory'),
 ('inventory.yarn.transfer','نقل الغزول','inventory'),
 ('inventory.yarn.external','الغزول الخارجية','inventory'),
 ('inventory.yarn.import','استيراد جرد الغزول','inventory'),
 ('inventory.yarn.settlement','تسوية الغزول واعتماد الفاقد','inventory')
 ON CONFLICT(code) DO NOTHING;
-- Deliberately no blanket role grants: configure granular assignments via existing roles.

ALTER TABLE fabric_items ADD COLUMN weight_material_kind text
 CHECK(weight_material_kind IN ('YARN','CONSUMABLE'));
ALTER TABLE yarn_external_dispatches ADD COLUMN customer_order_id uuid;
ALTER TABLE yarn_external_dispatches ADD CONSTRAINT yarn_external_customer_order_company_fk
 FOREIGN KEY(company_id,customer_order_id) REFERENCES customer_orders(company_id,id);
CREATE INDEX yarn_external_customer_order ON yarn_external_dispatches(company_id,customer_order_id) WHERE customer_order_id IS NOT NULL;
