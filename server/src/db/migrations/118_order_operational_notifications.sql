ALTER TABLE customer_order_notification_phase_users DROP CONSTRAINT customer_order_notification_phase_users_phase_check;
ALTER TABLE customer_order_notification_phase_users ADD CONSTRAINT customer_order_notification_phase_users_phase_check CHECK(phase IN
 ('pending_supply','partial_ready','ready_pickup','STOCK_CHECK','PLANNING','WARPING','SIZING','WEAVING','QUALITY','RAW_STORED','EXTERNAL_PROCESSING','READY','DELIVERED','MULTIPLE'));
CREATE TABLE customer_order_notification_line_phases (
 company_id uuid NOT NULL,order_id uuid NOT NULL,line_id uuid NOT NULL,phase text NOT NULL,generation integer NOT NULL DEFAULT 1,
 PRIMARY KEY(company_id,line_id),
 FOREIGN KEY(company_id,order_id,line_id) REFERENCES customer_order_lines(company_id,order_id,id) ON DELETE CASCADE
);
