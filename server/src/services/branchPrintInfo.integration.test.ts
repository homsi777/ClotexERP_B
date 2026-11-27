import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

const EGYPT = '523a8dde-e656-48fd-b968-7e8e7c5d7015', SYRIA = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea', TURKEY = '0be9e5b8-070c-4566-8959-99c06ef9efb7';

test('migration 213 sets branch print info by fixed branch id only (language never decides)', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'bp_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const idx = files.indexOf('213_turkey_branch_print_blank.sql');
    assert.ok(idx > 0);
    for (const f of files.slice(0, idx)) await db.query(await readFile(new URL(f, dir), 'utf8'));
    const other = randomUUID(), otherTr = randomUUID();
    await db.query("INSERT INTO companies(id,code,name,is_active,default_language) VALUES ($1,'EG-X','فرع مصر مجهول',true,'ar'),($2,'SY-X','سوريا',true,'ar'),($3,'TR-X','تركيا',true,'tr'),($4,'OT','فرع آخر',true,'ar'),($5,'OT-TR','فرع آخر تركي اللغة',true,'tr')", [EGYPT, SYRIA, TURKEY, other, otherTr]);
    for (const f of files.slice(idx)) await db.query(await readFile(new URL(f, dir), 'utf8'));
    const get = async (id: string) => (await db.query('SELECT print_location l, print_phone_invoice pi, print_phone_voucher pv FROM companies WHERE id=$1', [id])).rows[0];
    assert.deepEqual(await get(EGYPT), { l: 'الجمهورية العربية المصرية / القاهرة', pi: '+201278518975', pv: '+201500231211' });
    assert.deepEqual(await get(SYRIA), { l: 'الجمهورية العربية السورية / حلب', pi: '09 44 555 080', pv: '+963 944 555 080' });
    assert.deepEqual(await get(TURKEY), { l: '', pi: '', pv: '' });
    // فرع آخر — حتى لو لغته tr — لا يُمسّ
    assert.deepEqual(await get(other), { l: null, pi: null, pv: null });
    assert.deepEqual(await get(otherTr), { l: null, pi: null, pv: null });
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
