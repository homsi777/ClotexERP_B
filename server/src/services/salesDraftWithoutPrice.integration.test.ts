import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('sales invoice draft: saved without price (customer + goods), price required to confirm', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'sdraft_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const { createSalesInvoice, updateSalesInvoiceDraft } = await import('./salesInvoiceService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
    const company = randomUUID(), customer = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'SD','sd test')", [company]);
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C1','Customer one')", [customer, company]);
    await q("INSERT INTO currencies(code,name,symbol,is_active) VALUES ('USD','USD','$',true) ON CONFLICT (code) DO NOTHING");

    const line = (price: number) => ({ description: 'Poplin white', quantity: 25, unit: 'meter', unitPrice: price, lineTotal: price * 25 });
    const body = (price: number, confirm: boolean) => ({
      invoiceNo: 'AUTO', invoiceDate: '2026-11-21', customerId: customer, currencyCode: 'USD', exchangeRateToUsd: 1,
      subtotal: price * 25, discountTotal: 0, taxTotal: 0, totalAmount: price * 25, paidAmount: 0, remainingAmount: price * 25,
      lines: [line(price)], confirm,
    });

    // 1) مسودة بلا سعر: تُحفظ
    const draft = await createSalesInvoice(client, company, null, body(0, false));
    assert.equal(draft.documentStatus, 'DRAFT');
    assert.equal(Number((await q('SELECT unit_price FROM sales_invoice_lines WHERE invoice_id=$1', [draft.id]))[0].unit_price), 0);

    // 2) إنشاء مع ترحيل بلا سعر مرفوض
    await assert.rejects(() => createSalesInvoice(client, company, null, body(0, true)), /غير صالحة/);

    // 3) المحاسب يسعّر المسودة (تحديث المسودة بسعر) ثم تبقى مسودة
    await updateSalesInvoiceDraft(client, company, null, draft.id, body(4, false));
    assert.equal(Number((await q('SELECT unit_price FROM sales_invoice_lines WHERE invoice_id=$1', [draft.id]))[0].unit_price), 4);
    // 4) تحديث المسودة بلا سعر لا يُرفض أيضاً
    await updateSalesInvoiceDraft(client, company, null, draft.id, body(0, false));
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
