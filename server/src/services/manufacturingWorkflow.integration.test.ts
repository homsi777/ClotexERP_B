import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('real manufacturing HTTP workflow: yarn to inspected warehouse rolls', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  assert.equal(url.search, '');
  const admin = new pg.Client({ connectionString: url.href });
  await admin.connect();
  const schema = `manufacturing_flow_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}, public`);
  const dir = new URL('../db/migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(await readFile(new URL(file, dir), 'utf8'));
  }
  url.searchParams.set('options', `-c search_path=${schema},public -c client_encoding=UTF8`);
  process.env.DATABASE_URL = url.href;
  process.env.NODE_ENV = 'test';
  process.env.CLOTEX_EMBEDDED_SERVER = '1';
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  const { default: Fastify } = await import('fastify');
  const { getPool, resetPool } = await import('../db/pool.js');
  const { signAuthToken } = await import('../middleware/auth.js');
  const { manufacturingWorkOrderRoutes } = await import('../routes/manufacturingWorkOrderRoutes.js');
  const { manufacturingWarpingRoutes } = await import('../routes/manufacturingWarpingRoutes.js');
  const { manufacturingSizingRoutes } = await import('../routes/manufacturingSizingRoutes.js');
  const { manufacturingWeavingRoutes } = await import('../routes/manufacturingWeavingRoutes.js');
  const { manufacturingQualityRoutes } = await import('../routes/manufacturingQualityRoutes.js');
  const app = Fastify();
  try {
    await app.register(manufacturingWorkOrderRoutes, { prefix: '/orders' });
    await app.register(manufacturingWarpingRoutes, { prefix: '/warping' });
    await app.register(manufacturingSizingRoutes, { prefix: '/sizing' });
    await app.register(manufacturingWeavingRoutes, { prefix: '/weaving' });
    await app.register(manufacturingQualityRoutes, { prefix: '/quality' });
    const company = randomUUID(), user = randomUUID(), warehouse = randomUUID(), item = randomUUID(), yarn = randomUUID();
    const spec = randomUUID(), version = randomUUID();
    const warpMachine = randomUUID(), loom = randomUUID(), sizingMachine = randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES ($1,'FLOW','Test factory')", [company]);
    await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES ($1,$2,'flow-user','unused')", [user, company]);
    await admin.query("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'RAW','Raw')", [warehouse, company]);
    await admin.query("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'TEST-FABRIC','Test fabric')", [item, company]);
    await admin.query("INSERT INTO yarn_lots(id,company_id,barcode,item_id,warehouse_id,weight_kg) VALUES ($1,$2,'YARN-1',$3,$4,100)", [yarn, company, item, warehouse]);
    await admin.query("INSERT INTO manufacturing_specifications(id,company_id,code,name) VALUES ($1,$2,'SPEC','Test spec')", [spec, company]);
    await admin.query(`INSERT INTO manufacturing_specification_versions(id,company_id,specification_id,version_no,status,source_file_name,source_file_content,source_file_size,source_file_sha256,parsed_data,approved_at)
      VALUES($1,$2,$3,1,'APPROVED','test.xlsx',decode('00','hex'),1,repeat('0',64),'{}',now())`, [version, company, spec]);
    for (const [id, type] of [[warpMachine, 'WARPING'], [loom, 'LOOM'], [sizingMachine, 'SIZING']]) {
      await admin.query('INSERT INTO manufacturing_machines(id,company_id,code,name,machine_type) VALUES ($1,$2,$3,$3,$3)', [id, company, type]);
    }
    const token = signAuthToken({ sub: user, companyId: company, username: 'flow-user', role: 'admin', permissions: [], isPlatformAdmin: false });
    const call = async (method: 'GET'|'POST'|'PUT', path: string, payload?: object, status = 200, auth = token) => {
      const response = await app.inject({ method, url: path, payload, headers: { authorization: `Bearer ${auth}` } });
      assert.equal(response.statusCode, status, `${method} ${path}: ${response.body}`);
      return response.json().data;
    };
    const readonly = signAuthToken({ sub: user, companyId: company, username: 'flow-user', role: 'user', permissions: [], isPlatformAdmin: false });
    await call('POST', '/orders/', {}, 403, readonly);
    const otherCompany = randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES ($1,'OTHER','Other')", [otherCompany]);
    const otherToken = signAuthToken({ sub: user, companyId: otherCompany, username: 'flow-user', role: 'admin', permissions: [], isPlatformAdmin: false });
    await call('GET', '/orders/', undefined, 403, otherToken);
    // Exercise both optional-stage paths through the real handlers and transactions.
    for (const withSizing of [false, true]) {
      const order = await call('POST', '/orders/', { specificationVersionId: version, targetLengthM: 100 }, 201);
      await call('POST', `/orders/${order.id}/release`, { version: 1 });
      const warp = await call('POST', '/warping/', { workOrderId: order.id, plannedLengthM: 100, warpingMachineId: warpMachine, targetLoomId: loom }, 201);
      await call('POST', `/warping/${warp.id}/release`, { version: 1 });
      const issue = await call('POST', `/warping/${warp.id}/yarn-issues`, { lines: [{ yarnLotId: yarn, requestedWeightKg: 20 }] }, 201);
      await call('POST', `/warping/yarn-issues/${issue.id}/issue`, {});
      await call('POST', `/warping/yarn-issues/${issue.id}/issue`, {}, 409);
      const issueLines = await admin.query('SELECT id FROM manufacturing_warping_yarn_issue_lines WHERE issue_id=$1', [issue.id]);
      await call('POST', `/warping/yarn-issues/${issue.id}/close`, { lines: [{ lineId: issueLines.rows[0].id, returnedWeightKg: 2, wasteWeightKg: 1 }] });
      await call('POST', `/warping/${warp.id}/transition`, { version: 2, targetStatus: 'IN_PROGRESS' });
      await call('POST', `/warping/${warp.id}/complete`, { version: 3, actualLengthM: 100, qualityStatus: 'ACCEPTED', nextStage: withSizing ? 'SIZING' : 'WEAVING' });
      const beam = (await admin.query('SELECT id FROM manufacturing_warp_beams WHERE warping_order_id=$1', [warp.id])).rows[0];
      let beamId = beam.id;
      if (withSizing) {
        const sizing = await call('POST', '/sizing/', { inputBeamId: beam.id, sizingMachineId: sizingMachine }, 201);
        await call('POST', '/sizing/', { inputBeamId: beam.id, sizingMachineId: sizingMachine }, 409);
        await call('POST', `/sizing/${sizing.id}/start`, {});
        await call('POST', `/sizing/${sizing.id}/complete`, { actualLengthM: 100, qualityStatus: 'ACCEPTED' });
        beamId = (await admin.query('SELECT id FROM manufacturing_sized_beams WHERE sizing_order_id=$1', [sizing.id])).rows[0].id;
      }
      const run = await call('POST', '/weaving/', { beamType: withSizing ? 'SIZED' : 'WARP', beamId, loomId: loom, openingCounter: 0 }, 201);
      await call('POST', '/weaving/', { beamType: withSizing ? 'SIZED' : 'WARP', beamId, loomId: loom }, 409);
      await call('POST', `/weaving/${run.id}/start`, {});
      const shifts = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/weaving/${run.id}/shift-logs`,
        payload: { productionDate: '2026-11-19', counterStart: 0, counterEnd: 100 }, headers: { authorization: `Bearer ${token}` } })));
      assert.deepEqual(shifts.map((r) => r.statusCode).sort(), [201, 409], 'concurrent duplicate counters must produce one batch');
      await call('POST', `/weaving/${run.id}/shift-logs`, { productionDate: '2026-11-19', counterStart: 100, counterEnd: 100 }, 400);
      await call('POST', `/weaving/${run.id}/complete`, {});
      const batch = (await admin.query('SELECT id FROM manufacturing_production_batches WHERE weaving_run_id=$1', [run.id])).rows[0];
      await call('POST', `/orders/${order.id}/transition`, { targetStatus: 'COMPLETED', version: 3 }, 409);
      const receipt = { itemId: item, warehouseId: warehouse, rolls: [{ rollNo: `R-${withSizing}`, lengthM: 90 }] };
      await call('POST', `/quality/batches/${batch.id}/rolls`, receipt, 409);
      await call('PUT', `/quality/batches/${batch.id}/inspection`, { cleanLengthM: 90, reworkLengthM: 0, rejectedLengthM: 10, pendingLengthM: 0 });
      await call('POST', `/quality/batches/${batch.id}/approve`, {});
      await call('POST', `/quality/batches/${batch.id}/rolls`, { ...receipt, rolls: [{ rollNo: 'EXCESS', lengthM: 91 }] }, 400);
      const partial = { ...receipt, rolls: [{ rollNo: `R-${withSizing}-1`, lengthM: 40 }] };
      await call('POST', `/quality/batches/${batch.id}/rolls`, partial, 201);
      await call('POST', `/quality/batches/${batch.id}/rolls`, partial, 409);
      await call('POST', `/quality/batches/${batch.id}/rolls`, { ...receipt, rolls: [{ rollNo: `R-${withSizing}-2`, lengthM: 50 }] }, 201);
      const trace = await admin.query(`SELECT r.status,r.length_m,o.inspection_status,m.movement_type FROM manufacturing_raw_roll_outputs o
        JOIN fabric_rolls r ON r.id=o.result_fabric_roll_id JOIN inventory_movements m ON m.roll_id=r.id WHERE o.production_batch_id=$1`, [batch.id]);
      assert.equal(trace.rows.length, 2);
      assert.equal(trace.rows.reduce((sum, row) => sum + Number(row.length_m), 0), 90);
      for (const row of trace.rows) {
        assert.equal(row.status, 'AVAILABLE');
        assert.equal(row.inspection_status, 'ACCEPTED');
        assert.equal(row.movement_type, 'INTERNAL_PRODUCTION');
      }
      await call('POST', `/orders/${order.id}/transition`, { targetStatus: 'COMPLETED', version: 3 }, 400);
      await call('POST', `/orders/${order.id}/transition`, { targetStatus: 'COMPLETED', version: 3, reason: '10m rejected by quality' });
    }
    assert.equal(Number((await getPool().query('SELECT weight_kg FROM yarn_lots WHERE id=$1', [yarn])).rows[0].weight_kg), 64);
    console.log('Both manufacturing paths reconciled: 40kg issued, 4kg returned, 2kg waste, 34kg consumed; 180m accepted stock');
  } finally {
    await app.close();
    await resetPool();
    // The schema was generated here on the explicitly guarded local test instance.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
