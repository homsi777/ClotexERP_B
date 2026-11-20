-- GAP002: receiving offices are independent of customers and warehouses.
CREATE TABLE customer_order_offices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 code text NOT NULL, name text NOT NULL,
 is_active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,code), UNIQUE(company_id,id)
);
ALTER TABLE customer_orders
 ADD COLUMN received_office_id uuid REFERENCES customer_order_offices(id),
 ADD COLUMN received_office_name text,
 ADD COLUMN taken_by_employee_id uuid REFERENCES payroll_employees(id),
 ADD COLUMN taken_by_employee_name text,
 ADD COLUMN follow_up_employee_id uuid REFERENCES payroll_employees(id),
 ADD COLUMN follow_up_employee_name text,
 ADD COLUMN follow_up_user_id uuid REFERENCES users(id),
 ADD COLUMN follow_up_user_name text,
 ADD COLUMN sample_kind text,
 ADD COLUMN sample_status text CHECK(sample_status IN ('requested','received','approved','rejected')),
 ADD COLUMN sample_requested_date date,
 ADD COLUMN sample_received_date date,
 ADD COLUMN sample_approved_date date;
CREATE INDEX idx_customer_orders_office ON customer_orders(company_id,received_office_id);
CREATE INDEX idx_customer_orders_taken_by ON customer_orders(company_id,taken_by_employee_id);
CREATE INDEX idx_customer_orders_follow_employee ON customer_orders(company_id,follow_up_employee_id);
CREATE INDEX idx_customer_orders_follow_user ON customer_orders(company_id,follow_up_user_id);
