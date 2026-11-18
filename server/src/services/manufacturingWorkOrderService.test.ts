import assert from 'node:assert/strict';
import { generateManufacturingWorkOrderNo } from './manufacturingWorkOrderService.js';

const queries: Array<{ sql: string; params?: unknown[] }> = [];
const client = {
  query: async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes('MAX((substring(work_order_no')) return { rows: [{ max_seq: '41' }] };
    return { rows: [] };
  },
} as never;

assert.equal(await generateManufacturingWorkOrderNo(client, 'company-1'), 'WO0000042');
assert.equal(queries.length, 2);
assert.equal(queries[0].sql.includes('pg_advisory_xact_lock'), true);
assert.deepEqual(queries[0].params, ['company-1']);
assert.equal(queries[1].sql.includes("work_order_no ~ '^WO[0-9]{7}$'"), true);

console.log('manufacturingWorkOrderService tests passed');
