import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('unified quality HTTP: authoritative receipt, evidence, tenant isolation, decisions and per-line order preservation',{
 skip:process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS!=='1',
},async()=>{
 const url=new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL??'');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55483');assert.equal(url.pathname,'/clotex_manufacturing_test');assert.equal(url.search,'');
 const db=new pg.Client({connectionString:url.href});await db.connect();
 const schema='quality_completion_'+uuid().replaceAll('-','');
 await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema},public`);
 process.env.CLOTEX_EMBEDDED_SERVER='1';process.env.NODE_ENV='test';process.env.JWT_SECRET=uuid()+uuid();
 url.searchParams.set('options',`-c search_path=${schema},public -c client_encoding=UTF8`);process.env.DATABASE_URL=url.href;
 const {default:Fastify}=await import('fastify');const app=Fastify();
 const {getPool,resetPool}=await import('../db/pool.js');
 try{
  const dir=new URL('../db/migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.query(await readFile(new URL(file,dir),'utf8'));
  const {manufacturingQualityRoutes}=await import('../routes/manufacturingQualityRoutes.js');
  const {externalManufacturingRoutes}=await import('../routes/externalManufacturingRoutes.js');
  const {signAuthToken}=await import('../middleware/auth.js');
  await app.register(manufacturingQualityRoutes,{prefix:'/quality'});await app.register(externalManufacturingRoutes,{prefix:'/external'});
  const company=uuid(),foreign=uuid(),user=uuid(),other=uuid(),warehouse=uuid(),item=uuid(),supplier=uuid(),job=uuid(),customer=uuid();
  await db.query("INSERT INTO companies(id,code,name) VALUES($1,'QUALITY','Quality'),($2,'FOREIGN','Foreign')",[company,foreign]);
  await db.query("INSERT INTO users(id,company_id,username,password_hash,full_name) VALUES($1,$2,'quality-user','unused','Inspector'),($3,$4,'other-user','unused','Other')",[user,company,other,foreign]);
  await db.query("INSERT INTO warehouses(id,company_id,code,name,fabric_stage) VALUES($1,$2,'WH','Warehouse','FINISHED')",[warehouse,company]);
  await db.query("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES($1,$2,'ITEM','Fabric')",[item,company]);
  await db.query("INSERT INTO suppliers(id,company_id,code,name,is_processing_party) VALUES($1,$2,'SUP','Supplier',true)",[supplier,company]);
  await db.query("INSERT INTO customers(id,company_id,code,name) VALUES($1,$2,'CUS','Customer')",[customer,company]);
  const prep=uuid();await db.query("INSERT INTO external_job_preparation_types(id,company_id,name) VALUES($1,$2,'Dye')",[prep,company]);
  await db.query("INSERT INTO external_jobs(id,company_id,job_no,supplier_id,job_kind,document_status,fabric_stage,preparation_type_id,source_warehouse_id,supplier_order_no) VALUES($1,$2,'JOB-Q',$3,'PROCESSING','CONFIRMED','RAW',$4,$5,1)",[job,company,supplier,prep,warehouse]);
  const lines:string[]=[],orders:string[]=[],orderLines:string[]=[];
  for(let i=0;i<4;i++){
   const roll=uuid(),line=uuid(),order=uuid(),ol=uuid();lines.push(line);orders.push(order);orderLines.push(ol);
   if(i<2){await db.query("INSERT INTO customer_orders(id,company_id,order_no,customer_id,status) VALUES($1,$2,$3,$4,'pending_supply')",[order,company,`ORDER-${i}`,customer]);await db.query('INSERT INTO customer_order_lines(id,company_id,order_id,line_no) VALUES($1,$2,$3,1)',[ol,company,order]);}
   await db.query("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,warehouse_id,length_m,status) VALUES($1,$2,$3,$4,$5,10,'AT_EXTERNAL_JOB')",[roll,company,`SRC-${i}`,item,warehouse]);
   await db.query('INSERT INTO external_job_lines(id,company_id,job_id,roll_id,sent_barcode,sent_length_m,customer_order_id,customer_order_line_id) VALUES($1,$2,$3,$4,$5,10,$6,$7)',[line,company,job,roll,`SRC-${i}`,i<2?order:null,i<2?ol:null]);
  }
  const manager=uuid();await db.query("INSERT INTO users(id,company_id,username,password_hash,full_name) VALUES($1,$2,'quality-manager','unused','Manager')",[manager,company]);
  const token=(role:string,permissions:string[]=[],c=company,u=user)=>signAuthToken({sub:u,companyId:c,username:'quality-user',role,permissions,isPlatformAdmin:false});
  const managerToken=token('admin',[],company,manager);
  const admin=token('admin'),viewer=token('user'),inspector=token('user',['manufacturing.raw_inspection.manage']),stock=token('user',['inventory.manage']),outsider=token('admin',[],foreign,other);
  const call=async(method:'GET'|'POST',path:string,body?:unknown,expected=200,auth=admin)=>{const r=await app.inject({method,url:path,payload:body,headers:{authorization:`Bearer ${auth}`}});assert.equal(r.statusCode,expected,`${path}: ${r.body}`);return r.json().data;};
  await call('GET','/quality/inbox',undefined,403,viewer);
  // Independent raw fixture avoids unrelated costing/sizing workflows.
  const spec=uuid(),version=uuid(),work=uuid(),warp=uuid(),beam=uuid(),loom=uuid(),run=uuid(),shift=uuid(),batch=uuid(),rawWarehouse=uuid(),rawDefect=uuid();
  await db.query("INSERT INTO warehouses(id,company_id,code,name,fabric_stage) VALUES($1,$2,'RAW','Raw','RAW')",[rawWarehouse,company]);
  await db.query("INSERT INTO manufacturing_specifications(id,company_id,code,name) VALUES($1,$2,'Q-S','Spec')",[spec,company]);
  await db.query("INSERT INTO manufacturing_specification_versions(id,company_id,specification_id,version_no,status,source_file_name,source_file_content,source_file_size,source_file_sha256,parsed_data,approved_at) VALUES($1,$2,$3,1,'APPROVED','q.xlsx',decode('00','hex'),1,repeat('0',64),'{}',now())",[version,company,spec]);
  await db.query("INSERT INTO manufacturing_work_orders(id,company_id,work_order_no,specification_id,specification_version_id,target_length_m) VALUES($1,$2,'Q-W',$3,$4,100)",[work,company,spec,version]);
  for(let i=0;i<2;i++)await db.query('INSERT INTO manufacturing_work_order_allocations(company_id,work_order_id,customer_order_id,customer_order_line_id,allocated_length_m) VALUES($1,$2,$3,$4,50)',[company,work,orders[i],orderLines[i]]);
  await db.query("INSERT INTO manufacturing_warping_orders(id,company_id,warping_order_no,work_order_id,planned_length_m,specification_snapshot) VALUES($1,$2,'Q-WARP',$3,100,'{}')",[warp,company,work]);
  await db.query("INSERT INTO manufacturing_warp_beams(id,company_id,warping_order_id,beam_no,barcode,length_m,status,quality_status) VALUES($1,$2,$3,'Q-BEAM','Q-BEAM',100,'READY_FOR_WEAVING','ACCEPTED')",[beam,company,warp]);
  await db.query("INSERT INTO manufacturing_machines(id,company_id,code,name,machine_type) VALUES($1,$2,'Q-LOOM','Loom','LOOM')",[loom,company]);
  await db.query("INSERT INTO manufacturing_weaving_runs(id,company_id,run_no,work_order_id,warp_beam_id,loom_id,planned_length_m) VALUES($1,$2,'Q-RUN',$3,$4,$5,100)",[run,company,work,beam,loom]);
  await db.query("INSERT INTO manufacturing_weaving_shift_logs(id,company_id,weaving_run_id,production_date,counter_start,counter_end,produced_length_m) VALUES($1,$2,$3,current_date,0,100,100)",[shift,company,run]);
  await db.query("INSERT INTO manufacturing_production_batches(id,company_id,batch_no,weaving_run_id,shift_log_id,produced_length_m,pending_length_m) VALUES($1,$2,'Q-BATCH',$3,$4,100,100)",[batch,company,run,shift]);
  await db.query("INSERT INTO manufacturing_quality_defect_catalog(id,company_id,code,name,inspection_type) VALUES($1,$2,'RAW-D','Raw defect','RAW_FABRIC')",[rawDefect,company]);
  const rawBody={cleanLengthM:80,reworkLengthM:10,rejectedLengthM:10,pendingLengthM:0,checklist:[{key:'VISUAL',result:'FAIL',notes:'Recorded'}],defects:[{defectId:rawDefect,positionM:10,quantity:2,severity:'MAJOR',notes:'Raw evidence'}]};
  const rawReceipt={itemId:item,warehouseId:rawWarehouse,rolls:[{rollNo:'Q-RAW-1',lengthM:50}]};
  await call('POST',`/quality/batches/${batch}/rolls`,rawReceipt,409,stock);
  const put=async(body:unknown,expected=200,auth=inspector)=>{const r=await app.inject({method:'PUT',url:`/quality/batches/${batch}/inspection`,payload:body,headers:{authorization:`Bearer ${auth}`}});assert.equal(r.statusCode,expected,r.body);};
  await put(rawBody,403,stock);await put({...rawBody,cleanLengthM:90},400);await put(rawBody);
  const rawReport=await call('GET',`/quality/batches/${batch}/report`);assert.equal(rawReport.batch.quality_checklist[0].result,'FAIL');assert.equal(rawReport.defects[0].defect_id,rawDefect);assert.equal(rawReport.defects[0].notes,'Raw evidence');assert.equal(rawReport.batch.inspector_name,'Inspector');
  const rawInbox=(await call('GET','/quality/inbox')).find((r:{id:string})=>r.id===batch);assert.equal(rawInbox.order_refs.length,2);
  await call('POST',`/quality/batches/${batch}/approve`,{},403,inspector);
  await call('POST',`/quality/batches/${batch}/approve`,{},403,admin);
  await call('POST',`/quality/batches/${batch}/approve`,{},403,stock);
  await call('POST',`/quality/batches/${batch}/approve`,{},200,managerToken);
  await put(rawBody,409);await call('POST',`/quality/batches/${batch}/rolls`,rawReceipt,201,stock);
  await call('POST',`/quality/batches/${batch}/rolls`,rawReceipt,400,stock);
  await call('POST',`/quality/batches/${batch}/rolls`,{...rawReceipt,rolls:[{rollNo:'Q-RAW-2',lengthM:31}]},400,stock);
  const finalReceipt={...rawReceipt,rolls:[{rollNo:'Q-RAW-2',lengthM:30}]};
  const races=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`/quality/batches/${batch}/rolls`,payload:finalReceipt,headers:{authorization:`Bearer ${stock}`}})));
  assert.deepEqual(races.map(r=>r.statusCode).sort(),[201,400]);
  const closed=await call('GET',`/quality/batches/${batch}/report`);assert.equal(closed.batch.status,'CLOSED');assert.equal(closed.batch.approver_name,'Manager');assert.equal(closed.rolls.length,2);
  const rawTotals=(await db.query("SELECT count(*)::int n,sum(length_delta_m) total FROM inventory_movements WHERE reference_id=$1 AND movement_type='INTERNAL_PRODUCTION'",[batch])).rows[0];assert.equal(rawTotals.n,2);assert.equal(Number(rawTotals.total),80);

  const receipt={requestId:uuid(),dyePaperNo:'PAPER-Q',destinationWarehouseId:warehouse,lines:lines.map((sourceLineId,i)=>({sourceLineId,lengthM:10,barcode:`RESULT-${i}`,defective:i<3,defectReason:'OTHER',responsibleParty:'Supplier'}))};
  await call('POST',`/external/${job}/lifecycle/returns`,receipt);
  await call('POST',`/external/${job}/lifecycle/returns`,receipt); // Idempotent existing receipt.
  const inbox=(await call('GET','/quality/inbox')).filter((r:{kind:string})=>r.kind==='FINISHED');assert.equal(inbox.length,4);assert.equal(inbox.filter((r:{status:string})=>r.status==='QUALITY_HOLD').length,3);assert.equal(inbox.filter((r:{status:string})=>r.status==='PENDING_INSPECTION').length,1);
  assert.equal((await call('GET','/quality/inbox',undefined,200,outsider)).length,0);
  const before=Number((await db.query('SELECT count(*) n FROM inventory_movements')).rows[0].n);
  const returnRows=(await db.query('SELECT * FROM external_job_return_lines ORDER BY original_barcode')).rows;
  const defect=uuid();await db.query("INSERT INTO manufacturing_quality_defect_catalog(id,company_id,code,name,inspection_type) VALUES($1,$2,'Q-D','Defect','FINISHED_FABRIC')",[defect,company]);
  for(let i=0;i<3;i++){
   const q=returnRows[i];assert.equal(q.customer_order_id,i<2?orders[i]:null);assert.equal(q.customer_order_line_id,i<2?orderLines[i]:null);
   await call('GET',`/quality/finished/${q.id}/report`,undefined,404,outsider);
   const evidence={images:['/uploads/quality/inspection.png'],checklist:[{key:'VISUAL',result:'FAIL',notes:'Recorded defect'}],defects:[{defectId:defect,positionM:5,imageUrls:['https://example.org/defect.jpg'],quantity:1,severity:'MAJOR',notes:'Visual'}],notes:'Inspection evidence'};
   await call('POST',`/quality/finished/${q.id}/inspection`,evidence,403,viewer);
   await call('POST',`/quality/finished/${q.id}/inspection`,{...evidence,checklist:[...evidence.checklist,...evidence.checklist]},400,inspector);
   await call('POST',`/quality/finished/${q.id}/inspection`,{...evidence,defects:[{...evidence.defects[0],defectId:uuid()}]},400,inspector);
   await call('POST',`/quality/finished/${q.id}/inspection`,{...evidence,defects:[{...evidence.defects[0],positionM:11}]},400,inspector);
   await call('POST',`/quality/finished/${q.id}/inspection`,{...evidence,images:['javascript:alert(1)']},400,inspector);
   await call('POST',`/quality/finished/${q.id}/inspection`,{...evidence,images:['/uploads/../secret.png']},400,inspector);
   await call('POST',`/quality/finished/${q.id}/inspection`,evidence,200,inspector);
   const report=await call('GET',`/quality/finished/${q.id}/report`,undefined,200,stock);
   assert.equal(report.inspector_name,'Inspector');assert.equal(report.quality_checklist[0].result,'FAIL');assert.equal(report.quality_defects[0].defectId,defect);assert.equal(report.approver_name,null);assert.equal(report.resolution,null);assert.equal(report.roll_status,'RESERVED');assert.equal(report.quality_defects[0].positionM,5);assert.equal(report.quality_images[0],evidence.images[0]);
   assert.equal(Number((await db.query('SELECT count(*) n FROM inventory_movements')).rows[0].n),before+i);
   const decision=['ACCEPT','REWORK','WRITE_OFF'][i];
   await call('POST',`/quality/finished/${q.id}/decision`,{decision,notes:'Approved'},403,inspector);
   await call('POST',`/quality/finished/${q.id}/decision`,{decision,notes:'Approved'},404,outsider);
   await call('POST',`/quality/finished/${q.id}/decision`,{decision,notes:'Approved'});
   await call('POST',`/quality/finished/${q.id}/decision`,{decision,notes:'Repeated'},400);
   await call('POST',`/quality/finished/${q.id}/inspection`,evidence,409,inspector);
   const final=await call('GET',`/quality/finished/${q.id}/report`);assert.equal(final.approver_name,'Inspector');assert.equal(final.roll_status,['AVAILABLE','DAMAGED','INACTIVE'][i]);
   assert.equal(final.customer_order_id,i<2?orders[i]:null);assert.equal(final.customer_order_line_id,i<2?orderLines[i]:null);
  }
  const clean=returnRows[3];
  assert.equal((await call('GET',`/quality/finished/${clean.id}/report`)).quality_decision,'PENDING_INSPECTION');
  await call('POST',`/quality/finished/${clean.id}/inspection`,{checklist:[{key:'VISUAL',result:'PASS'}],defects:[],images:[]},200,inspector);
  const cleanReport=await call('GET',`/quality/finished/${clean.id}/report`);assert.equal(cleanReport.quality_decision,'ACCEPTED_BY_INSPECTION');assert.equal(cleanReport.resolution,null);assert.equal(cleanReport.approver_name,null);assert.equal(cleanReport.roll_status,'AVAILABLE');
  await call('POST',`/quality/finished/${clean.id}/decision`,{decision:'ACCEPT',notes:'No hold'},400);
  const warpDefect=uuid();await db.query("INSERT INTO manufacturing_quality_defect_catalog(id,company_id,code,name,inspection_type) VALUES($1,$2,'BEAM-D','Beam defect','WARP_BEAM')",[warpDefect,company]);
  const choices=await call('GET','/quality/defect-options?inspectionType=WARP_BEAM',undefined,200,token('user',['manufacturing.warping.quality']));assert.ok(choices.some((d:{id:string})=>d.id===warpDefect));assert.ok(!choices.some((d:{id:string})=>d.id===defect));
  assert.equal((await call('GET','/quality/defect-options?inspectionType=SIZED_BEAM')).length,0);
  assert.equal((await call('GET','/quality/defect-options?inspectionType=WARP_BEAM',undefined,200,outsider)).length,0);
  await call('GET','/quality/defect-options?inspectionType=INVALID',undefined,400);
  assert.equal(Number((await db.query('SELECT count(*) n FROM external_job_return_batches')).rows[0].n),1);
  assert.equal(Number((await db.query('SELECT count(*) n FROM inventory_movements')).rows[0].n),before+3);
  assert.equal(Number((await db.query('SELECT sum(length_m) n FROM external_job_return_lines')).rows[0].n),40);
  assert.equal(Number((await db.query("SELECT count(*) n FROM inventory_movements WHERE movement_type='EXTERNAL_JOB_RETURNED'")).rows[0].n),4);
 }finally{await app.close();await resetPool();await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();}
});
