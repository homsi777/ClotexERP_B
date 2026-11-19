import assert from 'node:assert/strict';
import { buildWarpCardData, canTransitionWarpingOrder, generateWarpCardNo, generateWarpingOrderNo } from './manufacturingWarpingService.js';

const queries: Array<{ sql: string; params?: unknown[] }> = [];
const client = { query: async (sql: string, params?: unknown[]) => {
  queries.push({ sql, params });
  if (sql.includes('manufacturing_warping_orders')) return { rows: [{ max_seq: '8' }] };
  if (sql.includes('manufacturing_warp_cards')) return { rows: [{ max_seq: '12' }] };
  return { rows: [] };
} } as never;

assert.equal(await generateWarpingOrderNo(client, 'c1'), 'WRP0000009');
assert.equal(await generateWarpCardNo(client, 'c1'), 'WC0000013');
assert.equal(queries.filter((q) => q.sql.includes('pg_advisory_xact_lock')).length, 2);
assert.equal(canTransitionWarpingOrder('DRAFT', 'RELEASED'), true);
assert.equal(canTransitionWarpingOrder('RELEASED', 'COMPLETED'), false);
assert.equal(canTransitionWarpingOrder('COMPLETED', 'CANCELLED'), false);

const card = buildWarpCardData({
  specificationSnapshot: { code: 'FAB-01', parsed_data: {
    technicalFields: { 'عرض مشط النسيج': 180, 'إجمالى عدد الخيوط': 4200 },
    warp: { yarnCount: '30/1', requirements: [], pattern: [
      { sequenceNo: 1, sourceCell: 'H3', colorName: 'أبيض', threadOrPickCount: 10, repeatCount: 2 },
      { sequenceNo: 2, sourceCell: 'H4', colorName: 'ابيض', threadOrPickCount: 4, repeatCount: 1 },
      { sequenceNo: 3, sourceCell: 'H5', colorName: 'بني', threadOrPickCount: 3, repeatCount: 1 },
    ] },
  } },
  plannedLengthM: 1200, loomLabel: 'L-01', operatorName: 'عامل 1', shiftName: 'صباحي', tieCount: 24,
  issuedAt: new Date('2026-11-18T10:00:00.000Z'),
});
assert.equal(card.itemCode, 'FAB-01');
assert.equal(card.mirageCount, 2);
assert.equal(card.reedWidth, 180);
assert.equal(card.totalWarpThreads, 4200);
assert.equal(card.warpYarnCount, '30/1');

console.log('manufacturingWarpingService tests passed');
