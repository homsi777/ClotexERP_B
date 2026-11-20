-- Explicit, version-pinned defaults; no changes to approved specification snapshots.
CREATE UNIQUE INDEX IF NOT EXISTS fabric_items_company_identity ON fabric_items(company_id,id);
CREATE TABLE manufacturing_item_specifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 item_id uuid NOT NULL,
 specification_id uuid,
 specification_version_id uuid,
 revision integer NOT NULL CHECK(revision>0),
 reason text NOT NULL CHECK(length(trim(reason))>0),
 created_by_user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 superseded_at timestamptz,
 UNIQUE(company_id,item_id,revision),
 CHECK ((specification_id IS NULL) = (specification_version_id IS NULL)),
 FOREIGN KEY(company_id,item_id) REFERENCES fabric_items(company_id,id),
 FOREIGN KEY(company_id,created_by_user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,specification_id,specification_version_id)
 REFERENCES manufacturing_specification_versions(company_id,specification_id,id)
);
CREATE UNIQUE INDEX manufacturing_item_specifications_current ON manufacturing_item_specifications(company_id,item_id) WHERE superseded_at IS NULL;
CREATE FUNCTION guard_manufacturing_item_specification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mapping history is immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL OR
   (to_jsonb(NEW)-'superseded_at') IS DISTINCT FROM (to_jsonb(OLD)-'superseded_at') THEN
   RAISE EXCEPTION 'Mapping history is immutable';
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM fabric_items WHERE company_id=NEW.company_id AND id=NEW.item_id AND is_active)
   OR NOT EXISTS(SELECT 1 FROM users WHERE company_id=NEW.company_id AND id=NEW.created_by_user_id)
   OR (NEW.specification_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM manufacturing_specification_versions v JOIN manufacturing_specifications s ON s.company_id=v.company_id AND s.id=v.specification_id WHERE v.company_id=NEW.company_id AND v.id=NEW.specification_version_id AND v.specification_id=NEW.specification_id AND v.status='APPROVED' AND s.is_active)) THEN
   RAISE EXCEPTION 'Mapping references must be active, approved and company scoped' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manufacturing_item_specification_guard BEFORE INSERT OR UPDATE OR DELETE ON manufacturing_item_specifications FOR EACH ROW EXECUTE FUNCTION guard_manufacturing_item_specification();
