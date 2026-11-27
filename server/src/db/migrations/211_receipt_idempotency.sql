-- N-0097: منع تكرار الاستلام عند تكرار الضغط على «حفظ» أو إعادة إرسال نفس الطلب
ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS client_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_receipts_client_request_uq ON purchase_receipts (company_id, client_request_id) WHERE client_request_id IS NOT NULL;
