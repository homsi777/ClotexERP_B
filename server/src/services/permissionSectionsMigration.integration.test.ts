import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('الهجرة 190: من كانت له صلاحيات الكارتيلات/مهام المصنعية يحتفظ بما كان يستطيعه في الوحدات المنفصلة', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'sec_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const target = files.find((f) => f.startsWith('190_'));
    assert.ok(target, '190 موجودة');
    for (const f of files.filter((x) => x < target!)) await db.query(await readFile(new URL(f, dir), 'utf8'));
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const c = randomUUID(), u1 = randomUUID(), u2 = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'S','s')", [c]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role,perm_mode) VALUES ($1,$3,'a','x','viewer','CUSTOM'),($2,$3,'b','x','viewer','CUSTOM')", [u1, u2, c]);
    const grant = (u: string, code: string) => q('INSERT INTO user_permission_grants(user_id,company_id,permission_code) VALUES ($1,$2,$3)', [u, c, code]);
    for (const code of ['p:cartela.view', 'p:cartela.create', 'p:external.jobs.view', 'p:external.jobs.create', 'p:external.jobs.price', 'p:sales.invoices.view']) await grant(u1, code);
    await grant(u2, 'p:cartela.print');

    await db.query(await readFile(new URL(target!, dir), 'utf8'));
    await db.query(await readFile(new URL(target!, dir), 'utf8')); // قابلة للإعادة بلا تكرار/خطأ

    const codes = async (u: string) => (await q('SELECT permission_code FROM user_permission_grants WHERE user_id=$1 ORDER BY 1', [u])).map((r) => r.permission_code);
    const a = await codes(u1);
    for (const x of ['p:cartela.custody.view', 'p:cartela.custody.create', 'p:external.entry.view', 'p:external.entry.create']) assert.ok(a.includes(x), x);
    assert.ok(a.includes('p:cartela.view') && a.includes('p:external.jobs.create'), 'الأصول باقية');
    assert.ok(!a.includes('p:external.entry.price') && !a.includes('p:external.jobs.price') === false, 'التسعير لا يُنسخ للإدخال');
    assert.ok(!a.some((x) => x.startsWith('p:cartela.custody.custody')), 'لا تكرار في الاسم');
    assert.ok(!a.includes('p:partners.view'), 'الشركاء: لا منح تلقائي');
    assert.deepEqual(await codes(u2), ['p:cartela.custody.print', 'p:cartela.print']);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
