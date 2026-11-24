import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('balances API: finance-gated on the server (ROLE and CUSTOM), per-branch, follow-up writes need edit', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'pbr_' + randomUUID().replaceAll('-', '');
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
    const a = randomUUID(), b = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','أ',true),($2,'B','ب',true)", [a, b]);
    const mk = async (company: string, name: string, role: string) => { const id = randomUUID(); await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,$3,'x',$4,true)", [id, company, name, role]); return id; };
    const acc = await mk(a, 'acc', 'accountant'), viewer = await mk(a, 'viewer', 'viewer'), custNoFin = await mk(a, 'cnf', 'accountant'), custFin = await mk(a, 'cf', 'accountant');
    const custB = randomUUID(), custA = randomUUID();
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$3,'C','عميل أ'),($2,$4,'C','عميل ب')", [custA, custB, a, b]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    for (const c of [a, b]) await setCompanyActivationStatus(fakeClient as never, c, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { saveUserPermissions } = await import('../services/userPermissionService.js');
    await saveUserPermissions(fakeClient as never, { companyId: a, targetUserId: custNoFin, changedBy: acc, mode: 'CUSTOM', codes: ['p:customers.balances.view'] });
    await saveUserPermissions(fakeClient as never, { companyId: a, targetUserId: custFin, changedBy: acc, mode: 'CUSTOM', codes: ['p:customers.balances.view', 'p:customers.balances.edit', 'p:customers.costView'] });
    const { signAuthToken } = await import('../middleware/auth.js');
    const tok = (id: string, name: string, role: string) => signAuthToken({ sub: id, companyId: a, username: name, role, permissions: [], isPlatformAdmin: false });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as never });

    const first = await call('GET', '/api/party-balances/customers', tok(acc, 'acc', 'accountant')); assert.equal(first.statusCode, 200, 'المحاسب (ROLE): ' + first.body);
    assert.equal((await call('GET', '/api/party-balances/customers', tok(viewer, 'viewer', 'viewer'))).statusCode, 403, 'مشاهد بلا صلاحية مالية');
    assert.equal((await call('GET', '/api/party-balances/customers', tok(custNoFin, 'cnf', 'accountant'))).statusCode, 403, 'مخصّص بلا «الأمور المالية» للعملاء');
    assert.equal((await call('GET', '/api/party-balances/suppliers', tok(custFin, 'cf', 'accountant'))).statusCode, 403, 'لا وحدة موردين');
    const ok = await call('GET', '/api/party-balances/customers?onlyWithBalance=false', tok(custFin, 'cf', 'accountant'));
    assert.equal(ok.statusCode, 200);
    assert.deepEqual((ok.json().data.rows as Array<{ id: string }>).map((r) => r.id), [custA], 'فرعه فقط');

    // الكتابة: التعديل مطلوب، ولا كتابة لعميل فرع آخر
    const body = { creditLimit: 500, creditLimitCurrency: 'EGP', expectedCollectionDate: '2026-12-01' };
    assert.equal((await call('PUT', `/api/party-balances/customers/${custA}/profile`, tok(custNoFin, 'cnf', 'accountant'), body)).statusCode, 403);
    assert.equal((await call('PUT', `/api/party-balances/customers/${custA}/profile`, tok(custFin, 'cf', 'accountant'), body)).statusCode, 200);
    assert.equal((await call('PUT', `/api/party-balances/customers/${custB}/profile`, tok(custFin, 'cf', 'accountant'), body)).statusCode, 404, 'عميل فرع آخر');
    assert.equal((await call('POST', `/api/party-balances/customers/${custA}/notes`, tok(custFin, 'cf', 'accountant'), { note: 'اتصلت به' })).statusCode, 201);
    await app.close();
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
