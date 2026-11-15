import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { cancelTransfer, confirmTransfer, lockTransferRolls, saveTransfer, transferRequestHash, transferTransaction, validateTransferWarehouses } from './inventoryTransferService.js';
import type { TransferInput } from './inventoryTransferValidation.js';

const input = (): TransferInput => ({ fromWarehouseId: 'source', toWarehouseId: 'dest', clientRequestId: 'key', lines: [{ fabricRollId: 'a', quantity: 1 }, { fabricRollId: 'b', quantity: 1 }] });

// A deterministic SQL double tests service behavior, NOT PostgreSQL locking or SQL execution.
function fixture() {
  const state = {
    head: { id: 'doc', status: 'DRAFT', from_warehouse_id: 'source', to_warehouse_id: 'dest', from_location_id: null, to_location_id: null, transfer_no: 'TRF', updated_at: new Date('2026-01-01Z') },
    rolls: ['a', 'b'].map((id) => ({ id, barcode: id, warehouse_id: 'source', location_id: null, status: 'AVAILABLE', length_m: '10.125', actual_weight_kg: '3', unit_cost: '5' })),
    lines: input().lines.map((l) => ({ fabric_roll_id: l.fabricRollId, quantity: '1' })),
    movements: 0,
    warehouses: [{ id: 'source', is_active: true }, { id: 'dest', is_active: true }],
  };
  const queries: string[] = [];
  let snapshot: typeof state | undefined;
  let failMovement = false;
  let released = false;
  const client = {
    async query(sql: string, args: unknown[] = []) {
      queries.push(sql);
      const indexes = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      if (indexes.length) assert.equal(Math.max(...indexes), args.length, 'SQL placeholder count must match parameter array');
      if (sql === 'BEGIN') snapshot = structuredClone(state);
      else if (sql === 'ROLLBACK' && snapshot) Object.assign(state, snapshot);
      else if (sql.includes('SELECT * FROM inventory_transfers WHERE id=')) return { rows: [structuredClone(state.head)] };
      else if (sql.includes('SELECT id, is_active FROM warehouses')) return { rows: state.warehouses };
      else if (sql.startsWith('SELECT fabric_roll_id,quantity')) return { rows: state.lines };
      else if (sql.includes('FROM fabric_rolls') && sql.includes('FOR UPDATE')) return { rows: state.rolls.filter((r) => (args[1] as string[]).includes(r.id)).map((r) => ({ ...r })) };
      else if (sql.includes('UPDATE fabric_rolls SET warehouse_id=')) { const r = state.rolls.find((r) => r.id === args[0])!; r.warehouse_id = String(args[2]); r.location_id = args[3] as null; }
      else if (sql.includes('INSERT INTO inventory_movements')) { if (failMovement && state.movements >= 2) throw new Error('injected movement failure'); state.movements += 2; }
      else if (sql.includes("UPDATE inventory_transfers SET status='CONFIRMED'")) { state.head.status = 'CONFIRMED'; return { rows: [{ ...state.head }] }; }
      else if (sql.includes("UPDATE inventory_transfers SET status='CANCELLED'")) { state.head.status = 'CANCELLED'; return { rows: [{ ...state.head }] }; }
      else if (sql.includes('WHERE company_id=$1 AND client_request_id=$2')) return { rows: [{ ...state.head, request_hash: transferRequestHash(input()) }] };
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { state, queries, client: client as unknown as PoolClient, pool: { connect: async () => client } as unknown as Pool,
    failMovement: () => { failMovement = true; }, released: () => released };
}

test('confirmation moves every roll, records both directions, and conserves inventory/cost/weight', async () => {
  const f = fixture(); const before = f.state.rolls.map(({ id, length_m, actual_weight_kg, unit_cost, status }) => ({ id, length_m, actual_weight_kg, unit_cost, status }));
  await transferTransaction(f.pool, (c) => confirmTransfer(c, 'company', 'user', 'doc'));
  assert.ok(f.state.rolls.every((r) => r.warehouse_id === 'dest'));
  assert.deepEqual(f.state.rolls.map(({ id, length_m, actual_weight_kg, unit_cost, status }) => ({ id, length_m, actual_weight_kg, unit_cost, status })), before);
  assert.equal(f.state.movements, 4); assert.equal(f.state.head.status, 'CONFIRMED'); assert.equal(f.queries.at(-1), 'COMMIT'); assert.equal(f.released(), true);
  assert.ok(f.queries.some((q) => q.includes('ORDER BY id FOR UPDATE')));
});

test('failure after roll update rolls back the entire document', async () => {
  const f = fixture(); f.failMovement(); const before = structuredClone(f.state);
  await assert.rejects(transferTransaction(f.pool, (c) => confirmTransfer(c, 'company', 'user', 'doc')), /injected/);
  assert.deepEqual(f.state, before); assert.equal(f.queries.at(-1), 'ROLLBACK'); assert.equal(f.released(), true);
});

test('duplicate confirmation is a no-op and does not create additional movements', async () => {
  const f = fixture();
  await transferTransaction(f.pool, (c) => confirmTransfer(c, 'company', 'user', 'doc'));
  await transferTransaction(f.pool, (c) => confirmTransfer(c, 'company', 'user', 'doc'));
  assert.equal(f.state.movements, 4);
});

test('duplicate submission returns existing document; different payload conflicts', async () => {
  const f = fixture(); const d = input();
  const result = await saveTransfer(f.client, 'company', 'user', d);
  assert.equal(result.id, 'doc'); assert.equal(f.state.movements, 0);
  await assert.rejects(saveTransfer(f.client, 'company', 'user', { ...d, notes: 'different' }), /بيانات مختلفة/);
});

test('request hash is stable across roll order and includes quantities and locations', () => {
  const d = input(); assert.equal(transferRequestHash(d), transferRequestHash({ ...d, lines: [...d.lines].reverse() }));
  assert.notEqual(transferRequestHash(d), transferRequestHash({ ...d, fromLocationId: 'other' }));
});

test('backend rejects duplicate, missing, wrong source/location, non-whole and unavailable rolls', async () => {
  for (const mode of ['duplicate', 'missing', 'source', 'location', 'quantity', 'RESERVED', 'SOLD', 'DAMAGED', 'zero']) {
    const f = fixture(); const d = input();
    if (mode === 'duplicate') d.lines.push(d.lines[0]);
    else if (mode === 'missing') f.state.rolls.pop();
    else if (mode === 'source') f.state.rolls[0].warehouse_id = 'other';
    else if (mode === 'location') d.fromLocationId = 'shelf';
    else if (mode === 'quantity') d.lines[0].quantity = 2;
    else if (mode === 'zero') f.state.rolls[0].length_m = '0';
    else f.state.rolls[0].status = mode;
    await assert.rejects(lockTransferRolls(f.client, 'company', d), undefined, mode);
    assert.equal(f.state.movements, 0);
  }
});

test('same warehouse and stale document revision are rejected before moving inventory', async () => {
  const f = fixture(); f.state.head.to_warehouse_id = 'source';
  await assert.rejects(confirmTransfer(f.client, 'company', 'user', 'doc'), /المصدر نفسه/);
  const g = fixture(); await assert.rejects(confirmTransfer(g.client, 'company', 'user', 'doc', '2026-02-01T00:00:00Z'), /تغيّرت المسودة/);
  assert.equal(g.state.movements, 0);
});

test('cancel locks the document and cannot cancel a confirmed transfer', async () => {
  const f = fixture(); await cancelTransfer(f.client, 'company', 'doc'); assert.equal(f.state.head.status, 'CANCELLED');
  const g = fixture(); g.state.head.status = 'CONFIRMED'; await assert.rejects(cancelTransfer(g.client, 'company', 'doc'), /مؤكدة/);
  assert.ok(g.queries[0].includes('FOR UPDATE'));
});

test('missing/inactive warehouses and invalid source/destination locations are rejected', async () => {
  const a = fixture(); a.state.warehouses.pop();
  await assert.rejects(validateTransferWarehouses(a.client, 'company', input()), /غير موجود أو غير نشط/);
  const b = fixture(); b.state.warehouses[0].is_active = false;
  await assert.rejects(validateTransferWarehouses(b.client, 'company', input()), /غير موجود أو غير نشط/);
  for (const patch of [{ fromLocationId: 'bad' }, { toLocationId: 'bad' }]) {
    const c = fixture(); await assert.rejects(validateTransferWarehouses(c.client, 'company', { ...input(), ...patch }), /موقع التخزين/);
  }
});
