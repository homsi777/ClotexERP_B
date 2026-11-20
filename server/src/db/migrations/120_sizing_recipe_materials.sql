CREATE UNIQUE INDEX IF NOT EXISTS fabric_items_recipe_company_key ON fabric_items(company_id,id);
CREATE TABLE manufacturing_sizing_recipe_materials (
 company_id uuid NOT NULL,recipe_id uuid NOT NULL,item_id uuid NOT NULL,
 quantity_kg numeric(14,3) NOT NULL CHECK(quantity_kg>0),
 notes text NOT NULL DEFAULT '',PRIMARY KEY(company_id,recipe_id,item_id),
 FOREIGN KEY(company_id,recipe_id) REFERENCES manufacturing_sizing_recipes(company_id,id),
 FOREIGN KEY(company_id,item_id) REFERENCES fabric_items(company_id,id)
);
ALTER TABLE manufacturing_sizing_orders ADD COLUMN recipe_materials_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(recipe_materials_snapshot)='array');
