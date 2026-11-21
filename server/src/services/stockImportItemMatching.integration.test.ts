import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('stock import item matching: a shared generic code (DYED) never merges differently named fabrics', {
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
    const schema = 'sitem_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const { ensureItem } = await import('./stockImportJobService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
    const company = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'SI','si test')", [company]);
    const existing = (await q("INSERT INTO fabric_items(company_id,internal_code,supplier_code,name) VALUES ($1,'DYED','DYED','RANKLI SLUP') RETURNING id", [company]))[0].id as string;
    const row = (name: string, code: string) => ({ materialName: name, materialCode: code, matchByCode: code, resolvedInternalCode: code, unit: 'meter' }) as never;

    // 1) كود عام مشترك + اسم مختلف ← خامة جديدة باسم الملف
    const masimo = await ensureItem(client, company, null, row('MASIMO', 'DYED'), 1);
    assert.equal(masimo.created, true);
    assert.notEqual(masimo.id, existing, 'must not collapse into RANKLI SLUP');
    assert.equal((await q('SELECT name FROM fabric_items WHERE id=$1', [masimo.id]))[0].name, 'MASIMO');
    // 2) نفس الصف ثانية ← نفس خامة MASIMO (لا تكرار)
    const again = await ensureItem(client, company, null, row('masimo', 'DYED'), 2);
    assert.deepEqual([again.id, again.created], [masimo.id, false]);
    // 3) الاسم والكود يطابقان الخامة الأصلية ← تلك الخامة
    assert.equal((await ensureItem(client, company, null, row('Rankli Slup', 'DYED'), 3)).id, existing);
    // 4) خامة ثانية بنفس الكود العام ← خامة ثالثة مستقلة
    const third = await ensureItem(client, company, null, row('SATIN', 'DYED'), 4);
    assert.ok(third.created && ![existing, masimo.id].includes(third.id));
    // 5) كود تصميم فريد يبقى يطابق بالكود (سلوك قديم): 5114
    const asya = (await q("INSERT INTO fabric_items(company_id,internal_code,supplier_code,name) VALUES ($1,'5114','5114','asya') RETURNING id", [company]))[0].id as string;
    assert.equal((await ensureItem(client, company, null, row('asya blue', '5114'), 5)).id, asya);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
