import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('owner panel: platform admin sees every branch (per-currency, no mixing); everyone else is refused', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'own_' + randomUUID().replaceAll('-', '');
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

    const a = randomUUID(), b = randomUUID(), owner = randomUUID(), plain = randomUUID(), custA = randomUUID(), custB = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع أ',true),($2,'B','فرع ب',true)", [a, b]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active,is_platform_admin) VALUES ($1,$3,'owner','x','admin',true,true),($2,$3,'plain','x','admin',true,false)", [owner, plain, a]);
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$3,'C','عميل أ'),($2,$4,'C','عميل ب')", [custA, custB, a, b]);
    const inv = (company: string, cust: string, no: string, ccy: string, total: number) => q(
      `INSERT INTO sales_invoices(company_id,invoice_no,customer_id,invoice_date,document_status,currency_code,subtotal,total_amount,remaining_amount)
       VALUES ($1,$2,$3,current_date,'CONFIRMED',$4,$5,$5,$5)`, [company, no, cust, ccy, total]);
    await inv(a, custA, 'S1', 'EGP', 1000); await inv(a, custA, 'S2', 'USD', 50); await inv(b, custB, 'S3', 'TRY', 700);
    await q("INSERT INTO cashboxes(company_id,code,name,currency_code,current_balance) VALUES ($1,'X','صندوق','EGP',250)", [a]);
    await q("INSERT INTO checks(company_id,check_no,bank_name,party_type,amount,currency_code,due_date,status) VALUES ($1,'1','بنك','CUSTOMER',400,'EGP',current_date - 3,'RECEIVED')", [a]);

    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    for (const c of [a, b]) await setCompanyActivationStatus(fakeClient as never, c, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const get = (token: string) => app.inject({ method: 'GET', url: '/api/platform/overview', headers: { authorization: `Bearer ${token}` } });

    const plainRes = await get(signAuthToken({ sub: plain, companyId: a, username: 'plain', role: 'admin', permissions: [], isPlatformAdmin: false }));
    assert.equal(plainRes.statusCode, 403, 'مدير فرع عادي لا يرى لوحة المالك');

    const res = await get(signAuthToken({ sub: owner, companyId: a, username: 'owner', role: 'admin', permissions: [], isPlatformAdmin: true }));
    assert.equal(res.statusCode, 200);
    const data = res.json().data as { branches: Array<{ code: string; sales30d: Array<{ currency: string; total: number }>; cash: Array<{ currency: string; total: number }>; cheques: { pending: number; overdue: number }; receivables: Array<{ currency: string; total: number }> }> };
    assert.deepEqual(data.branches.map((x) => x.code), ['A', 'B']);
    const A = data.branches[0], B = data.branches[1];
    assert.deepEqual(A.sales30d.map((x) => [x.currency, x.total]), [['EGP', 1000], ['USD', 50]], 'كل عملة لحالها');
    assert.deepEqual(B.sales30d.map((x) => [x.currency, x.total]), [['TRY', 700]], 'لا اختلاط بين الفروع');
    assert.deepEqual(A.cash.map((x) => [x.currency, x.total]), [['EGP', 250]]);
    assert.equal(B.cash.length, 0);
    assert.deepEqual([A.cheques.pending, A.cheques.overdue], [1, 1]);
    await app.close();
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
