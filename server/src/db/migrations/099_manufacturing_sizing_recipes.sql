-- Immutable recipe revisions; sizing orders keep the selected snapshot in recipe.
CREATE TABLE manufacturing_sizing_recipes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 code text NOT NULL CHECK(length(trim(code))>0),
 name text NOT NULL CHECK(length(trim(name))>0),
 revision integer NOT NULL CHECK(revision>0),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),
 recipe jsonb NOT NULL CHECK(jsonb_typeof(recipe)='object'),
 created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 approved_by_user_id uuid REFERENCES users(id), approved_at timestamptz,
 UNIQUE(company_id,code,revision), UNIQUE(company_id,id),
 CHECK((status='APPROVED')=(approved_at IS NOT NULL))
);
ALTER TABLE manufacturing_sizing_orders ADD COLUMN recipe_revision_id uuid,
 ADD COLUMN recipe_deviation_reason text,
 ADD CONSTRAINT manufacturing_sizing_recipe_revision_fk FOREIGN KEY(company_id,recipe_revision_id)
 REFERENCES manufacturing_sizing_recipes(company_id,id) ON DELETE RESTRICT;
