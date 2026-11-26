-- N-0094: وحدة الكيلو على سطور المرتجع (سطر بيع/شراء بالكيلو يُرجَع بالكيلو ولا يُحتسب أمتاراً في التقارير)
ALTER TABLE return_invoice_lines DROP CONSTRAINT IF EXISTS return_invoice_lines_unit_chk;
ALTER TABLE return_invoice_lines
  ADD CONSTRAINT return_invoice_lines_unit_chk CHECK (unit IN ('meter', 'yard', 'kg'));
