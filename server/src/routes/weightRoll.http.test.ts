import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('roll entered by weight: quantity is the kg itself (no meters derived), width/gsm optional, cost per kg, roll-cut refused', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'wr_' + randomUUID().replaceAll('-', '');
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

    const a = randomUUID(), adm = randomUUID(), wh = randomUUID(), item = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع أ',true)", [a]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,'adm','x','admin',true)", [adm, a]);
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'W1','الرئيسي')", [wh, a]);
    await q("INSERT INTO fabric_items(id,company_id,name,internal_code,is_active) VALUES ($1,$2,'samre','K22',true)", [item, a]);
    const cust = randomUUID();
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C1','عميل')", [cust, a]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    await setCompanyActivationStatus(fakeClient as never, a, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const token = signAuthToken({ sub: adm, companyId: a, username: 'adm', role: 'admin', permissions: [] });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'GET' | 'POST', path: string, payload?: unknown) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as never });

    // بالوزن بلا عرض ولا gsm: الكمية = الكيلو نفسه
    const r = await call('POST', '/api/inventory/rolls', { entryBasis: 'WEIGHT', itemId: item, warehouseId: wh, lengthM: 999, actualWeightKg: 1000, unitCost: 3, barcode: '0001222' });
    assert.equal(r.statusCode, 201, r.body);
    const row = (await q("SELECT length_m::float AS q, actual_weight_kg::float AS kg, calculated_weight_kg, entry_basis, unit_cost::float AS c, width_cm, gsm FROM fabric_rolls WHERE barcode='0001222'"))[0];
    assert.deepEqual([row.q, row.kg, row.entry_basis, row.c], [1000, 1000, 'WEIGHT', 3], 'لا أمتار مشتقة: الكمية 1000 كغ وتكلفة 3 للكيلو');
    assert.equal(row.calculated_weight_kg, null); assert.equal(row.width_cm, null); assert.equal(row.gsm, null);
    // بلا وزن مرفوض
    assert.equal((await call('POST', '/api/inventory/rolls', { entryBasis: 'WEIGHT', itemId: item, warehouseId: wh, lengthM: 50 })).statusCode, 400);
    // توب بالمتر يبقى كما هو
    const m = await call('POST', '/api/inventory/rolls', { itemId: item, warehouseId: wh, lengthM: 80, widthCm: 150, gsm: 150, barcode: '0001223' });
    assert.equal(m.statusCode, 201, m.body);
    assert.equal((await q("SELECT length_m::float AS q, entry_basis FROM fabric_rolls WHERE barcode='0001223'"))[0].entry_basis, 'LENGTH');
    // القص بالمتر مرفوض لتوب الوزن
    const id = (await q("SELECT id FROM fabric_rolls WHERE barcode='0001222'"))[0].id as string;
    const cut = await call('POST', '/api/inventory/rolls/cut', { originalRollId: id, cutLengthM: 10, customerId: cust, deferPricing: true });
    assert.equal(cut.statusCode, 400, cut.body); assert.match(cut.body, /بالوزن/);
    assert.equal((await q('SELECT length_m::float AS q FROM fabric_rolls WHERE id=$1', [id]))[0].q, 1000, 'لم يُخصم شيء');
    // مجاميع الأمتار تستثني توب الوزن، والمسارات تعمل
    const items = await call('GET', '/api/fabric/items');
    assert.equal(items.statusCode, 200, items.body);
    const summ = await call('GET', '/api/reports/inventory-summary');
    assert.equal(summ.statusCode, 200, summ.body);
    assert.ok(!JSON.stringify(summ.json()).includes('1080'), 'مجموع الأمتار لا يضم 1000 كغ');
    assert.equal((await call('GET', '/api/inventory/rolls')).statusCode, 200);
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
