import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import pg from 'pg';

/**
 * حساب «مخصّص» بكل الصلاحيات (220+) كان يصدر توكناً ~9.7KB فيتجاوز ترويسة Authorization حدّ 8KB لـ nginx
 * فيُرفض كل طلب بعد الدخول بـ 400 (لوحة خالد جنه). التوكن لا يحمل الصلاحيات الآن، وتُقرأ من القاعدة بكل طلب.
 */
test('custom-permission user: login token stays small and permissions are still enforced from the DB', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'cp_' + randomUUID().replaceAll('-', '');
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
    const company = randomUUID(), full = randomUUID(), narrow = randomUUID();
    await db.query("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع',true)", [company]);
    const hash = await bcrypt.hash('password123', 4);
    await db.query("INSERT INTO users(id,company_id,username,password_hash,role,is_active,perm_mode) VALUES ($1,$2,'khaled',$3,'accountant',true,'CUSTOM'),($4,$2,'narrow',$3,'accountant',true,'CUSTOM')", [full, company, hash, narrow]);
    const { ALL_MATRIX_CODES } = await import('../services/permissionCatalog.js');
    for (const c of ALL_MATRIX_CODES) await db.query('INSERT INTO user_permission_grants(user_id,company_id,permission_code) VALUES ($1,$2,$3)', [full, company, c]);
    await db.query("INSERT INTO user_permission_grants(user_id,company_id,permission_code) VALUES ($1,$2,'p:dashboard.view')", [narrow, company]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    await setCompanyActivationStatus(fakeClient as never, company, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const login = async (u: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: 'password123', companyId: company } })).json();

    const lf = await login('khaled');
    assert.ok(lf.token, JSON.stringify(lf).slice(0, 200));
    assert.ok(ALL_MATRIX_CODES.length > 200, 'مصفوفة كاملة');
    assert.ok(`Authorization: Bearer ${lf.token}`.length < 2000, `توكن صغير: ${lf.token.length}`);
    // الواجهة ما زالت تتلقى الصلاحيات في جسم الرد
    assert.ok(Array.isArray(lf.user.permissions) && lf.user.permissions.length > 100);
    // الطلبات تعمل والصلاحيات تُطبَّق من القاعدة
    const ok = await app.inject({ method: 'GET', url: '/api/reports/dashboard-summary', headers: { authorization: `Bearer ${lf.token}` } });
    assert.equal(ok.statusCode, 200, ok.body);
    const ln = await login('narrow');
    const fine = await app.inject({ method: 'GET', url: '/api/reports/dashboard-summary', headers: { authorization: `Bearer ${ln.token}` } });
    assert.equal(fine.statusCode, 200);
    const body = { code: 'C1', name: 'عميل' };
    const denied = await app.inject({ method: 'POST', url: '/api/customers', headers: { authorization: `Bearer ${ln.token}` }, payload: body });
    assert.equal(denied.statusCode, 403, 'الحساب الضيّق لا ينشئ عملاء رغم أن التوكن بلا صلاحيات: ' + denied.body);
    const allowed = await app.inject({ method: 'POST', url: '/api/customers', headers: { authorization: `Bearer ${lf.token}` }, payload: body });
    assert.notEqual(allowed.statusCode, 403, 'الحساب الكامل يتجاوز بوابة الصلاحيات: ' + allowed.body);
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
