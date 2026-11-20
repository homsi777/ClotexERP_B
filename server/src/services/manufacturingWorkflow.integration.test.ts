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
  const { warehouseZoneRoutes } = await import('../routes/warehouseZoneRoutes.js');
  const { manufacturingReferenceRoutes } = await import('../routes/manufacturingReferenceRoutes.js');
  const { customerOrderRoutes } = await import('../routes/customerOrderRoutes.js');
  const {yarnLotRoutes}=await import('../routes/yarnLotRoutes.js');
  const { assertInvoiceOrderRemaining } = await import('./customerOrderFulfillmentService.js');
  const {authRoutes}=await import('../routes/authRoutes.js');
  const {warehouseRoutes,warehouseLocationRoutes}=await import('../routes/warehouseRoutes.js');
  const app = Fastify();
  try {
    await app.register(manufacturingWorkOrderRoutes, { prefix: '/orders' });
    await app.register(manufacturingWarpingRoutes, { prefix: '/warping' });
    await app.register(manufacturingSizingRoutes, { prefix: '/sizing' });
    await app.register(manufacturingWeavingRoutes, { prefix: '/weaving' });
    await app.register(manufacturingQualityRoutes, { prefix: '/quality' });
    await app.register(manufacturingCostRoutes, { prefix: '/cost' });
    await app.register(externalJobRoutes, { prefix: '/external' });
    await app.register(warehouseZoneRoutes, { prefix: '/zones' });
    await app.register(manufacturingReferenceRoutes, { prefix: '/reference' });
    await app.register(customerOrderRoutes,{prefix:'/customer-orders'});
    await app.register(yarnLotRoutes,{prefix:'/yarn'});
    await app.register(authRoutes,{prefix:'/auth'});
    await app.register(warehouseRoutes,{prefix:'/warehouses'});
    await app.register(warehouseLocationRoutes,{prefix:'/locations'});
    const company = randomUUID(), user = randomUUID(), warehouse = randomUUID(), item = randomUUID(), yarn = randomUUID();
    const spec = randomUUID(), version = randomUUID();
    const warpMachine = randomUUID(), loom = randomUUID(), sizingMachine = randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES ($1,'FLOW','Test factory')", [company]);
    await admin.query("INSERT INTO exchange_rates(company_id,currency_code,currency_name_ar,exchange_rate_to_usd) VALUES($1,'EGP','EGP',50)",[company]);
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
    const call = async (method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string, payload?: object, status = 200, auth = token) => {
      const response = await app.inject({ method, url: path, payload, headers: { authorization: `Bearer ${auth}` } });
      assert.equal(response.statusCode, status, `${method} ${path}: ${response.body}`);
      const data=response.json().data;
      if(method==='POST'&&path==='/customer-orders/'&&status===201&&(payload as {status?:string})?.status==='pending_supply'){
        const confirmation=await app.inject({method:'PATCH',url:`/customer-orders/${data.id}/status`,payload:{status:'pending_supply'},headers:{authorization:`Bearer ${auth}`}});
        assert.equal(confirmation.statusCode,200,confirmation.body);
        const confirmed=await app.inject({method:'GET',url:`/customer-orders/${data.id}`,headers:{authorization:`Bearer ${auth}`}});return confirmed.json().data;
      }
      return data;
    };
    // A UI mounts these list/options requests before creating its first record.
    for(const path of ['/warping/','/warping/options','/sizing/','/sizing/options','/weaving/','/weaving/options','/quality/batches','/orders/','/cost/options','/reference/overview','/reference/departments','/reference/machines','/reference/downtime-reasons','/reference/quality-defects','/reference/specifications'])await call('GET',path);
    const readonly = signAuthToken({ sub: user, companyId: company, username: 'flow-user', role: 'user', permissions: [], isPlatformAdmin: false });
    await call('POST', '/orders/', {}, 403, readonly);
    const otherCompany = randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES ($1,'OTHER','Other')", [otherCompany]);
    const otherUser=randomUUID();await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES($1,$2,'other-flow','unused')",[otherUser,otherCompany]);
    const tenantToken=signAuthToken({sub:otherUser,companyId:otherCompany,username:'other-flow',role:'admin',permissions:[],isPlatformAdmin:false});
    const stockToken=signAuthToken({sub:user,companyId:company,username:'flow-user',role:'user',permissions:['inventory.manage'],isPlatformAdmin:false});
    const otherToken = signAuthToken({ sub: user, companyId: otherCompany, username: 'flow-user', role: 'admin', permissions: [], isPlatformAdmin: false });
    await call('GET', '/orders/', undefined, 403, otherToken);
    const customer=randomUUID();
    await admin.query("INSERT INTO customers(id,company_id,code,name) VALUES($1,$2,'ORDER-CUSTOMER','Order customer')",[customer,company]);
    const customerPayload={date:'2026-11-19',customerId:customer,currency:'USD',status:'pending_supply',items:[{id:randomUUID(),materialName:'Test fabric',dsamNumber:'D1',colorCode:'C1',length:100,metersPerRoll:100,rollCount:1,price:12,unitType:'meter'}]};
    const customerOrder=await call('POST','/customer-orders/',customerPayload,201);
    const lineId=customerOrder.items[0].id, invoice=randomUUID();
    await admin.query("INSERT INTO sales_invoices(id,company_id,invoice_no,customer_id,customer_order_id,document_status) VALUES($1,$2,'PARTIAL-ORDER',$3,$4,'CONFIRMED')",[invoice,company,customer,customerOrder.id]);
    await admin.query('INSERT INTO sales_invoice_lines(company_id,invoice_id,line_no,customer_order_line_id,quantity,unit) VALUES($1,$2,1,$3,40,\'meter\')',[company,invoice,lineId]);
    const saved=await call('PUT',`/customer-orders/${customerOrder.id}`,{...customerPayload,expectedUpdatedAt:customerOrder.updatedAt,notes:'Keep identity'});
    assert.equal(saved.items[0].id,lineId);
    assert.equal(saved.items[0].fulfilledMeters,40);
    assert.equal(saved.items[0].remainingMeters,60);
    assert.equal((await admin.query('SELECT customer_order_line_id FROM sales_invoice_lines WHERE invoice_id=$1',[invoice])).rows[0].customer_order_line_id,lineId);
    await call('PUT',`/customer-orders/${customerOrder.id}`,{...customerPayload,expectedUpdatedAt:customerOrder.updatedAt},409);
    await call('PUT',`/customer-orders/${customerOrder.id}`,{...customerPayload,items:[{...customerPayload.items[0],id:randomUUID()}]},409);
    await call('PUT',`/customer-orders/${customerOrder.id}`,{...customerPayload,items:[{...customerPayload.items[0],length:30,metersPerRoll:30}]},409);
    const secondOrder=await call('POST','/customer-orders/',{...customerPayload,items:[{...customerPayload.items[0],id:randomUUID()}]},201);
    await call('PUT',`/customer-orders/${secondOrder.id}`,{...customerPayload,items:[{...customerPayload.items[0],id:lineId}]},400);
    const audit=await admin.query("SELECT details FROM audit_logs WHERE company_id=$1 AND entity_id=$2 AND action='UPDATE'",[company,customerOrder.id]);
    assert.equal(audit.rows.length,1);
    const candidate=randomUUID();
    await admin.query("INSERT INTO sales_invoices(id,company_id,invoice_no,customer_id,customer_order_id) VALUES($1,$2,'REMAINING-ORDER',$3,$4)",[candidate,company,customer,customerOrder.id]);
    await admin.query("INSERT INTO sales_invoice_lines(company_id,invoice_id,line_no,customer_order_line_id,quantity,unit) VALUES($1,$2,1,$3,60,'meter')",[company,candidate,lineId]);
    const guarded=await getPool().connect();
    try {
      await guarded.query('BEGIN');
      await assertInvoiceOrderRemaining(guarded,company,candidate);
      await guarded.query('UPDATE sales_invoice_lines SET quantity=61 WHERE invoice_id=$1',[candidate]);
      await assert.rejects(assertInvoiceOrderRemaining(guarded,company,candidate),/تتجاوز المتبقي/);
      await guarded.query('UPDATE sales_invoice_lines SET customer_order_line_id=$2,quantity=1 WHERE invoice_id=$1',[candidate,secondOrder.items[0].id]);
      await assert.rejects(assertInvoiceOrderRemaining(guarded,company,candidate),/لا يتبع أوردر/);
      await guarded.query('ROLLBACK');
    } finally {guarded.release();}
    console.log('Customer order identity, partial fulfillment, protected edits, audit, stale update and invoice quantity guards passed');
    const finishedWarehouse=randomUUID(),readyRoll=randomUUID(),rawRoll=randomUUID();
    await admin.query("INSERT INTO warehouses(id,company_id,code,name,fabric_stage) VALUES($1,$2,'FINISHED','Finished','FINISHED')",[finishedWarehouse,company]);
    await admin.query("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,warehouse_id,length_m) VALUES($1,$3,'READY-400',$4,$5,400),($2,$3,'RAW-300',$4,$6,300)",[readyRoll,rawRoll,company,item,finishedWarehouse,warehouse]);
    const reservePayload={...customerPayload,items:[{...customerPayload.items[0],id:randomUUID(),dsamNumber:'TEST-FABRIC',colorCode:'',length:1000,metersPerRoll:1000}]};
    const reserveOrder=await call('POST','/customer-orders/',reservePayload,201);
    const rivalOrder=await call('POST','/customer-orders/',{...reservePayload,items:[{...reservePayload.items[0],id:randomUUID()}]},201);
    const stock=await call('GET',`/customer-orders/${reserveOrder.id}/workflow`);
    assert.equal(stock.lines[0].availableMeters,400);assert.equal(stock.lines[0].rawMeters,300);assert.equal(stock.lines[0].shortageMeters,600);
    await call('POST',`/customer-orders/${reserveOrder.id}/lines/${reserveOrder.items[0].id}/reserve`,{rollIds:[rawRoll]},409);
    await call('POST',`/customer-orders/${reserveOrder.id}/lines/${reserveOrder.items[0].id}/reserve`,{},403,readonly);
    const held=await call('POST',`/customer-orders/${reserveOrder.id}/lines/${reserveOrder.items[0].id}/reserve`,{});
    assert.equal(held.lines[0].reservedMeters,400);assert.equal(held.lines[0].availableMeters,0);assert.equal(held.lines[0].shortageMeters,600);
    await call('POST',`/customer-orders/${reserveOrder.id}/lines/${reserveOrder.items[0].id}/reserve`,{rollIds:[readyRoll]});
    assert.equal(Number((await admin.query("SELECT COUNT(*) FROM inventory_movements WHERE roll_id=$1 AND movement_type='RESERVE'",[readyRoll])).rows[0].count),1);
    await call('POST',`/customer-orders/${rivalOrder.id}/lines/${rivalOrder.items[0].id}/reserve`,{rollIds:[readyRoll]},409);
    const {assertReservationForInvoice}=await import('./rollReservationService.js');
    const reservationDb=await getPool().connect();
    try{await assert.rejects(assertReservationForInvoice(reservationDb,company,readyRoll,candidate,rivalOrder.items[0].id),/محجوز/);
      await assertReservationForInvoice(reservationDb,company,readyRoll,candidate,reserveOrder.items[0].id);
    }finally{reservationDb.release();}
    await call('POST',`/customer-orders/${reserveOrder.id}/lines/${reserveOrder.items[0].id}/release`,{});
    const races=await Promise.all([reserveOrder,rivalOrder].map(o=>app.inject({method:'POST',url:`/customer-orders/${o.id}/lines/${o.items[0].id}/reserve`,payload:{rollIds:[readyRoll]},headers:{authorization:`Bearer ${token}`}})));
    assert.deepEqual(races.map(r=>r.statusCode).sort(),[200,409]);
    for(const o of [reserveOrder,rivalOrder])await call('POST',`/customer-orders/${o.id}/lines/${o.items[0].id}/release`,{});
    if(process.env.CLOTEX_MANUFACTURING_BROWSER_TESTS==='1'||process.env.CLOTEX_MANUFACTURING_BROWSER_TESTS==='orders'){
      const {verifyCustomerOrderWorkflowUI}=await import('./customerOrderWorkflow.browser.test.js');
      await verifyCustomerOrderWorkflowUI(app,token,reserveOrder);
    }
    console.log('Order stock separates raw/finished, partial FIFO reservation, owner protection, idempotence and concurrent reservation passed');
    const yarnItem=randomUUID();await admin.query("INSERT INTO fabric_items(id,company_id,internal_code,name,unit) VALUES($1,$2,'YARN-PROFILE','Cotton yarn','kg')",[yarnItem,company]);
    await call('PUT',`/yarn/profiles/${yarnItem}`,{expectedVersion:0,properties:{fiber:'cotton',count:'30/1',countSystem:'Ne',blend:[{fiber:'cotton',percent:100}]}});
    await call('PUT',`/yarn/profiles/${yarnItem}`,{expectedVersion:0,properties:{count:'40/1'}},409);
    await call('PUT',`/yarn/profiles/${yarnItem}`,{expectedVersion:1,properties:{blend:[{fiber:'cotton',percent:70}]}},400);
    await call('PUT',`/yarn/profiles/${yarnItem}`,{expectedVersion:1,properties:{fiber:'cotton',count:'30/1',countSystem:'Ne',spinningType:'ring',blend:[{fiber:'cotton',percent:100}]}});
    assert.equal(Number((await admin.query('SELECT COUNT(*) FROM yarn_profile_history WHERE company_id=$1 AND item_id=$2',[company,yarnItem])).rows[0].count),2);
    if(['1','settings'].includes(process.env.CLOTEX_MANUFACTURING_BROWSER_TESTS??'')){
      const {verifyManufacturingSettingsUI}=await import('./manufacturingSettings.browser.test.js');
      await verifyManufacturingSettingsUI(app,token,yarnItem,user);
    }
    const receipt={itemId:yarnItem,warehouseId:warehouse,weightKg:100,receiptKey:randomUUID(),ownerType:'COMPANY',unitCost:2,currencyCode:'USD',receiptPackages:{count:4,weightPerPackageKg:25}};
    const receivedYarn=await call('POST','/yarn/',receipt,201);
    const yarnViewToken=signAuthToken({sub:user,companyId:company,username:'viewer',role:'user',permissions:['inventory.view'],isPlatformAdmin:false});
    assert.equal('unit_cost' in await call('GET',`/yarn/${receivedYarn.id}`,undefined,200,yarnViewToken),false);
    const yarnCostToken=signAuthToken({sub:user,companyId:company,username:'cost-viewer',role:'user',permissions:['inventory.view','inventory.yarn.cost.view'],isPlatformAdmin:false});
    assert.equal(Number((await call('GET',`/yarn/${receivedYarn.id}`,undefined,200,yarnCostToken)).unit_cost),2);
    await call('POST','/yarn/',receipt,409);
    await call('POST','/yarn/',{...receipt,receiptKey:randomUUID(),weightKg:95,grossWeightKg:100,tareWeightKg:4},400);
    const batchKey=randomUUID(),batchReceipt={batchKey,rows:[{...receipt,receiptKey:undefined,receiptPackages:null,weightKg:95,grossWeightKg:100,tareWeightKg:5},{...receipt,receiptKey:undefined,weightKg:100}]};
    const savedBatch=await call('POST','/yarn/receipts/batch',batchReceipt,201);assert.equal(savedBatch.count,2);
    assert.deepEqual((await call('POST','/yarn/receipts/batch',batchReceipt,201)).lotIds,savedBatch.lotIds);
    await call('POST','/yarn/receipts/batch',{...batchReceipt,rows:[batchReceipt.rows[1]]},409);
    const countBefore=Number((await admin.query('SELECT COUNT(*) FROM yarn_lots WHERE item_id=$1',[yarnItem])).rows[0].count);
    await call('POST','/yarn/receipts/batch',{batchKey:randomUUID(),rows:[{...batchReceipt.rows[0]},{...batchReceipt.rows[0],itemId:randomUUID()}]},400);
    assert.equal(Number((await admin.query('SELECT COUNT(*) FROM yarn_lots WHERE item_id=$1',[yarnItem])).rows[0].count),countBefore);
    await call('PUT',`/yarn/${receivedYarn.id}`,{weightKg:99},400);
    const dispatchedYarn=await call('POST','/yarn/external/dispatch',{requestKey:randomUUID(),lotId:receivedYarn.id,supplierId:supplier,weightKg:30,notes:'Send yarn for processing'},201);
    assert.equal(Number((await admin.query('SELECT weight_kg FROM yarn_lots WHERE id=$1',[receivedYarn.id])).rows[0].weight_kg),70);
    const yarnReturn=await call('POST',`/yarn/external/${dispatchedYarn.id}/return`,{requestKey:randomUUID(),returnedKg:20,shortageKg:2,approvedShortage:true,warehouseId:finishedWarehouse,notes:'Partial return and approved shrinkage'});
    assert.equal(yarnReturn.remainingKg,8);
    assert.equal((await admin.query('SELECT parent_yarn_lot_id FROM yarn_lots WHERE id=$1',[yarnReturn.resultLotId])).rows[0].parent_yarn_lot_id,receivedYarn.id);
    await call('POST',`/yarn/external/${dispatchedYarn.id}/return`,{requestKey:randomUUID(),returnedKg:9,warehouseId:warehouse,notes:'Too much return'},409);
    const customerYarn=await call('POST','/yarn/',{...receipt,receiptKey:randomUUID(),ownerType:'CUSTOMER',ownerCustomerId:customer},201);
    assert.equal(customerYarn.status,'RESERVED');
    const csv='itemCode,warehouseCode,weightKg,ownerType,lotNo\nYARN-PROFILE,RAW,5,COMPANY,OPEN-1';
    const openingPreview=await call('POST','/yarn/opening/preview',{fileName:'opening.csv',csv});assert.equal(openingPreview.canCommit,true);
    await call('POST','/yarn/opening/commit',{fileName:'opening.csv',csv,expectedFileSha256:openingPreview.fileSha256},201);
    await call('POST','/yarn/opening/commit',{fileName:'opening.csv',csv,expectedFileSha256:openingPreview.fileSha256},409);
    console.log('Real yarn receipt/profile/ownership, external partial return, shortage, genealogy and opening-import deduplication passed');
    const {scanOrderNotifications,dueNotificationKind}=await import('./customerOrderNotificationService.js');
    await admin.query("UPDATE users SET role='admin' WHERE id=$1",[user]);
    await call('PUT','/customer-orders/notifications/routing',{phase:'partial_ready',userId:user});
    const routing=await call('GET','/customer-orders/notifications/routing');
    assert.equal(routing.phases.find((p:{phase:string})=>p.phase==='partial_ready').userId,user);
    await call('PUT','/customer-orders/notifications/routing',{phase:'partial_ready',userId:user},403,readonly);
    await call('PUT','/customer-orders/notifications/routing',{phase:'ready_pickup',userId:randomUUID()},400);
    await call('PUT','/customer-orders/notifications/routing',{phase:'partial_ready',userId:null});
    await admin.query("UPDATE customer_orders SET follow_up_user_id=$2,expected_date='2026-11-22' WHERE id=$1",[reserveOrder.id,user]);
    assert.equal(dueNotificationKind('2026-11-22',new Date('2026-11-19T12:00:00Z'),'UTC'),'due_soon');
    assert.equal(dueNotificationKind('2026-11-19',new Date('2026-11-19T12:00:00Z'),'UTC'),'due_today');
    const notificationDb=await getPool().connect();try{await notificationDb.query('BEGIN');for(let attempt=0;attempt<2;attempt++)await scanOrderNotifications(notificationDb,company,reserveOrder.id,new Date('2026-11-19T12:00:00Z'),'UTC');await notificationDb.query('COMMIT');}finally{notificationDb.release();}
    const notifications=await call('GET','/customer-orders/notifications');
    const dueNotice=notifications.items.filter((n:{kind:string})=>n.kind==='due_soon');assert.equal(dueNotice.length,1);
    await call('POST',`/customer-orders/notifications/${dueNotice[0].id}/read`,{read:true});
    const updatedInbox=await call('GET','/customer-orders/notifications');assert.ok(updatedInbox.items.find((n:{id:string})=>n.id===dueNotice[0].id).readAt);
    console.log('Persistent recipient-scoped notification deduplication, due thresholds and read state passed');
    await call('PATCH',`/customer-orders/${reserveOrder.id}/status`,{status:'completed'},409);
    await call('DELETE',`/customer-orders/${reserveOrder.id}`,undefined,409);
    const revisionInput={requestId:randomUUID(),sourceVersionId:version,technicalFields:{reedWidth:180},warpPattern:null,weftPattern:null,notes:'Revised technical reference'};
    const revised=await call('POST','/reference/specifications/revise',revisionInput,201);
    assert.equal(revised.versionNo,2);
    assert.equal((await call('POST','/reference/specifications/revise',revisionInput)).versionId,revised.versionId);
    await call('POST','/reference/specifications/revise',{...revisionInput,technicalFields:{reedWidth:190}},409);
    assert.deepEqual((await admin.query('SELECT parsed_data FROM manufacturing_specification_versions WHERE id=$1',[version])).rows[0].parsed_data,{});
    const revisedRow=(await admin.query('SELECT parsed_data,status,source_file_sha256 FROM manufacturing_specification_versions WHERE id=$1',[revised.versionId])).rows[0];
    assert.equal(revisedRow.status,'DRAFT');assert.equal(revisedRow.parsed_data.technicalFields.reedWidth,180);assert.equal(revisedRow.source_file_sha256,'0'.repeat(64));
    await call('POST','/reference/specifications/revise',{...revisionInput,requestId:randomUUID()},403,readonly);
    const copy=await call('POST','/reference/specifications/revise',{...revisionInput,requestId:randomUUID(),targetCode:'SPEC-COPY',targetName:'Copied specification'},201);
    assert.notEqual(copy.specificationId,spec);assert.equal(copy.versionNo,1);
    console.log('Specification copies and immutable manual revisions, source preservation, retry and permission guards passed');
    // Exercise both optional-stage paths through the real handlers and transactions.
    for (const withSizing of [false, true]) {
      await admin.query('UPDATE yarn_lots SET unit_cost=10 WHERE id=$1',[yarn]);
      if(!withSizing)await admin.query('UPDATE yarn_lots SET unit_cost=NULL WHERE id=$1',[weft]);
      const order = await call('POST', '/orders/', { specificationVersionId: version, targetLengthM: 100 }, 201);
      await call('GET',`/cost/${order.id}`,undefined,404,tenantToken);
      assert.equal('totalUsd' in await call('GET',`/cost/${order.id}`,undefined,200,stockToken),false);
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
      if(process.env.CLOTEX_MANUFACTURING_BROWSER_TESTS==='1'){
        const {verifyManufacturingScreens}=await import('./manufacturingScreens.browser.test.js');
        await verifyManufacturingScreens(app,token,withSizing?'SIZING':'WEAVING',warp.id);
      }else await call('POST', `/warping/${warp.id}/complete`, { version: 3, actualLengthM: 100, qualityStatus: 'ACCEPTED', nextStage: withSizing ? 'SIZING' : 'WEAVING' });
      const beam = (await admin.query('SELECT id FROM manufacturing_warp_beams WHERE warping_order_id=$1', [warp.id])).rows[0];
      let beamId = beam.id;
      if (withSizing) {
        const sizing = await call('POST', '/sizing/', { inputBeamId: beam.id, sizingMachineId: sizingMachine }, 201);
        await call('POST', '/sizing/', { inputBeamId: beam.id, sizingMachineId: sizingMachine }, 409);
        await call('POST', `/sizing/${sizing.id}/start`, {});
        await call('POST', `/sizing/${sizing.id}/complete`, { actualLengthM: 100, qualityStatus: 'ACCEPTED' },400);
        const chemicalIssue=await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'SIZING',stageId:sizing.id,lotId:chemical,kind:'ISSUE',weightKg:5,wasteKg:0.5,notes:'Sizing recipe materials'});
        await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'SIZING',stageId:sizing.id,lotId:chemical,kind:'RETURN',sourceEntryId:chemicalIssue.id,weightKg:1,notes:'Unused chemical return'});
        await call('POST', `/sizing/${sizing.id}/complete`, { actualLengthM: 100, qualityStatus: 'CONDITIONAL',qualityNotes:'Needs reprocessing' });
        beamId = (await admin.query('SELECT id FROM manufacturing_sized_beams WHERE sizing_order_id=$1', [sizing.id])).rows[0].id;
        await call('POST','/weaving/',{beamType:'SIZED',beamId,loomId:loom,openingCounter:0},409);
        const waiting=await call('GET','/reference/beam-quality?kind=SIZED');
        const pendingBeam=waiting.find((b:{id:string})=>b.id===beamId);assert.ok(pendingBeam);
        await call('POST',`/reference/beam-quality/SIZED/${beamId}`,{version:pendingBeam.version,result:'ACCEPTED',notes:'Reprocessed and inspected'});
        await call('POST',`/reference/beam-quality/SIZED/${beamId}`,{version:pendingBeam.version,result:'ACCEPTED',notes:'Duplicate review'},409);
      }
      const run = await call('POST', '/weaving/', { beamType: withSizing ? 'SIZED' : 'WARP', beamId, loomId: loom, openingCounter: 0 }, 201);
      await call('POST', '/weaving/', { beamType: withSizing ? 'SIZED' : 'WARP', beamId, loomId: loom }, 409);
      await call('POST', `/weaving/${run.id}/start`, {});
      const materialBody={requestId:randomUUID(),stage:'WEAVING',stageId:run.id,lotId:weft,kind:'ISSUE',weightKg:10,wasteKg:0,consumptionBasis:'RECORDED',notes:'Weft custody'};
      const concurrentMaterials=await Promise.all([call('POST',`/cost/${order.id}/materials`,materialBody),call('POST',`/cost/${order.id}/materials`,materialBody)]);
      assert.equal(concurrentMaterials[0].id,concurrentMaterials[1].id);
      await call('POST',`/cost/${order.id}/materials`,{...materialBody,weightKg:11},409);
      await call('POST',`/cost/${order.id}/materials`,{...materialBody,requestId:randomUUID(),weightKg:1000},400);
      await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'WEAVING',stageId:run.id,lotId:weft,kind:'RETURN',sourceEntryId:concurrentMaterials[0].id,weightKg:2,notes:'Unused weft return'});
      const actualConsumption={requestId:randomUUID(),sourceEntryId:concurrentMaterials[0].id,consumedKg:7,wasteKg:1,notes:'Approved actual consumption and waste'};
      await call('POST',`/cost/${order.id}/consumption`,actualConsumption);
      await call('POST',`/cost/${order.id}/consumption`,actualConsumption);
      await call('POST',`/cost/${order.id}/consumption`,{...actualConsumption,requestId:randomUUID(),consumedKg:1,wasteKg:0},400);
      const materialBalance=(await call('GET',`/cost/${order.id}`)).materialBalances.find((b:{id:string})=>b.id===concurrentMaterials[0].id);
      assert.equal(materialBalance.custodyKg,0);assert.equal(materialBalance.consumedKg,7);assert.equal(materialBalance.wasteKg,1);
      if(!withSizing){
        const unrated=await call('GET',`/cost/${order.id}`);assert.equal(unrated.unrated,1);
        await call('POST',`/cost/${order.id}/price-material`,{source:'MATERIAL',entryId:concurrentMaterials[0].id,unitCost:4,currencyCode:'USD',notes:'Approved supplier price'});
        await admin.query('UPDATE yarn_lots SET unit_cost=4 WHERE id=$1',[weft]);
      }
      await call('POST',`/cost/${order.id}/materials`,{requestId:randomUUID(),stage:'WEAVING',stageId:run.id,lotId:weft,kind:'RETURN',sourceEntryId:concurrentMaterials[0].id,weightKg:8,notes:'Excess return'},400);
      await call('POST',`/cost/${order.id}/charges`,{requestId:randomUUID(),kind:'LABOR',amount:20,sourceReference:order.id+'-payroll',currencyCode:'USD',notes:'Labor allocation, not payroll payment'});
      await admin.query("UPDATE exchange_rates SET exchange_rate_to_usd=50 WHERE company_id=$1 AND currency_code='EGP'",[company]);
      await call('POST',`/cost/${order.id}/charges`,{requestId:randomUUID(),kind:'ENERGY',amount:500,currencyCode:'EGP',notes:'Energy allocation'});
      await admin.query("UPDATE exchange_rates SET exchange_rate_to_usd=100 WHERE company_id=$1 AND currency_code='EGP'",[company]);
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
      if(!withSizing){
        const mixed=await call('POST','/external/processing',{supplierId:supplier,fabricStage:'RAW',preparationTypeId:prep,sourceWarehouseId:warehouse,rollIds:[costRoll,rawRoll],traceabilityOnly:true,lineReferences:[{rollId:costRoll,customerOrderId:reserveOrder.id,customerOrderLineId:reserveOrder.items[0].id},{rollId:rawRoll,customerOrderId:rivalOrder.id,customerOrderLineId:rivalOrder.items[0].id}]},201);
        const mixedOverview=await call('GET',`/external/${mixed.id}/lifecycle`);assert.equal(mixedOverview.costShares.length,2);
        await call('POST',`/external/${mixed.id}/lifecycle/service-pricing`,{lines:[{serviceId:mixedOverview.services[0].id,unitPrice:10,currencyCode:'USD',basis:'FIXED',approvedQuantity:1}]});
        const shares=mixedOverview.costShares as Array<{id:string;work_order_id:string|null}>;
        const distribution={reason:'Accountant approved production and general-stock shares',lines:shares.map(s=>({shareId:s.id,amountUsd:s.work_order_id?4:6}))};
        await call('POST',`/external/${mixed.id}/lifecycle/cost-allocation`,{...distribution,lines:shares.map(s=>({shareId:s.id,amountUsd:1}))},400);
        await call('POST',`/external/${mixed.id}/lifecycle/cost-allocation`,distribution,403,readonly);
        await call('POST',`/external/${mixed.id}/lifecycle/cost-allocation`,distribution);
        const mixedReport=await call('GET',`/cost/${order.id}`);assert.equal(mixedReport.breakdown.externalUsd,4);
        await call('POST',`/external/${mixed.id}/void`,{reason:'Test allocation complete; cancel unused dispatch'});
        assert.equal((await call('GET',`/cost/${order.id}`)).breakdown.externalUsd,0);
      }
      if(withSizing){
        const original=(await admin.query('SELECT result_fabric_roll_id id FROM manufacturing_raw_roll_outputs WHERE production_batch_id=$1 AND length_m=40',[batch.id])).rows[0].id;
        const job=await call('POST','/external/processing',{supplierId:supplier,fabricStage:'RAW',preparationTypeId:prep,sourceWarehouseId:warehouse,rollIds:[original]},201);
        assert.equal((await admin.query('SELECT work_order_id FROM manufacturing_external_links WHERE company_id=$1 AND job_id=$2',[company,job.id])).rows[0].work_order_id,order.id);
        await call('POST',`/cost/${order.id}/external-link`,{jobId:job.id});
        await call('POST',`/cost/${order.id}/finalize`,{},400);
        const overview=await call('GET',`/external/${job.id}/lifecycle`);
        const returnBody={requestId:randomUUID(),dyePaperNo:'DYE-1',destinationWarehouseId:warehouse,lines:[{sourceLineId:overview.lines[0].id,lengthM:35,defective:true,defectReason:'DYE_HOUSE',responsibleParty:'Dye house',notes:'Check shade'}]};
        if(['1','external'].includes(process.env.CLOTEX_MANUFACTURING_BROWSER_TESTS??'')){
          const {verifyExternalManufacturingUI}=await import('./manufacturingScreens.browser.test.js');
          await verifyExternalManufacturingUI(app,token,job.id,warehouse,overview.lines[0].id);
        }else await call('POST',`/external/${job.id}/lifecycle/returns`,returnBody);
        const returns=await call('GET',`/external/${job.id}/lifecycle`);
        const returned=(await admin.query('SELECT id FROM external_job_return_lines WHERE job_id=$1',[job.id])).rows[0];
        await call('POST',`/external/${job.id}/lifecycle/resolve-defect`,{returnLineId:returned.id,decision:'ACCEPT',notes:'Quality approved shade'});
        await call('POST',`/external/${job.id}/lifecycle/settlements`,{sourceLineId:overview.lines[0].id,amountM:5,reason:'Approved process shrinkage'});
        await call('POST',`/external/${job.id}/lifecycle/service-pricing`,{lines:[{serviceId:returns.services[0].id,unitPrice:0.5,currencyCode:'USD',basis:'METER',approvedQuantity:35}]});
        await call('POST',`/external/${job.id}/lifecycle/close`,{});
        // Physical receipt closure must not prevent the accountant from pricing
        // later, but finalized production costs remain immutable.
        await call('POST',`/external/${job.id}/lifecycle/service-pricing`,{lines:[{serviceId:returns.services[0].id,unitPrice:0.5,currencyCode:'USD',basis:'METER',approvedQuantity:35}]});
      }
      const report=await call('GET',`/cost/${order.id}`);
      assert.equal(report.unrated,0);
      assert.equal(report.totalUsd,withSizing?267.5:242);
      assert.equal(report.acceptedLengthM,withSizing?85:90);
      await call('POST',`/cost/${order.id}/finalize`,{});
      await call('POST',`/cost/${order.id}/finalize`,{});
      if(withSizing){const linked=(await admin.query('SELECT job_id FROM manufacturing_external_links WHERE company_id=$1 AND work_order_id=$2',[company,order.id])).rows[0];const ext=await call('GET',`/external/${linked.job_id}/lifecycle`);await call('POST',`/external/${linked.job_id}/lifecycle/service-pricing`,{lines:[{serviceId:ext.services[0].id,unitPrice:1,currencyCode:'USD',basis:'METER',approvedQuantity:35}]},400);}
      const allocated=await admin.query('SELECT SUM(allocated_usd) amount FROM manufacturing_cost_allocations WHERE company_id=$1 AND work_order_id=$2',[company,order.id]);
      assert.equal(Number(allocated.rows[0].amount),report.totalUsd);
      if(!withSizing){
        const wh2=randomUUID(),manualRoll=randomUUID();
        await admin.query("INSERT INTO warehouses(id,company_id,code,name) VALUES($1,$2,'SECOND','Second warehouse')",[wh2,company]);
        await admin.query("INSERT INTO fabric_rolls(id,company_id,roll_no,barcode,item_id,warehouse_id,length_m,status) VALUES($1,$2,'PICK-2','0999002',$3,$4,1.123,'AVAILABLE')",[manualRoll,company,item,wh2]);
        const code=(await admin.query('SELECT barcode FROM fabric_rolls WHERE id=$1',[costRoll])).rows[0].barcode;
        const grouping=await call('POST','/zones/group-rolls',{barcodes:[code,'0999002',code]});
        assert.equal(grouping.length,2);
        assert.equal(new Set(grouping.map((g:{warehouseId:string})=>g.warehouseId)).size,2);
        assert.equal(grouping.flatMap((g:{rolls:unknown[]})=>g.rolls).length,2);
        await call('POST','/zones/group-rolls',{barcodes:[code]},400,tenantToken);
        await call('POST','/zones/group-rolls',{barcodes:['missing-barcode']},400);
      }
      await call('POST',`/cost/${order.id}/charges`,{requestId:randomUUID(),kind:'ENERGY',amount:1,currencyCode:'USD',notes:'Forbidden after cost closure'},400);
      if(!withSizing)await call('POST','/external/processing',{supplierId:supplier,fabricStage:'RAW',preparationTypeId:prep,sourceWarehouseId:warehouse,rollIds:[costRoll],traceabilityOnly:true},400);
    }
    assert.equal(Number((await getPool().query('SELECT weight_kg FROM yarn_lots WHERE id=$1', [yarn])).rows[0].weight_kg), 64);
    assert.equal(Number((await getPool().query('SELECT weight_kg FROM yarn_lots WHERE id=$1', [weft])).rows[0].weight_kg),84);
    assert.equal(Number((await getPool().query('SELECT weight_kg FROM yarn_lots WHERE id=$1', [chemical])).rows[0].weight_kg),96);
    const operations=await call('GET','/reference/operations-report');
    assert.equal(operations.summary.produced_m,200);assert.equal(operations.summary.clean_m,180);assert.equal(operations.summary.rejected_m,20);assert.equal(operations.summary.received_m,180);assert.equal(operations.summary.planned_m,200);
    await call('GET','/reference/operations-report',undefined,403,readonly);
    const emptyOperations=await call('GET','/reference/operations-report?dateFrom=2026-11-20&dateTo=2026-11-21');assert.equal(emptyOperations.summary.produced_m,0);
    console.log('Operational report reconciles shift production, quality, warehouse receipts and distinct planned runs without duplication');
    console.log('Reconciled: warp 36kg net, weft 16kg net, sizing 4kg net; external quality/shrinkage; final output 175m; costs USD 242 + 267.5 allocated exactly once');
  } finally {
    await app.close();
    await resetPool();
    // The schema was generated here on the explicitly guarded local test instance.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
