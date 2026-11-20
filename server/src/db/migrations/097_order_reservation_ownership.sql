-- Ownership metadata for the existing roll status + inventory movement reservation cycle.
-- No second quantity balance: a reservation always owns one physical roll.
CREATE TABLE inventory_roll_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  roll_id uuid NOT NULL REFERENCES fabric_rolls(id) ON DELETE RESTRICT,
  reference_type text NOT NULL CHECK(reference_type IN ('DRAFT_SALE','CUSTOMER_ORDER_LINE')),
  reference_id uuid NOT NULL,
  reference_no text NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  released_by_user_id uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX inventory_roll_reservations_active ON inventory_roll_reservations(company_id,roll_id) WHERE released_at IS NULL;
CREATE INDEX inventory_roll_reservations_owner ON inventory_roll_reservations(company_id,reference_type,reference_id) WHERE released_at IS NULL;
-- Preserve unambiguous existing draft reservations. Ambiguous/manual owners require review.
INSERT INTO inventory_roll_reservations(company_id,roll_id,reference_type,reference_id,reference_no)
SELECT r.company_id,r.id,'DRAFT_SALE',(array_agg(DISTINCT i.id))[1],MIN(i.invoice_no)
FROM fabric_rolls r JOIN sales_invoice_lines l ON l.company_id=r.company_id AND l.fabric_roll_id=r.id
JOIN sales_invoices i ON i.company_id=l.company_id AND i.id=l.invoice_id AND i.document_status='DRAFT'
WHERE r.status='RESERVED' GROUP BY r.company_id,r.id HAVING COUNT(DISTINCT i.id)=1;
