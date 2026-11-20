-- GAP006: one reusable durable inbox, explicit recipients, transactional phase outbox.
-- Depends on 101_customer_order_metadata.sql. No posting or inventory changes.
CREATE UNIQUE INDEX notification_users_company_key ON users(company_id,id);
CREATE UNIQUE INDEX notification_employees_company_key ON payroll_employees(company_id,id);
CREATE UNIQUE INDEX notification_orders_company_key ON customer_orders(company_id,id);
CREATE TABLE app_notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 source text NOT NULL, entity_id uuid NOT NULL, line_id uuid,
 event_kind text NOT NULL, dedupe_key text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), resolved_at timestamptz,
 UNIQUE(company_id,dedupe_key), UNIQUE(company_id,id)
);
CREATE INDEX app_notifications_entity ON app_notification_events(company_id,source,entity_id);
CREATE TABLE app_notification_recipients (
 company_id uuid NOT NULL, notification_id uuid NOT NULL, user_id uuid NOT NULL,
 read_at timestamptz, revoked_at timestamptz, delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,notification_id,user_id),
 FOREIGN KEY(company_id,notification_id) REFERENCES app_notification_events(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
);
CREATE INDEX app_notification_inbox ON app_notification_recipients(company_id,user_id,delivered_at DESC);
CREATE INDEX app_notification_unread ON app_notification_recipients(company_id,user_id) WHERE read_at IS NULL;
CREATE TABLE customer_order_notification_employee_users (
 company_id uuid NOT NULL, employee_id uuid NOT NULL, user_id uuid NOT NULL,
 PRIMARY KEY(company_id,employee_id),
 FOREIGN KEY(company_id,employee_id) REFERENCES payroll_employees(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
);
-- When an order ENTERS this status, notify the explicitly configured next-stage user as well.
CREATE TABLE customer_order_notification_phase_users (
 company_id uuid NOT NULL REFERENCES companies(id), phase text NOT NULL
 CHECK(phase IN ('pending_supply','partial_ready','ready_pickup')),
 user_id uuid NOT NULL, PRIMARY KEY(company_id,phase),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
);
CREATE TABLE customer_order_notification_phase_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 order_id uuid NOT NULL, from_phase text NOT NULL, to_phase text NOT NULL,
 happened_at timestamptz NOT NULL DEFAULT clock_timestamp(), processed_at timestamptz,
 FOREIGN KEY(company_id,order_id) REFERENCES customer_orders(company_id,id) ON DELETE CASCADE
);
CREATE INDEX order_notification_phase_pending ON customer_order_notification_phase_outbox(company_id,order_id) WHERE processed_at IS NULL;
CREATE TABLE customer_order_notification_stock_state (
 company_id uuid NOT NULL, order_id uuid NOT NULL, line_id uuid NOT NULL,
 available boolean NOT NULL DEFAULT false, generation integer NOT NULL DEFAULT 0,
 PRIMARY KEY(company_id,order_id,line_id),
 FOREIGN KEY(company_id,order_id) REFERENCES customer_orders(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(line_id) REFERENCES customer_order_lines(id) ON DELETE CASCADE
);
CREATE FUNCTION capture_customer_order_notification_phase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO customer_order_notification_phase_outbox(company_id,order_id,from_phase,to_phase)
  VALUES(NEW.company_id,NEW.id,OLD.status,NEW.status);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER customer_order_notification_phase AFTER UPDATE OF status ON customer_orders
 FOR EACH ROW EXECUTE FUNCTION capture_customer_order_notification_phase();
