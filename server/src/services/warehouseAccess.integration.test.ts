import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { assertRollsInScope, assertWarehouseAllowed, listUserWarehouses, loadUserWarehouseScope, saveUserWarehouses, warehouseAllowed } from './warehouseAccess.js';
import { listSalesInvoices } from './salesInvoiceService.js';

test('user warehouse scope: assignment, unrestricted default, roll check, invoice list filter, branch isolation', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'whs_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const c1 = randomUUID(), c2 = randomUUID(), boss = randomUUID(), staff = randomUUID(), adm = randomUUID(), cust = randomUUID();
    const w1 = randomUUID(), w2 = randomUUID(), w3 = randomUUID(), wOther = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'A','a'),($2,'B','b')", [c1, c2]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$4,'boss','x','accountant'),($2,$4,'staff','x','viewer'),($3,$4,'adm','x','admin')", [boss, staff, adm, c1]);
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C','عميل')", [cust, c1]);
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$4,'W1','أول'),($2,$4,'W2','ثانٍ'),($3,$4,'W3','ثالث'),($5,$6,'X','فرع آخر')", [w1, w2, w3, c1, wOther, c2]);

    // الافتراضي: بلا تقييد
    assert.equal(await loadUserWarehouseScope(client, staff, 'viewer'), null);

    // تعيين مستودعين
    await saveUserWarehouses(client, { companyId: c1, userId: staff, warehouseIds: [w1, w2], changedBy: boss });
    const scope = await loadUserWarehouseScope(client, staff, 'viewer');
    assert.deepEqual([...scope!].sort(), [w1, w2].sort());
    assert.ok(warehouseAllowed(scope, w1) && !warehouseAllowed(scope, w3));
    assert.throws(() => assertWarehouseAllowed(scope, w3), /غير مخصّص/);
    assert.throws(() => assertWarehouseAllowed(scope, null), /غير مخصّص/, 'ثوب بلا مستودع لا يُسمح به للمقيَّد');

    // المدير لا يُقيَّد، ومستودع فرع آخر مرفوض
    assert.equal(await loadUserWarehouseScope(client, adm, 'admin'), null);
    await assert.rejects(() => saveUserWarehouses(client, { companyId: c1, userId: adm, warehouseIds: [w1], changedBy: boss }), /لا يمكن تقييد/);
    await assert.rejects(() => saveUserWarehouses(client, { companyId: c1, userId: staff, warehouseIds: [wOther], changedBy: boss }), /مستودع غير صالح/);

    // أتواب: داخل المسموح تمر، خارجه ترفض
    const item = randomUUID(), r1 = randomUUID(), r3 = randomUUID();
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'I','قماش')", [item, c1]);
    await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,warehouse_id,length_m) VALUES ($1,$3,'A1',$4,$5,10),($2,$3,'A3',$4,$6,10)", [r1, r3, c1, item, w1, w3]);
    await assertRollsInScope(client, c1, scope, [r1]);
    await assert.rejects(() => assertRollsInScope(client, c1, scope, [r1, r3]), /غير مخصّص/);
    await assertRollsInScope(client, c1, null, [r3]);

    // فواتير: المقيَّد يرى فواتير مستودعاته فقط
    for (const [no, w] of [['S1', w1], ['S3', w3]] as const) {
      await q(`INSERT INTO sales_invoices(company_id,invoice_no,customer_id,invoice_date,currency_code,warehouse_id,subtotal,total_amount,remaining_amount)
               VALUES ($1,$2,$3,'2026-11-01','USD',$4,10,10,10)`, [c1, no, cust, w]);
    }
    const all = await listSalesInvoices(client, c1, {});
    assert.equal(all.total, 2);
    const mine = await listSalesInvoices(client, c1, { warehouseScope: scope });
    assert.equal(mine.total, 1);

    // إزالة التقييد
    await saveUserWarehouses(client, { companyId: c1, userId: staff, warehouseIds: [], changedBy: boss });
    assert.equal(await loadUserWarehouseScope(client, staff, 'viewer'), null);
    assert.deepEqual(await listUserWarehouses(client, staff), []);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
