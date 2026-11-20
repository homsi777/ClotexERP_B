import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('warping partial outputs, card route and sizing recipe revisions', {
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
  const app = Fastify();
  try {
    await app.register(manufacturingWorkOrderRoutes, {prefix:'/orders'});
    await app.register(manufacturingWarpingRoutes, {prefix:'/warping'});
    await app.register(manufacturingSizingRoutes, {prefix:'/sizing'});
    const company = randomUUID(), user = randomUUID(), warehouse = randomUUID(), item = randomUUID(), yarn = randomUUID();
    const spec = randomUUID(), version = randomUUID();
    const warpMachine = randomUUID(), loom = randomUUID(), sizingMachine = randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES ($1,'FLOW','Test factory')", [company]);
    await admin.query("INSERT INTO exchange_rates(company_id,currency_code,currency_name_ar,exchange_rate_to_usd) VALUES($1,'EGP','EGP',50)",[company]);
    await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES ($1,$2,'flow-user','unused')", [user, company]);
    await admin.query("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'RAW','Raw')", [warehouse, company]);
    await admin.query("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'TEST-FABRIC','Test fabric')", [item, company]);
    await admin.query("INSERT INTO yarn_lots(id,company_id,barcode,item_id,warehouse_id,weight_kg,unit_cost) VALUES ($1,$2,'YARN-1',$3,$4,100,10)", [yarn, company, item, warehouse]);
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
    const order=await call('POST','/orders/',{specificationVersionId:version,targetLengthM:1000},201);
    await call('POST',`/orders/${order.id}/release`,{version:1});
    const warp=await call('POST','/warping/',{workOrderId:order.id,plannedLengthM:1000,warpingMachineId:warpMachine},201);
    await call('POST',`/warping/${warp.id}/release`,{version:1,nextStage:'SIZING'});
    const issue=await call('POST',`/warping/${warp.id}/yarn-issues`,{lines:[{yarnLotId:yarn,requestedWeightKg:20}]},201);
    await call('POST',`/warping/yarn-issues/${issue.id}/issue`,{});
    await call('POST',`/warping/${warp.id}/transition`,{version:2,targetStatus:'IN_PROGRESS'});
    const payload={version:3,actualLengthM:400,qualityStatus:'ACCEPTED',closeOrder:false};
    await call('POST',`/warping/${warp.id}/complete`,{...payload,nextStage:'WEAVING'},409);
    assert.equal((await call('POST',`/warping/${warp.id}/complete`,payload)).status,'IN_PROGRESS');
    await call('POST',`/warping/${warp.id}/complete`,payload,409);
    await call('POST',`/warping/${warp.id}/complete`,{version:4,actualLengthM:600,qualityStatus:'ACCEPTED'},409);
    const line=(await admin.query('SELECT id FROM manufacturing_warping_yarn_issue_lines WHERE issue_id=$1',[issue.id])).rows[0];
    await call('POST',`/warping/yarn-issues/${issue.id}/settlement/propose`,{version:0,reason:'Unused yarn and recorded waste',lines:[{lineId:line.id,consumedKg:16,returnedKg:2,wasteKg:1}]});
    assert.equal(Number((await admin.query('SELECT weight_kg FROM yarn_lots WHERE id=$1',[yarn])).rows[0].weight_kg),80);
    await call('POST',`/warping/yarn-issues/${issue.id}/close`,{lines:[{lineId:line.id,returnedWeightKg:2,wasteWeightKg:1}]},400);
    await call('POST',`/warping/yarn-issues/${issue.id}/settlement/approve`,{version:1,reason:'Measured and approved discrepancy',receivedReturns:[{lineId:line.id,weightKg:1}]},409);
    await call('POST',`/warping/yarn-issues/${issue.id}/settlement/approve`,{version:1,reason:'Measured and approved discrepancy',receivedReturns:[{lineId:line.id,weightKg:2}]});
    assert.equal(Number((await admin.query('SELECT weight_kg FROM yarn_lots WHERE id=$1',[yarn])).rows[0].weight_kg),82);
    assert.equal(Number((await admin.query('SELECT approved_difference_kg FROM manufacturing_warping_yarn_issue_lines WHERE id=$1',[line.id])).rows[0].approved_difference_kg),1);
    const concurrent=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`/warping/${warp.id}/complete`,headers:{authorization:`Bearer ${token}`},payload:{version:4,actualLengthM:600,qualityStatus:'ACCEPTED'}})));
    assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[200,409]);
    const beams=(await admin.query('SELECT * FROM manufacturing_warp_beams WHERE warping_order_id=$1 ORDER BY beam_no',[warp.id])).rows;
    assert.equal(beams.length,2);assert.notEqual(beams[0].barcode,beams[1].barcode);
    assert.deepEqual(beams.map(b=>Number(b.length_m)),[400,600]);
    assert.ok(beams.every(b=>b.status==='READY_FOR_SIZING'));
    assert.equal(Number((await admin.query('SELECT actual_length_m FROM manufacturing_warping_orders WHERE id=$1',[warp.id])).rows[0].actual_length_m),1000);
    const r1=await call('POST','/sizing/recipes',{code:'R1',name:'Starch',recipe:{starchKg:10,temperature:80}},201);
    const sizing={inputBeamId:beams[0].id,sizingMachineId:sizingMachine,recipeRevisionId:r1.id};
    await call('POST','/sizing/',sizing,400);
    await call('POST',`/sizing/recipes/${r1.id}/approve`,{});
    await call('POST','/sizing/',{...sizing,recipe:{temperature:85}},400);
    const batch=await call('POST','/sizing/',sizing,201);
    await call('POST','/sizing/',sizing,409);
    const r2=await call('POST','/sizing/recipes',{code:'R1',name:'Starch new',recipe:{starchKg:15,temperature:90}},201);
    assert.equal(r2.revision,2);
    await call('POST',`/sizing/recipes/${r2.id}/approve`,{});
    const snapshot=(await admin.query('SELECT recipe,recipe_revision_id FROM manufacturing_sizing_orders WHERE id=$1',[batch.id])).rows[0];
    assert.deepEqual(snapshot.recipe,{starchKg:10,temperature:80});assert.equal(snapshot.recipe_revision_id,r1.id);
    const deviation=await call('POST','/sizing/',{inputBeamId:beams[1].id,sizingMachineId:sizingMachine,recipeRevisionId:r1.id,recipe:{temperature:85},recipeDeviationReason:'Trial adjustment'},201);
    const adjusted=(await admin.query('SELECT recipe,recipe_deviation_reason FROM manufacturing_sizing_orders WHERE id=$1',[deviation.id])).rows[0];
    assert.deepEqual(adjusted.recipe,{starchKg:10,temperature:85});assert.equal(adjusted.recipe_deviation_reason,'Trial adjustment');
    // Legacy /complete request contract used by the parent workflow remains supported.
    const legacy=await call('POST','/warping/',{workOrderId:order.id,plannedLengthM:100,warpingMachineId:warpMachine},201);
    await call('POST',`/warping/${legacy.id}/release`,{version:1});
    const legacyIssue=await call('POST',`/warping/${legacy.id}/yarn-issues`,{lines:[{yarnLotId:yarn,requestedWeightKg:5}]},201);
    await call('POST',`/warping/yarn-issues/${legacyIssue.id}/issue`,{});
    const legacyLine=(await admin.query('SELECT id FROM manufacturing_warping_yarn_issue_lines WHERE issue_id=$1',[legacyIssue.id])).rows[0];
    await call('POST',`/warping/yarn-issues/${legacyIssue.id}/close`,{lines:[{lineId:legacyLine.id,returnedWeightKg:0,wasteWeightKg:0}]});
    await call('POST',`/warping/${legacy.id}/transition`,{version:2,targetStatus:'IN_PROGRESS'});
    await call('POST',`/warping/${legacy.id}/complete`,{version:3,actualLengthM:100,qualityStatus:'REJECTED',nextStage:'SIZING'});
    const rejected=(await admin.query('SELECT id,status FROM manufacturing_warp_beams WHERE warping_order_id=$1',[legacy.id])).rows[0];
    assert.equal(rejected.status,'REJECTED');
    await call('POST','/sizing/',{inputBeamId:rejected.id,sizingMachineId:sizingMachine},409);
    const other=randomUUID(),otherUser=randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES($1,'OTHER','Other')",[other]);
    await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES($1,$2,'other','unused')",[otherUser,other]);
    const otherToken=signAuthToken({sub:otherUser,companyId:other,username:'other',role:'admin',permissions:[],isPlatformAdmin:false});
    await call('POST',`/sizing/recipes/${r1.id}/approve`,{},409,otherToken);
    assert.deepEqual(await call('GET','/sizing/recipes',undefined,200,otherToken),[]);
    const viewer=signAuthToken({sub:user,companyId:company,username:'viewer',role:'user',permissions:[],isPlatformAdmin:false});
    await call('POST','/sizing/recipes',{code:'X',name:'X',recipe:{}},403,viewer);
  } finally {
    await app.close();await resetPool();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
