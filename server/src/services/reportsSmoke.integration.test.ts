import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

/** يشغّل كل تقارير الأقمشة/المبيعات/الإدارة على قاعدة فارغة للتأكد من سلامة استعلامات SQL (فصل الأمتار عن الكيلو). */
test('reports and management metrics run without SQL errors after meters/kg split', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'rs_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    setPoolOverrideForTests({ connect: async () => ({ query: (s: string, p?: unknown[]) => db.query(s, p), release: () => undefined, on: () => undefined }), query: (s: string, p?: unknown[]) => db.query(s, p), on: () => undefined });
    const company = randomUUID();
    await db.query("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع',true)", [company]);

    const bad: string[] = [];
    let ran = 0;
    for (const mod of ['./reportService.js', './reportServiceMore.js', './reportServiceExtended.js']) {
      const m = (await import(mod)) as Record<string, unknown>;
      for (const [name, fn] of Object.entries(m)) {
        if (typeof fn !== 'function' || !/^report/i.test(name)) continue;
        await db.query('SAVEPOINT s1');
        try { await (fn as (c: string, q?: Record<string, string>) => Promise<unknown>)(company, {}); ran++; await db.query('RELEASE SAVEPOINT s1'); }
        catch (e) {
          await db.query('ROLLBACK TO SAVEPOINT s1');
          const msg = e instanceof Error ? e.message : String(e);
          if (/uuid/i.test(msg)) continue; // دوال بتوقيع مختلف (تحتاج معرّف عميل)
          if (/syntax|column|does not exist|ambiguous|operator|function/i.test(msg)) bad.push(`${name}: ${msg}`);
        }
      }
    }
    const { getBranchMetrics } = await import('./managementMetricsService.js');
    await db.query('SAVEPOINT s2');
    try {
      await getBranchMetrics({ query: (sql: string, p?: unknown[]) => db.query(sql, p) } as never, company, { kind: 'custom', from: '2020-01-01', to: '2030-01-01', prevFrom: '2010-01-01', prevTo: '2019-12-31', label: 't' });
    } catch (e) { await db.query('ROLLBACK TO SAVEPOINT s2'); bad.push(`metrics: ${e instanceof Error ? e.message : e}`); }
    const db2 = { query: (sql: string, p?: unknown[]) => db.query(sql, p) } as never;
    const per = { kind: 'custom', from: '2020-01-01', to: '2030-01-01', prevFrom: '2010-01-01', prevTo: '2019-12-31', label: 't' } as never;
    const wh = randomUUID(), it = randomUUID();
    await db.query("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'W1','الرئيسي')", [wh, company]);
    const { getBranchAnalytics } = await import('./managementAnalyticsService.js');
    const { listCostGroups, profitability } = await import('./adminCostService.js');
    const { zoneSummary, zoneContents, itemDistribution, pendingAlerts } = await import('./warehouseZoneService.js');
    const extra: Array<[string, () => Promise<unknown>]> = [
      ['analytics', () => getBranchAnalytics(db2, company, per)], ['costGroups', () => listCostGroups(db2, company)], ['profitability', () => profitability(db2, company, '2020-01-01', '2030-01-01', 'item')],
      ['zoneSummary', () => zoneSummary(db2, company, wh)], ['zoneContents', () => zoneContents(db2, company, wh, null)], ['itemDistribution', () => itemDistribution(db2, company, wh, it)], ['pendingAlerts', () => pendingAlerts(db2, company)],
    ];
    for (const [n, f] of extra) { await db.query('SAVEPOINT s3'); try { await f(); await db.query('RELEASE SAVEPOINT s3'); ran++; } catch (e) { await db.query('ROLLBACK TO SAVEPOINT s3'); bad.push(`${n}: ${e instanceof Error ? e.message : e}`); } }
    assert.ok(ran > 10, `ran ${ran}`);
    assert.deepEqual(bad, []);
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
