import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

// No dotenv, application startup, production connection or persistent test data.
test('manufacturing migrations install and enforce company-scoped downtime references', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  assert.equal(url.search, '');
  const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    // Everything, including DDL, rolls back. A new schema exercises installation from zero.
    await client.query('BEGIN');
    const schema = `manufacturing_test_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      try { await client.query(await readFile(new URL(file, dir), 'utf8')); }
      catch (error) { throw new Error(`Migration ${file} failed`, { cause: error }); }
    }
    const companies = [randomUUID(), randomUUID()];
    await client.query("INSERT INTO companies(id,code,name) VALUES ($1,'TEST_A','A'),($2,'TEST_B','B')", companies);
    const reason = randomUUID();
    await client.query("INSERT INTO manufacturing_downtime_reasons(id,company_id,code,name) VALUES ($1,$2,'TEST','Test downtime')", [reason, companies[0]]);
    // Exercise the exact composite key targeted by the shift-log FK.
    await client.query(`CREATE TABLE downtime_reference_probe(company_id uuid, reason_id uuid,
      FOREIGN KEY(company_id,reason_id) REFERENCES manufacturing_downtime_reasons(company_id,id))`);
    await client.query('INSERT INTO downtime_reference_probe VALUES ($1,$2)', [companies[0], reason]);
    await client.query('SAVEPOINT foreign_company');
    await assert.rejects(client.query('INSERT INTO downtime_reference_probe VALUES ($1,$2)', [companies[1], reason]),
      (error: unknown) => (error as { code?: string }).code === '23503');
    await client.query('ROLLBACK TO SAVEPOINT foreign_company');
    const constraint = await client.query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
      WHERE conrelid='inventory_movements'::regclass AND conname='inventory_movements_movement_type_check'`);
    assert.match(constraint.rows[0].definition, /'CUT'/);
    assert.match(constraint.rows[0].definition, /'INTERNAL_PRODUCTION'/);
    assert.match(constraint.rows[0].definition, /'LOCATION_MOVE'/);
    console.log(`Installed ${files.length} migrations; company isolation and movement types verified`);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
});
