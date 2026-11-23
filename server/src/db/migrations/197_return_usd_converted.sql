-- المرتجع يرث قاعدة عملة المستند: بلا سعر صرف = يبقى بعملته ويُرحَّل بها (N-0022).
ALTER TABLE return_invoices ADD COLUMN IF NOT EXISTS usd_converted boolean NOT NULL DEFAULT true;
