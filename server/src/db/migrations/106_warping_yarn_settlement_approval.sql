ALTER TABLE manufacturing_warping_yarn_issue_lines ADD COLUMN consumed_weight_kg numeric(12,3) CHECK(consumed_weight_kg>=0), ADD COLUMN approved_difference_kg numeric(12,3) CHECK(approved_difference_kg>=0);
CREATE TABLE manufacturing_yarn_settlement_proposals (
 company_id uuid NOT NULL, issue_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'), reason text NOT NULL,
 proposed_by_user_id uuid NOT NULL REFERENCES users(id), proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 approved_by_user_id uuid REFERENCES users(id),approved_at timestamptz,approval_reason text,
 PRIMARY KEY(company_id,issue_id), FOREIGN KEY(company_id,issue_id) REFERENCES manufacturing_warping_yarn_issues(company_id,id)
);
CREATE FUNCTION guard_pending_yarn_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='CLOSED' AND OLD.status='ISSUED' AND EXISTS(SELECT 1 FROM manufacturing_yarn_settlement_proposals p WHERE p.company_id=NEW.company_id AND p.issue_id=NEW.id AND p.approved_at IS NULL) THEN
  RAISE EXCEPTION 'يجب اعتماد التسوية المقترحة واستلام المرتجع قبل الإغلاق' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pending_yarn_settlement BEFORE UPDATE OF status ON manufacturing_warping_yarn_issues FOR EACH ROW EXECUTE FUNCTION guard_pending_yarn_settlement();
