import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

/**
 * QR لصاقة الكارتيلة صار يوجّه للموقع الرسمي، فيجب أن يبقى البحث بالباركود العادي (الرقم التسلسلي المطبوع)
 * يعمل في كل المسارات: عهدة الكارتيلات (resolveScan) ومسار الأوردر (/api/cartela/lookup)،
 * وأن تبقى لصاقات QR القديمة (CLOTEX|ART|DESIGN|SERIAL) قابلة للمسح، وأن رابط الموقع لا يكسر شيئاً.
 */
test('cartela barcode lookup works everywhere after QR moved to the company website', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'cs_' + randomUUID().replaceAll('-', '');
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
    const company = randomUUID(), user = randomUUID(), cart = randomUUID();
    await db.query("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع',true)", [company]);
    await db.query("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,'adm','x','admin',true)", [user, company]);
    await db.query("INSERT INTO cartela_labels(id,company_id,title,art_code,design_no,serial_no) VALUES ($1,$2,'ANDRIA OXFORD','ANDRIA OXFORD','7201','0004')", [cart, company]);
    await db.query('INSERT INTO cartela_stock_levels(company_id,cartela_label_id,quantity) VALUES ($1,$2,5)', [company, cart]);

    // 1) عهدة الكارتيلات: الباركود العادي = الرقم التسلسلي المطبوع على الستيكر
    const { resolveScan, CustodyError } = await import('./cartelaCustodyService.js');
    const bySerial = await resolveScan(fakeClient as never, company, user, '0004', false);
    assert.equal(bySerial.cartelaId, cart);
    assert.equal(bySerial.serialNo, '0004');
    // 2) لصاقات QR القديمة ما زالت تُمسح
    const byOldQr = await resolveScan(fakeClient as never, company, user, 'CLOTEX|ANDRIA OXFORD|7201|0004', false);
    assert.equal(byOldQr.cartelaId, cart);
    // 3) مسح QR الجديد (رابط الموقع) لا يكسر شيئاً: يُرفض بوضوح بدل أن يطابق كارتيلة بالخطأ
    await assert.rejects(() => resolveScan(fakeClient as never, company, user, 'https://www.clotexco.com', false), (e: unknown) => e instanceof CustodyError && e.code === 'NOT_FOUND');

    // 4) مسار الأوردر /api/cartela/lookup بالباركود العادي
    const { setCompanyActivationStatus } = await import('./activationService.js');
    await setCompanyActivationStatus(fakeClient as never, company, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const tok = signAuthToken({ sub: user, companyId: company, username: 'adm', role: 'admin', permissions: [], isPlatformAdmin: false });
    const look = async (scan: string) => app.inject({ method: 'GET', url: `/api/cartela/lookup?scan=${encodeURIComponent(scan)}`, headers: { authorization: `Bearer ${tok}` } });
    const r1 = await look('0004');
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(r1.json().data.id, cart);
    const r2 = await look('CLOTEX|ANDRIA OXFORD|7201|0004');
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().data.id, cart);
    const r3 = await look('https://www.clotexco.com');
    assert.ok(r3.statusCode === 404 || (r3.statusCode === 200 && !r3.json().data?.id), `website QR must not match a cartela: ${r3.statusCode} ${r3.body}`);
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
