import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const dbName = 'clotex_transfer_test_task001';
const root = process.cwd();
const expectedData = path.resolve(root, '.local-test-tools/pgdata').toLowerCase();
const base = 'postgresql://task001@127.0.0.1:5432/';
const admin = new pg.Pool({ connectionString: base + 'postgres', connectionTimeoutMillis: 3000 });
const identity = (await admin.query("SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory")).rows[0];
assert.equal(identity.host, '127.0.0.1'); assert.equal(identity.port, 5432);
assert.equal(path.resolve(identity.directory).toLowerCase(), expectedData, 'Refusing a PostgreSQL instance outside the task001 data directory');
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])).rows.length) await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();
const pool = new pg.Pool({ connectionString: base + dbName, max: 8 });
assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, dbName);
console.log('Verified isolated local target: 127.0.0.1:5432/' + dbName);
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(filename text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
for (const filename of (await fs.readdir('server/src/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  if ((await pool.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename])).rows.length) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(await fs.readFile(path.join('server/src/db/migrations', filename), 'utf8'));
    await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
    await client.query('COMMIT'); console.log('Migration OK:', filename);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
const company = (await pool.query("INSERT INTO companies(code,name) VALUES('TASK001-TEST','TASK001 Synthetic Test Company') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id")).rows[0].id;
const testPassword = randomUUID();
await pool.query("INSERT INTO currencies(code,name,symbol) VALUES('USD','Test USD','$') ON CONFLICT(code) DO NOTHING");
await pool.query("INSERT INTO users(company_id,username,full_name,password_hash,role) VALUES($1,'task001_local','Local synthetic tester',$2,'admin') ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash", [company, await bcrypt.hash(testPassword, 10)]);

// Prevent application configuration from loading real .env files or external integrations.
Object.assign(process.env, { DATABASE_URL: base + dbName, NODE_ENV: 'test', CLOTEX_EMBEDDED_SERVER: '1',
  ACTIVATION_REQUIRE_ACTIVE: 'false', ACTIVATION_GENERATE_DEV_KEYS: 'false',
  JWT_SECRET: randomUUID() + randomUUID(), TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
const { buildApp } = await import('../server/src/app.js');
const app = await buildApp();
await app.listen({ host: '127.0.0.1', port: 14030 });
const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'task001_local', password: testPassword } });
assert.equal(login.statusCode, 200, login.body);
const token = login.json().token ?? login.json().data?.token;
assert.ok(token, 'Login must provide a token');
const headers = { authorization: `Bearer ${token}` };

async function fixture(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const warehouses: string[] = [];
  for (const direction of ['source', 'destination', 'other']) warehouses.push((await pool.query(
    'INSERT INTO warehouses(company_id,code,name) VALUES($1,$2,$3) RETURNING id',
    [company, `${label}-${direction}-${suffix}`, `${label} ${direction} ${suffix}`],
  )).rows[0].id);
  const location = (await pool.query("INSERT INTO warehouse_locations(company_id,warehouse_id,code,name) VALUES($1,$2,'shelf','Test Shelf') RETURNING id", [company, warehouses[0]])).rows[0].id;
  const items: string[] = [], colors: string[] = [];
  for (const name of ['A', 'B']) items.push((await pool.query('INSERT INTO fabric_items(company_id,internal_code,name) VALUES($1,$2,$3) RETURNING id', [company, `${label}-${name}-${suffix}`, `${label} Fabric ${name}`])).rows[0].id);
  for (const name of ['Red', 'Blue']) colors.push((await pool.query('INSERT INTO fabric_colors(company_id,name_ar,color_code) VALUES($1,$2,$3) RETURNING id', [company, `${label} ${name}`, `${label}-${name}-${suffix}`])).rows[0].id);
  const rolls: string[] = [];
  for (let n = 0; n < 4; n++) rolls.push((await pool.query(
    `INSERT INTO fabric_rolls(company_id,barcode,item_id,color_id,warehouse_id,location_id,status,length_m,actual_weight_kg,unit_cost,currency_code)
     VALUES($1,$2,$3,$4,$5,$6,'AVAILABLE',12.345,2.5,7,'USD') RETURNING id`,
    [company, `${label}-${suffix}-${n}`, items[n < 3 ? 0 : 1], colors[n === 2 ? 1 : 0], warehouses[0], location],
  )).rows[0].id);
  return { warehouses, location, items, colors, rolls, label, suffix };
}
async function postDraft(f: Awaited<ReturnType<typeof fixture>>, ids: string[], key = randomUUID(), dest = f.warehouses[1]) {
  return app.inject({ method: 'POST', url: '/api/inventory/transfers', headers, payload: {
    fromWarehouseId: f.warehouses[0], toWarehouseId: dest, fromLocationId: f.location,
    clientRequestId: key, lines: ids.map((fabricRollId) => ({ fabricRollId, quantity: 1 })),
  } });
}
const snapshot = async (ids: string[]) => (await pool.query('SELECT id,barcode,warehouse_id,location_id,status,length_m,actual_weight_kg,calculated_weight_kg,unit_cost,currency_code FROM fabric_rolls WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])).rows;
const unchangedFields = (rows: any[]) => rows.map(({ warehouse_id, location_id, ...r }) => r);
let passed = 0;
try {
  for (const [label, count] of [['single', 1], ['multiple', 4], ['entire', 3], ['color', 2]] as const) {
    const f = await fixture(label); const ids = f.rolls.slice(0, count); const before = await snapshot(ids);
    const draft = await postDraft(f, ids); assert.equal(draft.statusCode, 201, draft.body);
    const id = draft.json().data.id;
    const confirm = await app.inject({ method: 'PATCH', url: `/api/inventory/transfers/${id}/confirm`, headers, payload: {} });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const after = await snapshot(ids); assert.deepEqual(unchangedFields(after), unchangedFields(before));
    assert.ok(after.every((r) => r.warehouse_id === f.warehouses[1]));
    assert.equal(Number((await pool.query('SELECT count(*) FROM inventory_movements WHERE reference_id=$1', [id])).rows[0].count), count * 2);
    const repeat = await app.inject({ method: 'PATCH', url: `/api/inventory/transfers/${id}/confirm`, headers, payload: {} });
    assert.equal(repeat.statusCode, 200); passed++; console.log('API conservation + duplicate confirm OK:', label);
  }
  const f = await fixture('validation');
  assert.equal((await postDraft(f, [f.rolls[0]], randomUUID(), f.warehouses[0])).statusCode, 400);
  assert.equal((await postDraft(f, [f.rolls[0], f.rolls[0]])).statusCode, 400);
  const key = randomUUID();
  const duplicates = await Promise.all([postDraft(f, [f.rolls[0]], key), postDraft(f, [f.rolls[0]], key)]);
  assert.ok(duplicates.every((r) => r.statusCode === 201)); assert.equal(duplicates[0].json().data.id, duplicates[1].json().data.id);
  passed++; console.log('API validation + concurrent duplicate creation OK');

  const race = await fixture('race');
  const a = await postDraft(race, race.rolls), b = await postDraft(race, race.rolls, randomUUID(), race.warehouses[2]);
  const outcomes = await Promise.all([a,b].map((doc) => app.inject({method:'PATCH',url:`/api/inventory/transfers/${doc.json().data.id}/confirm`,headers,payload:{}})));
  assert.deepEqual(outcomes.map((r)=>r.statusCode).sort(), [200,409]);
  assert.equal(new Set((await snapshot(race.rolls)).map((r)=>r.warehouse_id)).size,1);
  passed++; console.log('API concurrent conflict + no partial move OK');

  const rollback = await fixture('rollback'); const doc = await postDraft(rollback, rollback.rolls); const id = doc.json().data.id;
  const before = await snapshot(rollback.rolls);
  const rejectRoll = [...rollback.rolls].sort()[1];
  await pool.query(`CREATE OR REPLACE FUNCTION task001_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.roll_id='${rejectRoll}'::uuid THEN RAISE EXCEPTION 'synthetic rollback test'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER task001_reject BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION task001_reject();`);
  try {
    const result = await app.inject({method:'PATCH',url:`/api/inventory/transfers/${id}/confirm`,headers,payload:{}});
    assert.equal(result.statusCode,500); assert.deepEqual(await snapshot(rollback.rolls),before);
    assert.equal(Number((await pool.query('SELECT count(*) FROM inventory_movements WHERE reference_id=$1',[id])).rows[0].count),0);
  } finally { await pool.query('DROP TRIGGER task001_reject ON inventory_movements; DROP FUNCTION task001_reject()'); }
  passed++; console.log('API real PostgreSQL rollback OK');
  assert.equal(Number((await pool.query('SELECT count(*) FROM journal_entries WHERE company_id=$1',[company])).rows[0].count),0);

  const ui = [];
  for (const label of ['ui-single','ui-multiple','ui-entire','ui-color']) ui.push(await fixture(label));
  await fs.mkdir('.local-test-results', {recursive:true});
  await fs.writeFile('.local-test-results/task001-fixtures.json',JSON.stringify({ui,token,api:'http://127.0.0.1:14030',passed,company}));
  console.log('API scenarios passed:',passed);
  console.log('Local API ready for UI test; press Ctrl+C to stop.');
  const stop = async () => { await app.close(); await pool.end(); const {resetPool}=await import('../server/src/db/pool.js');await resetPool(); process.exit(0); };
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
} catch(error) { await app.close(); await pool.end(); console.error(error); process.exitCode=1; }
