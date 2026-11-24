import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('probe: every parameterless GET API returns no 500 on a clean migrated schema', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'prb_' + randomUUID().replaceAll('-', '');
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
    const company = randomUUID(), admin = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'PB','probe',true)", [company]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,'adm','x','admin',true)", [admin, company]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    await setCompanyActivationStatus(fakeClient as never, company, { planCode: 'TEST', activatedAt: new Date().toISOString(), keySuffix: 'TEST' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const token = signAuthToken({ sub: admin, companyId: company, username: 'adm', role: 'admin', permissions: [], isPlatformAdmin: false });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const routes = app.printRoutes({ commonPrefix: false });
    const paths = new Set<string>();
    for (const m of routes.matchAll(/(\/api[^\s(]*)\s+\(([^)]*)\)/g)) {
      if (m[2].split(',').map((x) => x.trim()).includes('GET') && !m[1].includes(':') && !m[1].includes('*')) paths.add(m[1]);
    }
    const bad: string[] = [];
    for (const path of paths) {
      const res = await app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } });
      if (res.statusCode >= 500) bad.push(`${path} → ${res.statusCode} ${res.body.slice(0, 100)}`);
    }
    await app.close();
    console.log('PROBED', paths.size, 'GET paths; 500s:', JSON.stringify(bad, null, 1));
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
