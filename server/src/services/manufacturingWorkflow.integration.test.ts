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
  const { manufacturingCostRoutes } = await import('../routes/manufacturingCostRoutes.js');
  const { externalJobRoutes } = await import('../routes/externalJobRoutes.js');
  const app = Fastify();
  try {
    await app.register(manufacturingWorkOrderRoutes, { prefix: '/orders' });
    await app.register(manufacturingWarpingRoutes, { prefix: '/warping' });
    await app.register(manufacturingSizingRoutes, { prefix: '/sizing' });
    await app.register(manufacturingWeavingRoutes, { prefix: '/weaving' });
    await app.register(manufacturingQualityRoutes, { prefix: '/quality' });
    await app.register(manufacturingCostRoutes, { prefix: '/cost' });
    await app.register(externalJobRoutes, { prefix: '/external' });
    const company = randomUUID(), user = randomUUID(), warehouse = randomUUID(), item = randomUUID(), yarn = randomUUID();
    const spec = randomUUID(), version = randomUUID();
    const warpMachine = randomUUID(), loom = randomUUID(), sizingMachine = randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES ($1,'FLOW','Test factory')", [company]);
    await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES ($1,$2,'flow-user','unused')", [user, company]);
    await admin.query("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'RAW','Raw')", [warehouse, company]);
    await admin.query("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'TEST-FABRIC','Test fabric')", [item, company]);
    await admin.query("INSERT INTO yarn_lots(id,company_id,barcode,item_id,warehouse_id,weight_kg,unit_cost) VALUES ($1,$2,'YARN-1',$3,$4,100,10)", [yarn, company, item, warehouse]);
    const weft=randomUUID(),chemical=randomUUID(),supplier=randomUUID(),prep=randomUUID();
    await admin.query("INSERT INTO yarn_lots(id,company_id,barcode,item_id,warehouse_id,weight_kg,unit_cost) VALUES ($1,$3,'WEFT',$4,$5,100,4),($2,$3,'CHEMICAL',$4,$5,100,2)",[weft,chemical,company,item,warehouse]);
    await admin.query("UPDATE warehouses SET fabric_stage='RAW' WHERE id=$1",[warehouse]);
    await admin.query("INSERT INTO suppliers(id,company_id,code,name,is_processing_party) VALUES($1,$2,'DYE','Dye house',true)",[supplier,company]);
    await admin.query("INSERT INTO external_job_preparation_types(id,company_id,name) VALUES($1,$2,'Dyeing')",[prep,company]);
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
      await admin.query('UPDATE yarn_lots SET unit_cost=10 WHERE id=$1',[yarn]);
      if(!withSizing)await admin.query('UPDATE yarn_lots SET unit_cost=NULL WHERE id=$1',[weft]);
      const order = await call('POST', '/orders/', { specificationVersionId: version, targetLengthM: 100 }, 201);
      await call('POST', `/orders/${order.id}/release`, { version: 1 });
      const warp = await call('POST', '/warping/', { workOrderId: order.id, plannedLengthM: 100, warpingMachineId: warpMachine, targetLoomId: loom }, 201);
      await call('POST', `/warping/${warp.id}/release`, { version: 1 });
      const issue = await call('POST', `/warping/${warp.id}/yarn-issues`, { lines: [{ yarnLotId: yarn, requestedWeightKg: 20 }] }, 201);
      await call('POST', `/warping/yarn-issues/${issue.id}/issue`, {});
      await call('POST', `/warping/yarn-issues/${issue.id}/issue`, {}, 409);
      const issueLines = await admin.query('SELECT id FROM manufacturing_warping_yarn_issue_lines WHERE issue_id=$1', [issue.id]);
      await call('POST', `/warping/yarn-issues/${issue.id}/close`, { lines: [{ lineId: issueLines.rows[0].id, returnedWeightKg: 2, wasteWeightKg: 1 }] });
      await admin.query('UPDATE yarn_lots SET unit_cost=99 WHERE id=$1',[yarn]);
      await call('POST', `/warping/${warp.id}/transition`, { version: 2, targetStatus: 'IN_PROGRESS' });
      await call('POST', `/warping/${warp.id}/complete`, { version: 3, actualLengthM: 100, qualityStatus: 'ACCEPTED', nextStage: withSizing ? 'SIZING' : 'WEAVING' });
      const beam = (await admin.query('SELECT id FROM manufacturing_warp_beams WHERE warping_order_id=$1', [warp.id])).rows[0];
      let beamId = beam.id;
      if (withSizing) {
        const sizing = await call('POST', '/sizing/', { inputBeamId: beam.id, sizingMachineId: sizingMachine }, 201);
        await call('POST', '/sizing/', { inputBeamId: beam.id, sizingMachineId: sizingMachine }, 409);
        await call('POST', `/sizing/${sizing.id}/start`, {});
        await call('POST', `/sizing/${sizing.id}/complete`, { actualLengthM: 100, qualityStatus: 'ACCEPTED' },400);
        const chemicalIssue=await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'SIZING',stageId:sizing.id,lotId:chemical,kind:'ISSUE',weightKg:5,wasteKg:0.5,notes:'Sizing recipe materials'});
        await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'SIZING',stageId:sizing.id,lotId:chemical,kind:'RETURN',sourceEntryId:chemicalIssue.id,weightKg:1,notes:'Unused chemical return'});
        await call('POST', `/sizing/${sizing.id}/complete`, { actualLengthM: 100, qualityStatus: 'ACCEPTED' });
        beamId = (await admin.query('SELECT id FROM manufacturing_sized_beams WHERE sizing_order_id=$1', [sizing.id])).rows[0].id;
      }
      const run = await call('POST', '/weaving/', { beamType: withSizing ? 'SIZED' : 'WARP', beamId, loomId: loom, openingCounter: 0 }, 201);
      await call('POST', '/weaving/', { beamType: withSizing ? 'SIZED' : 'WARP', beamId, loomId: loom }, 409);
      await call('POST', `/weaving/${run.id}/start`, {});
      const materialBody={requestId:randomUUID(),stage:'WEAVING',stageId:run.id,lotId:weft,kind:'ISSUE',weightKg:10,wasteKg:1,notes:'Weft consumption'};
      const concurrentMaterials=await Promise.all([call('POST',`/cost/${order.id}/materials`,materialBody),call('POST',`/cost/${order.id}/materials`,materialBody)]);
      assert.equal(concurrentMaterials[0].id,concurrentMaterials[1].id);
      await call('POST',`/cost/${order.id}/materials`,{...materialBody,weightKg:11},409);
      await call('POST',`/cost/${order.id}/materials`,{...materialBody,requestId:randomUUID(),weightKg:1000},400);
      await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'WEAVING',stageId:run.id,lotId:weft,kind:'RETURN',sourceEntryId:concurrentMaterials[0].id,weightKg:2,notes:'Unused weft return'});
      if(!withSizing){
        const unrated=await call('GET',`/cost/${order.id}`);assert.equal(unrated.unrated,1);
        await call('POST',`/cost/${order.id}/price-material`,{source:'MATERIAL',entryId:concurrentMaterials[0].id,unitCost:4,currencyCode:'USD',notes:'Approved supplier price'});
        await admin.query('UPDATE yarn_lots SET unit_cost=4 WHERE id=$1',[weft]);
      }
      await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'WEAVING',stageId:run.id,lotId:weft,kind:'RETURN',sourceEntryId:concurrentMaterials[0].id,weightKg:8,notes:'Excess return'},400);
      await call('POST',`/cost/${order.id}/charges`,{requestId:randomUUID(),kind:'LABOR',amount:20,currencyCode:'USD',notes:'Labor allocation, not payroll payment'});
      await call('POST',`/cost/${order.id}/charges`,{requestId:randomUUID(),kind:'ENERGY',amount:10,currencyCode:'USD',notes:'Energy allocation'});
      await call('POST',`/cost/${order.id}/charges`,{requestId:randomUUID(),kind:'LABOR',amount:1,currencyCode:'USD',notes:'Not authorized'},403,readonly);
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
      const costRoll=(await admin.query('SELECT result_fabric_roll_id id FROM manufacturing_raw_roll_outputs WHERE production_batch_id=$1 LIMIT 1',[batch.id])).rows[0].id;
      await assert.rejects(admin.query("UPDATE fabric_rolls SET status='SOLD' WHERE id=$1",[costRoll]),(e:unknown)=>(e as {code?:string}).code==='23514');
      await call('POST', `/orders/${order.id}/transition`, { targetStatus: 'COMPLETED', version: 3 }, 400);
      await call('POST', `/orders/${order.id}/transition`, { targetStatus: 'COMPLETED', version: 3, reason: '10m rejected by quality' });
      if(withSizing){
        const original=(await admin.query('SELECT result_fabric_roll_id id FROM manufacturing_raw_roll_outputs WHERE production_batch_id=$1 AND length_m=40',[batch.id])).rows[0].id;
        const job=await call('POST','/external/processing',{supplierId:supplier,fabricStage:'RAW',preparationTypeId:prep,sourceWarehouseId:warehouse,rollIds:[original]},201);
        assert.equal((await admin.query('SELECT work_order_id FROM manufacturing_external_links WHERE company_id=$1 AND job_id=$2',[company,job.id])).rows[0].work_order_id,order.id);
        await call('POST',`/cost/${order.id}/external-link`,{jobId:job.id});
        await call('POST',`/cost/${order.id}/finalize`,{},400);
        const overview=await call('GET',`/external/${job.id}/lifecycle`);
        const returnBody={requestId:randomUUID(),dyePaperNo:'DYE-1',destinationWarehouseId:warehouse,lines:[{sourceLineId:overview.lines[0].id,lengthM:35,defective:true,defectReason:'DYE_HOUSE',responsibleParty:'Dye house',notes:'Check shade'}]};
        await call('POST',`/external/${job.id}/lifecycle/returns`,returnBody);
        const returns=await call('GET',`/external/${job.id}/lifecycle`);
        const returned=(await admin.query('SELECT id FROM external_job_return_lines WHERE job_id=$1',[job.id])).rows[0];
        await call('POST',`/external/${job.id}/lifecycle/resolve-defect`,{returnLineId:returned.id,decision:'ACCEPT',notes:'Quality approved shade'});
        await call('POST',`/external/${job.id}/lifecycle/settlements`,{sourceLineId:overview.lines[0].id,amountM:5,reason:'Approved process shrinkage'});
        await call('POST',`/external/${job.id}/lifecycle/service-pricing`,{lines:[{serviceId:returns.services[0].id,unitPrice:0.5,currencyCode:'USD',basis:'METER',approvedQuantity:35}]});
        await call('POST',`/external/${job.id}/lifecycle/close`,{});
      }
      const report=await call('GET',`/cost/${order.id}`);
      assert.equal(report.unrated,0);
      assert.equal(report.totalUsd,withSizing?267.5:242);
      assert.equal(report.acceptedLengthM,withSizing?85:90);
      await call('POST',`/cost/${order.id}/finalize`,{});
      await call('POST',`/cost/${order.id}/finalize`,{});
      const allocated=await admin.query('SELECT SUM(allocated_usd) amount FROM manufacturing_cost_allocations WHERE company_id=$1 AND work_order_id=$2',[company,order.id]);
      assert.equal(Number(allocated.rows[0].amount),report.totalUsd);
      await call('POST',`/cost/${order.id}/charges`,{requestId:randomUUID(),kind:'ENERGY',amount:1,currencyCode:'USD',notes:'Forbidden after cost closure'},400);
    }
    assert.equal(Number((await getPool().query('SELECT weight_kg FROM yarn_lots WHERE id=$1', [yarn])).rows[0].weight_kg), 64);
    assert.equal(Number((await getPool().query('SELECT weight_kg FROM yarn_lots WHERE id=$1', [weft])).rows[0].weight_kg),84);
    assert.equal(Number((await getPool().query('SELECT weight_kg FROM yarn_lots WHERE id=$1', [chemical])).rows[0].weight_kg),96);
    console.log('Reconciled: warp 36kg net, weft 16kg net, sizing 4kg net; external quality/shrinkage; final output 175m; costs USD 242 + 267.5 allocated exactly once');
  } finally {
    await app.close();
    await resetPool();
    // The schema was generated here on the explicitly guarded local test instance.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
