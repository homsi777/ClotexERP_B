import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

/**
 * بحث الباركودات الجماعي (فاتورة البيع + إرسال المصنعية الخارجية): طلب واحد لدفعة كبيرة،
 * مطابقة تامة للباركود النصي (الأصفار البادئة)، نفس نطاق المستودعات، ونفس بنية الإدخال الفردي.
 */
test('bulk barcode lookup: exact text match, leading zeros, scope, large batch, equals single lookup', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'bl_' + randomUUID().replaceAll('-', '');
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

    const co = randomUUID(), adm = randomUUID(), scoped = randomUUID(), whA = randomUUID(), whB = randomUUID(), itemA = randomUUID(), itemB = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع',true)", [co]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,'adm','x','admin',true)", [adm, co]);
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$3,'WA','مخزن أ'),($2,$3,'WB','مخزن ب')", [whA, whB, co]);
    await q("INSERT INTO fabric_items(id,company_id,name,internal_code,is_active) VALUES ($1,$3,'قماش أ','A1',true),($2,$3,'قماش ب','B2',true)", [itemA, itemB, co]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    await setCompanyActivationStatus(fakeClient as never, co, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const token = signAuthToken({ sub: adm, companyId: co, username: 'adm', role: 'admin', permissions: [], isPlatformAdmin: false });
    const call = (method: 'GET' | 'POST', path: string, payload?: unknown, tk = token) => app.inject({ method, url: path, headers: { authorization: `Bearer ${tk}` }, payload: payload as never });

    // أتواب بالمتر (مستودعان) + توب بالكيلو
    const mk = async (body: Record<string, unknown>) => { const r = await call('POST', '/api/inventory/rolls', body); assert.equal(r.statusCode, 201, r.body); };
    await mk({ itemId: itemA, warehouseId: whA, lengthM: 80, widthCm: 150, gsm: 150, barcode: '0001001' });
    await mk({ itemId: itemA, warehouseId: whB, lengthM: 60, widthCm: 150, gsm: 150, barcode: '0001002' });
    await mk({ itemId: itemB, warehouseId: whA, entryBasis: 'WEIGHT', lengthM: 1, actualWeightKg: 500, unitCost: 3, barcode: '0001003' });
    await mk({ itemId: itemB, warehouseId: whA, lengthM: 40, widthCm: 150, gsm: 150, barcode: '0001004' });
    await q("UPDATE fabric_rolls SET status='SOLD' WHERE barcode='0001004'");
    // 500 توباً إضافياً لاختبار الدفعة الكبيرة
    const big: string[] = [];
    for (let i = 0; i < 500; i++) { const b = `9${String(i).padStart(6, '0')}`; big.push(b); await mk({ itemId: itemA, warehouseId: whA, lengthM: 10 + (i % 7), widthCm: 150, gsm: 150, barcode: b }); }

    // 1) دفعة واحدة: 500 باركود + مكرر + غير موجود + أتواب خاصة، بطلب واحد
    const asked = ['0001001', '0001002', '0001003', '0001004', '1001', 'غير-موجود', ...big];
    const r = await call('POST', '/api/inventory/rolls/bulk-lookup', { barcodes: [...asked, '0001001'] });
    assert.equal(r.statusCode, 200, r.body);
    const got = r.json().data as Array<Record<string, unknown>>;
    assert.equal(got.length, 4 + 500, 'كل التوافقات التامة فقط — «1001» (بلا أصفار) لا يطابق «0001001»');
    const by = new Map(got.map((x) => [String(x.barcode), x]));
    assert.ok(by.has('0001001') && !by.has('1001') && !by.has('غير-موجود'));
    assert.equal(by.get('0001004')!.status, 'SOLD');
    assert.equal(by.get('0001003')!.entry_basis, 'WEIGHT');
    assert.equal(by.get('0001002')!.warehouse_name, 'مخزن ب');

    // 2) مطابقة الإدخال الفردي: نفس الحقول لنفس التوب
    for (const b of ['0001001', '0001002', '0001003', '0001004', big[7], big[499]]) {
      const single = (await call('GET', `/api/inventory/rolls?barcode=${b}&pageSize=10`)).json().data as Array<Record<string, unknown>>;
      const exact = single.find((x) => x.barcode === b)!;
      const bulk = by.get(b)!;
      for (const k of ['id', 'barcode', 'item_name', 'internal_code', 'color_code', 'length_m', 'actual_weight_kg', 'calculated_weight_kg', 'entry_basis', 'status', 'warehouse_id', 'warehouse_name', 'location_name', 'lot_no', 'unit_cost', 'draft_sales_invoice_id']) {
        assert.deepEqual(bulk[k] ?? null, exact[k] ?? null, `${b}.${k}`);
      }
    }

    // 3) التحقق من الحدود
    assert.equal((await call('POST', '/api/inventory/rolls/bulk-lookup', { barcodes: [] })).statusCode, 400);
    assert.equal((await call('POST', '/api/inventory/rolls/bulk-lookup', { barcodes: Array.from({ length: 2001 }, (_, i) => String(i)) })).statusCode, 400);

    // 4) مستخدم مقيَّد بمستودع أ لا يرى توب مستودع ب
    await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,'wk','x','warehouse_keeper',true)", [scoped, co]);
    await q('INSERT INTO user_warehouses(user_id,company_id,warehouse_id) VALUES ($1,$2,$3)', [scoped, co, whA]).catch(() => undefined);
    const tkScoped = signAuthToken({ sub: scoped, companyId: co, username: 'wk', role: 'warehouse_keeper', permissions: ['inventory.view'], isPlatformAdmin: false, warehouseIds: [whA] } as never);
    const rs = await call('POST', '/api/inventory/rolls/bulk-lookup', { barcodes: ['0001001', '0001002'] }, tkScoped);
    if (rs.statusCode === 200) {
      const codes = (rs.json().data as Array<{ barcode: string }>).map((x) => x.barcode);
      assert.ok(!codes.includes('0001002'), 'توب مستودع ب خارج النطاق');
    }
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
