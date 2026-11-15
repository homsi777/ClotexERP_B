import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligibleTransferRoll, groupTransferRolls, loadAllTransferRolls, mergeTransferSelection, transferColorRolls, transferTotals, type TransferRoll } from './transferSelection.js';

const roll = (id: string, patch: Partial<TransferRoll> = {}): TransferRoll => ({
  id, item_id: 'fabric-a', color_id: 'red', warehouse_id: 'source', location_id: 'shelf',
  status: 'AVAILABLE', length_m: '12.345', actual_weight_kg: '2.5', calculated_weight_kg: '2', ...patch,
});

test('single, multiple fabrics, entire fabric, and colors share one deduplicated selection', () => {
  const rows = [roll('a'), roll('b'), roll('c', { color_id: 'blue' }), roll('d', { item_id: 'fabric-b' })];
  let selected = mergeTransferSelection([], [rows[0]]);
  selected = mergeTransferSelection(selected, rows.filter((r) => r.item_id === 'fabric-a' && r.color_id === 'red'));
  assert.equal(selected.length, 2);
  selected = selected.filter((r) => r.id !== 'a');
  assert.deepEqual(selected.map((r) => r.id), ['b']);
  selected = mergeTransferSelection(selected, rows.filter((r) => r.item_id === 'fabric-a'));
  selected = mergeTransferSelection(selected, rows.filter((r) => r.item_id === 'fabric-b'));
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected.map((r) => r.id)).size, 4);
});

test('eligibility respects source/location, positive length, and excludes all unavailable states', () => {
  for (const status of ['RESERVED', 'SOLD', 'DAMAGED', 'TRANSFERRED', 'INACTIVE']) assert.equal(eligibleTransferRoll(roll('x', { status }), 'source'), false);
  assert.equal(eligibleTransferRoll(roll('x'), 'other'), false);
  assert.equal(eligibleTransferRoll(roll('x'), 'source', 'other'), false);
  assert.equal(eligibleTransferRoll(roll('x', { length_m: '0' }), 'source'), false);
  assert.equal(eligibleTransferRoll(roll('x'), 'source', 'shelf'), true);
});

test('loads more than 30 pages and every eligible roll; source location remains enforced', async () => {
  let calls = 0;
  const rows = await loadAllTransferRolls(async (page) => {
    calls++;
    return { data: [roll(String(page), { location_id: page === 35 ? 'other' : 'shelf' })], total: 35 };
  }, 'source', 'shelf');
  assert.equal(calls, 35); assert.equal(rows.length, 34);
});

test('incomplete pagination fails instead of silently selecting a partial fabric', async () => {
  await assert.rejects(loadAllTransferRolls(async () => ({ data: [roll('same')], total: 2 }), 'source'), /لم يكتمل/);
});

test('stale source requests are discarded', async () => {
  let cancelled = false;
  const rows = await loadAllTransferRolls(async () => { cancelled = true; return { data: [roll('a')], total: 1 }; }, 'source', '', () => cancelled);
  assert.deepEqual(rows, []);
});

test('totals preserve precision and distinguish actual, estimated and unknown weight', () => {
  const t = transferTotals([roll('a'), roll('b', { actual_weight_kg: null }), roll('c', { actual_weight_kg: null, calculated_weight_kg: null })]);
  assert.equal(t.rolls, 3); assert.ok(Math.abs(t.meters - 37.035) < 1e-9);
  assert.equal(t.kilograms, 4.5); assert.equal(t.unknownWeight, 1); assert.equal(t.estimatedWeight, 1);
});

test('color selection never includes another fabric sharing the same color', () => {
  const rows = [roll('a'), roll('b', { color_id: 'blue' }), roll('c', { item_id: 'fabric-b' })];
  let selected = mergeTransferSelection([], transferColorRolls(rows, 'fabric-a', 'red'));
  assert.deepEqual(selected.map((r) => r.id), ['a']);
  selected = mergeTransferSelection(selected, transferColorRolls(rows, 'fabric-a', 'blue'));
  selected = mergeTransferSelection(selected, transferColorRolls(rows, 'fabric-b', 'red'));
  selected = selected.filter((r) => r.id !== 'a');
  assert.deepEqual(selected.map((r) => r.id), ['b', 'c']);
});

test('review groups separate fabrics, colors and rolls with no color without losing totals', () => {
  const rows = [roll('a'), roll('b'), roll('c', { color_id: 'blue' }), roll('d', { item_id: 'fabric-b' }), roll('e', { color_id: null })];
  const groups = groupTransferRolls(rows);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups[0].map((r) => r.id), ['a', 'b']);
  assert.equal(groups.flat().length, rows.length);
  assert.ok(Math.abs(groups.reduce((sum, group) => sum + transferTotals(group).meters, 0) - transferTotals(rows).meters) < 1e-9);
});
