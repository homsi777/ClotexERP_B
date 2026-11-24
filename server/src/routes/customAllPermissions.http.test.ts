import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

/**
 * حساب بوضع «صلاحيات مخصّصة» ومُنح كل الصلاحيات: يجب أن تعمل كل شاشة (200).
 * (بشير: «عاطيه كل الصلاحيات ومع ذلك ما عم يصير»). يعمل على قاعدة الاختبار المحلية داخل معاملة تُلغى.
 */
test('custom-mode account with every permission can load every main screen API', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'http_' + randomUUID().replaceAll('-', '');
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
      release: () => undefined,
      on: () => undefined,
    };
    setPoolOverrideForTests({ connect: async () => fakeClient, query: (sql: string, params?: unknown[]) => db.query(sql, params), on: () => undefined });

    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
    const company = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'KH','خالد test',true)", [company]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    await setCompanyActivationStatus(fakeClient as never, company, { planCode: 'TEST', activatedAt: new Date().toISOString(), keySuffix: 'TEST' } as never);
    const { ALL_MATRIX_CODES } = await import('../services/permissionCatalog.js');
    const { saveUserPermissions } = await import('../services/userPermissionService.js');
    const { signAuthToken } = await import('../middleware/auth.js');
    const boss = randomUUID();
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$2,'boss','x','manager')", [boss, company]);

    const results: Record<string, string> = {};
    for (const role of ['viewer', 'manager', 'accountant', 'warehouse']) {
      const id = randomUUID();
      await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,$3,'x',$4,true)", [id, company, 'k_' + role, role]);
      await saveUserPermissions(fakeClient as never, { companyId: company, targetUserId: id, changedBy: boss, mode: 'CUSTOM', codes: ALL_MATRIX_CODES });
      const token = signAuthToken({ sub: id, companyId: company, username: 'k_' + role, role, permissions: [], isPlatformAdmin: false });
      const { buildApp } = await import('../app.js');
      const app = await buildApp();
      const failures: string[] = [];
      for (const path of [
        '/api/auth/me', '/api/reports/dashboard-summary', '/api/inventory/rolls?page=1&pageSize=30', '/api/warehouses', '/api/customers', '/api/suppliers',
        '/api/fabric/items', '/api/fabric/colors', '/api/fabric/categories', '/api/sales-invoices', '/api/purchase-invoices', '/api/cashboxes', '/api/vouchers',
        '/api/exchange-rates', '/api/customer-orders', '/api/cartela', '/api/payroll/employees', '/api/manufacturing/work-orders', '/api/inventory/yarn-lots',
        '/api/inventory/transfers', '/api/expenses', '/api/checks',
      ]) {
        const res = await app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } });
        if (res.statusCode !== 200) failures.push(`${path} → ${res.statusCode} ${res.body.slice(0, 120)}`);
      }
      await app.close();
      results[role] = failures.length ? failures.join('\n      ') : 'OK';
    }
    console.log('PROBE', JSON.stringify(results, null, 1));
    for (const [role, r] of Object.entries(results)) if (r !== 'OK' && !r.includes('skipped')) assert.fail(`${role}: ${r}`);
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
