import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { confirmTransfer, saveTransfer, transferTransaction } from './inventoryTransferService.js';
import type { TransferInput } from './inventoryTransferValidation.js';

// Explicit opt-in only. Never loads .env or imports the app/pool/runtime configuration.
// The operator must supply a dedicated LOCAL PostgreSQL instance, not an SSH forward.
const enabled = process.env.CLOTEX_TRANSFER_LOCAL_TESTS === '1';
test('real PostgreSQL: transactions, reconciliation, concurrent transfers and duplicate requests', { skip: !enabled }, async (t) => {
  const rawUrl = process.env.CLOTEX_TRANSFER_TEST_DATABASE_URL;
  assert.ok(rawUrl, 'A dedicated local test database URL is required');
  const url = new URL(rawUrl);
  assert.equal(url.hostname, '127.0.0.1', 'Only explicit IPv4 loopback is accepted');
  assert.match(url.pathname, /^\/clotex_transfer_test_[a-z0-9_]+$/i, 'Only dedicated test database names are accepted');
  assert.equal(url.port || '5432', '5432', 'Custom/tunnel ports are not accepted by this harness');
  assert.equal(url.search, '', 'Connection URL options are not accepted');
  const { Pool: PgPool } = await import('pg');
  const schema = `transfer_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new PgPool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 3000 });
  let pool: Pool | undefined;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    pool = new PgPool({ connectionString: url.href, max: 5, connectionTimeoutMillis: 3000,
      options: `-c search_path=${schema} -c lock_timeout=5000 -c statement_timeout=10000` });
    await pool.query(`
      CREATE TABLE companies(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY);
      CREATE TABLE warehouses(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES companies(id),is_active boolean NOT NULL DEFAULT true);
      CREATE TABLE warehouse_locations(id uuid PRIMARY KEY,company_id uuid NOT NULL,warehouse_id uuid NOT NULL REFERENCES warehouses(id),is_active boolean NOT NULL DEFAULT true);
      CREATE TABLE fabric_rolls(id uuid PRIMARY KEY,company_id uuid NOT NULL,barcode text NOT NULL,warehouse_id uuid NOT NULL REFERENCES warehouses(id),
        location_id uuid REFERENCES warehouse_locations(id),status text NOT NULL,length_m numeric(14,3) NOT NULL,
        actual_weight_kg numeric(14,3),unit_cost numeric(14,4),updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE inventory_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,roll_id uuid NOT NULL REFERENCES fabric_rolls(id),
        movement_type text NOT NULL CHECK(movement_type IN ('TRANSFER_OUT','TRANSFER_IN')),
        from_warehouse_id uuid,to_warehouse_id uuid,from_location_id uuid,to_location_id uuid,old_status text,new_status text,
        reference_type text,reference_id uuid,reference_no text,notes text,created_by_user_id uuid,length_delta_m numeric,weight_delta_kg numeric);
    `);
    const foundation = await readFile(new URL('../db/migrations/012_inventory_transfers_waste_foundation.sql', import.meta.url), 'utf8');
    await pool.query(foundation.slice(0, foundation.indexOf('CREATE TABLE inventory_waste_records')));
    await pool.query(await readFile(new URL('../db/migrations/040_inventory_transfer_idempotency.sql', import.meta.url), 'utf8'));
    const company = randomUUID(), user = randomUUID(), source = randomUUID(), dest = randomUUID(), third = randomUUID();
    await pool.query('INSERT INTO companies VALUES ($1)', [company]);
    await pool.query('INSERT INTO users VALUES ($1)', [user]);
    await pool.query('INSERT INTO warehouses(id,company_id) SELECT unnest($1::uuid[]),$2', [[source, dest, third], company]);
    const db = pool;
    const setup = async () => {
      await db.query('TRUNCATE inventory_movements,inventory_transfer_lines,inventory_transfers,fabric_rolls');
      const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
      await db.query("INSERT INTO fabric_rolls(id,company_id,barcode,warehouse_id,status,length_m,actual_weight_kg,unit_cost) SELECT x,$2,x::text,$3,'AVAILABLE',12.345,2.5,7 FROM unnest($1::uuid[]) AS r(x)", [ids, company, source]);
      return ids;
    };
    const draft = (ids: string[], target = dest, key = randomUUID()) => {
      const input: TransferInput = { fromWarehouseId: source, toWarehouseId: target, clientRequestId: key, lines: ids.map((fabricRollId) => ({ fabricRollId, quantity: 1 })) };
      return transferTransaction(db, (c) => saveTransfer(c, company, user, input));
    };
    const snapshot = async () => (await db.query('SELECT id,warehouse_id,status,length_m,actual_weight_kg,unit_cost FROM fabric_rolls ORDER BY id')).rows;

    await t.test('single, multiple and complete fabric roll sets preserve all totals', async () => {
      for (const count of [1, 2, 3]) {
        const ids = await setup(); const before = await snapshot(); const doc = await draft(ids.slice(0, count));
        await transferTransaction(db, (c) => confirmTransfer(c, company, user, doc.id));
        const after = await snapshot();
        assert.deepEqual(after.map(({ warehouse_id, ...r }) => r), before.map(({ warehouse_id, ...r }) => r));
        assert.equal(after.filter((r) => r.warehouse_id === dest).length, count);
        assert.equal(Number((await db.query('SELECT count(*) FROM inventory_movements')).rows[0].count), count * 2);
        await transferTransaction(db, (c) => confirmTransfer(c, company, user, doc.id));
        assert.equal(Number((await db.query('SELECT count(*) FROM inventory_movements')).rows[0].count), count * 2);
      }
    });
    await t.test('real SQL failure in the second roll restores all rows and movements', async () => {
      const ids = await setup(); const doc = await draft(ids); const before = await snapshot();
      await db.query(`CREATE FUNCTION reject_test_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.roll_id='${ids[1]}'::uuid THEN RAISE EXCEPTION 'injected test failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_test_movement BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION reject_test_movement();`);
      try {
        await assert.rejects(transferTransaction(db, (c) => confirmTransfer(c, company, user, doc.id)));
        assert.deepEqual(await snapshot(), before);
        assert.equal(Number((await db.query('SELECT count(*) FROM inventory_movements')).rows[0].count), 0);
        assert.equal((await db.query('SELECT status FROM inventory_transfers WHERE id=$1', [doc.id])).rows[0].status, 'DRAFT');
      } finally { await db.query('DROP TRIGGER reject_test_movement ON inventory_movements; DROP FUNCTION reject_test_movement()'); }
    });
    await t.test('concurrent conflicting transfers have one winner and no partial move', async () => {
      const ids = await setup(); const a = await draft(ids); const b = await draft(ids, third);
      const result = await Promise.allSettled([a, b].map((doc) => transferTransaction(db, (c) => confirmTransfer(c, company, user, doc.id))));
      assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(new Set((await snapshot()).map((r) => r.warehouse_id)).size, 1);
      assert.equal(Number((await db.query('SELECT count(*) FROM inventory_movements')).rows[0].count), 6);
    });
    await t.test('concurrent same-key creation and same-document confirmation execute once', async () => {
      const ids = await setup(); const key = randomUUID();
      const docs = await Promise.all([draft(ids, dest, key), draft(ids, dest, key)]);
      assert.equal(docs[0].id, docs[1].id);
      assert.equal(Number((await db.query('SELECT count(*) FROM inventory_transfers')).rows[0].count), 1);
      await Promise.all(docs.map((doc) => transferTransaction(db, (c) => confirmTransfer(c, company, user, doc.id))));
      assert.equal(Number((await db.query('SELECT count(*) FROM inventory_movements')).rows[0].count), 6);
    });
  } finally {
    await pool?.end();
    try { if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
});
