import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('purchase catalog + operating warehouses: no duplicate items, receipt feeds operating stock, disposal tracked and never negative, cash/credit stored', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'opw_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    let sp = 0;
    const fakeClient = {
      query: (sql: string, params?: unknown[]) => {
        const t = String(sql).trim().toUpperCase();
        if (t === 'BEGIN' || t.startsWith('BEGIN ')) return db.query(`SAVEPOINT sp${++sp}`);
        if (t === 'COMMIT') return db.query(`RELEASE SAVEPOINT sp${sp--}`);
        if (t === 'ROLLBACK') return db.query(`ROLLBACK TO SAVEPOINT sp${sp--}`);
        return db.query(sql, params);
      },
      release: () => undefined, on: () => undefined,
    };
    setPoolOverrideForTests({ connect: async () => fakeClient, query: (sql: string, params?: unknown[]) => db.query(sql, params), on: () => undefined });
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const a = randomUUID(), acc = randomUUID(), wk = randomUUID(), sup = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع أ',true)", [a]);
    const mk = (id: string, name: string, role: string) => q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,$3,'x',$4,true)", [id, a, name, role]);
    await mk(acc, 'acc', 'accountant'); await mk(wk, 'wk', 'inventory');
    await q("INSERT INTO suppliers(id,company_id,code,name) VALUES ($1,$2,'S1','مورد المواد')", [sup, a]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    await setCompanyActivationStatus(fakeClient as never, a, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const tok = (id: string, name: string, role: string, perms: string[]) => signAuthToken({ sub: id, companyId: a, username: name, role, permissions: perms });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'GET' | 'POST' | 'PATCH', path: string, token: string, payload?: unknown) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
    const tAcc = tok(acc, 'acc', 'accountant', ['purchases.view', 'purchases.manage']), tWk = tok(wk, 'wk', 'inventory', ['inventory.view', 'inventory.manage']);
    const today = new Date().toISOString().slice(0, 10);

    // مستودع تشغيلي (للمخزني) ثم بند مرجعي (للمحاسب) ثم منع التكرار
    const whRes = await call('POST', '/api/purchase-receiving/operating/warehouses', tWk, { name: 'مستودع الإكسسوارات' });
    assert.equal(whRes.statusCode, 201, whRes.body);
    const whId = whRes.json().data.id as string;
    assert.equal((await call('POST', '/api/purchase-receiving/operating/warehouses', tWk, { name: 'مستودع الإكسسوارات' })).statusCode, 409, 'اسم المستودع لا يتكرر');
    const item = { materialKind: 'OTHER', name: 'كراتين تغليف', defaultUnit: 'piece', operatingWarehouseId: whId };
    const c1 = await call('POST', '/api/purchase-invoices/catalog', tAcc, item);
    assert.equal(c1.statusCode, 201, c1.body);
    const catId = c1.json().data.id as string;
    assert.equal((await call('POST', '/api/purchase-invoices/catalog', tAcc, { ...item, name: 'كراتين تغليف ' })).statusCode, 409, 'بند مكرر مرفوض');
    assert.equal(((await call('GET', '/api/purchase-invoices/catalog?kind=OTHER', tAcc)).json().data as unknown[]).length, 1);

    // فاتورة آجلة بالاستلام عبر المخزن، ببند مرجعي من المواد الأخرى
    const { createPurchaseInvoice } = await import('../services/purchaseInvoiceService.js');
    const inv = await createPurchaseInvoice(fakeClient as never, a, acc, {
      invoiceNo: 'x', supplierInvoiceNo: 'S-1', invoiceDate: today, supplierId: sup, currencyCode: 'USD', convertToUsd: true, receiveViaWarehouse: true, paymentMethod: 'CREDIT',
      subtotal: 100, discountTotal: 0, taxTotal: 0, totalAmount: 100, paidAmount: 0, remainingAmount: 100, confirm: true,
      lines: [{ description: 'كراتين تغليف', quantity: 100, unit: 'piece', unitPrice: 1, lineDiscount: 0, lineTax: 0, lineTotal: 100, materialKind: 'OTHER', catalogItemId: catId, metadata: {} }],
    } as never);
    assert.equal((await q('SELECT payment_method FROM purchase_invoices WHERE id=$1', [inv.id]))[0].payment_method, 'CREDIT');
    const invLine = (await q('SELECT id, catalog_item_id FROM purchase_invoice_lines WHERE invoice_id=$1', [inv.id]))[0];
    assert.equal(invLine.catalog_item_id, catId);

    // استلام 60 قطعة بلا مستودع أقمشة: يدخل المستودع التشغيلي (الافتراضي للبند)
    const rc = await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv.id, lines: [{ invoiceLineId: invLine.id, materialKind: 'OTHER', unit: 'piece', quantity: 60 }] });
    assert.equal(rc.statusCode, 201, rc.body);
    let stock = (await call('GET', `/api/purchase-receiving/operating/warehouses/${whId}/stock`, tWk)).json().data as Array<{ quantity: number; received: number; disposed: number }>;
    assert.equal(stock[0].quantity, 60); assert.equal(stock[0].received, 60);

    // تصريف 25 استهلاكاً ثم رفض تجاوز الرصيد
    const d1 = await call('POST', '/api/purchase-receiving/operating/dispose', tWk, { warehouseId: whId, catalogItemId: catId, quantity: 25, type: 'CONSUMPTION', notes: 'تغليف طلبية' });
    assert.equal(d1.statusCode, 200, d1.body); assert.equal(d1.json().data.remaining, 35);
    assert.equal((await call('POST', '/api/purchase-receiving/operating/dispose', tWk, { warehouseId: whId, catalogItemId: catId, quantity: 36, type: 'WASTE' })).statusCode, 400, 'لا تصريف فوق الرصيد');
    stock = (await call('GET', `/api/purchase-receiving/operating/warehouses/${whId}/stock`, tWk)).json().data;
    assert.deepEqual([stock[0].quantity, stock[0].received, stock[0].disposed], [35, 60, 25]);
    const moves = (await call('GET', `/api/purchase-receiving/operating/warehouses/${whId}/movements`, tWk)).json().data as Array<{ type: string }>;
    assert.deepEqual(moves.map((m) => m.type).sort(), ['CONSUMPTION', 'RECEIPT']);
    // لا مال في استجابات المستودع التشغيلي
    assert.ok(!/price|cost|total|amount/i.test(JSON.stringify(stock) + JSON.stringify(moves)), 'بلا بيانات مالية');
    // المحاسب (دور) لا يصرّف
    assert.equal((await call('POST', '/api/purchase-receiving/operating/dispose', tok(acc, 'acc', 'accountant', []), { warehouseId: whId, catalogItemId: catId, quantity: 1, type: 'WASTE' })).statusCode, 403);
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
