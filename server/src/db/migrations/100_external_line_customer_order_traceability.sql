ALTER TABLE external_jobs ADD COLUMN traceability_only boolean NOT NULL DEFAULT false;
-- GAP-011: traceability only; no cost allocation, GL posting or stock movement.
ALTER TABLE customer_orders ADD CONSTRAINT external_order_company_key UNIQUE(company_id,id);
ALTER TABLE customer_order_lines ADD CONSTRAINT external_order_line_company_key UNIQUE(company_id,order_id,id);
ALTER TABLE external_job_lines
  ADD COLUMN customer_order_id uuid,
  ADD COLUMN customer_order_line_id uuid,
  ADD CONSTRAINT external_order_required CHECK(customer_order_line_id IS NULL OR customer_order_id IS NOT NULL),
  ADD CONSTRAINT external_line_order_fk FOREIGN KEY(company_id,customer_order_id) REFERENCES customer_orders(company_id,id),
  ADD CONSTRAINT external_line_color_fk FOREIGN KEY(company_id,customer_order_id,customer_order_line_id) REFERENCES customer_order_lines(company_id,order_id,id);
CREATE INDEX external_lines_customer_order ON external_job_lines(company_id,customer_order_id,customer_order_line_id) WHERE customer_order_id IS NOT NULL;
ALTER TABLE external_job_lines ADD CONSTRAINT external_line_trace_key UNIQUE(company_id,job_id,id);
ALTER TABLE external_job_return_lines
  ADD COLUMN customer_order_id uuid,
  ADD COLUMN customer_order_line_id uuid,
  ADD CONSTRAINT external_return_source_company_fk FOREIGN KEY(company_id,job_id,source_line_id) REFERENCES external_job_lines(company_id,job_id,id),
  ADD CONSTRAINT external_return_order_fk FOREIGN KEY(company_id,customer_order_id) REFERENCES customer_orders(company_id,id),
  ADD CONSTRAINT external_return_color_fk FOREIGN KEY(company_id,customer_order_id,customer_order_line_id) REFERENCES customer_order_lines(company_id,order_id,id);
CREATE INDEX external_returns_customer_order ON external_job_return_lines(company_id,customer_order_id,customer_order_line_id) WHERE customer_order_id IS NOT NULL;

CREATE FUNCTION external_return_inherit_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT l.customer_order_id,l.customer_order_line_id INTO NEW.customer_order_id,NEW.customer_order_line_id
    FROM external_job_lines l WHERE l.company_id=NEW.company_id AND l.job_id=NEW.job_id AND l.id=NEW.source_line_id;
  RETURN NEW;
END $$;
CREATE TRIGGER external_return_order BEFORE INSERT OR UPDATE ON external_job_return_lines
  FOR EACH ROW EXECUTE FUNCTION external_return_inherit_order();

CREATE FUNCTION external_dispatch_guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.customer_order_id IS NULL THEN
    SELECT q.customer_order_id,q.customer_order_line_id INTO NEW.customer_order_id,NEW.customer_order_line_id
      FROM external_job_return_lines q WHERE q.company_id=NEW.company_id AND q.result_roll_id=NEW.roll_id;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.customer_order_id IS DISTINCT FROM OLD.customer_order_id OR NEW.customer_order_line_id IS DISTINCT FROM OLD.customer_order_line_id)
    AND (OLD.line_status<>'SENT' OR EXISTS(SELECT 1 FROM external_job_return_lines q WHERE q.company_id=OLD.company_id AND q.source_line_id=OLD.id)) THEN
    RAISE EXCEPTION 'لا يمكن تغيير تتبع سطر بدأ استلامه' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER external_dispatch_order BEFORE INSERT OR UPDATE ON external_job_lines
  FOR EACH ROW EXECUTE FUNCTION external_dispatch_guard_order();

-- Historical rows remain unassigned: do not infer orders from costing links.
