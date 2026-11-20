import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import pg from 'pg';

test('execution: migration, workers, downtime, custody, isolation, versions and retries', {
 skip:process.env.CLOTEX_EXECUTION_LOCAL_TESTS!=='1'&&process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS!=='1',
},async()=>{
 const url=new URL(process.env.CLOTEX_EXECUTION_TEST_DATABASE_URL??process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL??'');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.search,'');
 assert.ok(
  (url.port==='55483'&&url.pathname==='/clotex_manufacturing_test')||
  (url.port==='55494'&&url.pathname==='/postgres'),
  'Execution tests require the guarded local manufacturing database or the isolated execution test cluster',
 );
 const admin=new pg.Client({connectionString:url.href});await admin.connect();
 const schema='execution_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema},public`);
 const dir=new URL('../db/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await admin.query(await readFile(new URL(file,dir),'utf8'));
 url.searchParams.set('options',`-c search_path=${schema},public -c client_encoding=UTF8`);
 process.env.DATABASE_URL=url.href;process.env.CLOTEX_EMBEDDED_SERVER='1';process.env.NODE_ENV='test';process.env.JWT_SECRET=randomUUID()+randomUUID();
 const {recordExecution,executionInput}=await import('./manufacturingExecutionService.js');
 const {resetPool}=await import('../db/pool.js');
 const {default:Fastify}=await import('fastify');const {manufacturingExecutionRoutes}=await import('../routes/manufacturingExecutionRoutes.js');const {signAuthToken}=await import('../middleware/auth.js');
 const app=Fastify();await app.register(manufacturingExecutionRoutes);
 try{
 const company=randomUUID(),other=randomUUID(),user=randomUUID(),spec=randomUUID(),revision=randomUUID(),work=randomUUID(),warp=randomUUID(),beam=randomUUID(),sizing=randomUUID(),sized=randomUUID(),weaving=randomUUID(),shiftLog=randomUUID();
 const employees=[randomUUID(),randomUUID(),randomUUID()],machines=[randomUUID(),randomUUID(),randomUUID()],shift=randomUUID(),reason=randomUUID();
 await admin.query("INSERT INTO companies(id,code,name) VALUES($1,'EXEC','Execution'),($2,'OTHER','Other')",[company,other]);
 await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES($1,$2,'exec','unused')",[user,company]);
 for(let i=0;i<3;i++)await admin.query('INSERT INTO payroll_employees(id,company_id,employee_code,full_name) VALUES($1,$2,$3,$3)',[employees[i],i===2?other:company,'E'+i]);
 await admin.query("INSERT INTO attendance_shift_types(id,company_id,code,name,start_time,end_time) VALUES($1,$2,'DAY','Day','08:00','16:00')",[shift,company]);
 for(let i=0;i<3;i++)await admin.query('INSERT INTO manufacturing_machines(id,company_id,code,name,machine_type) VALUES($1,$2,$3,$3,$3)',[machines[i],company,['WARPING','SIZING','LOOM'][i]]);
 await admin.query("INSERT INTO manufacturing_downtime_reasons(id,company_id,code,name,stage) VALUES($1,$2,'EXEC','Break','ALL')",[reason,company]);
 await admin.query("INSERT INTO manufacturing_specifications(id,company_id,code,name) VALUES($1,$2,'EXEC','Spec')",[spec,company]);
 await admin.query("INSERT INTO manufacturing_specification_versions(id,company_id,specification_id,version_no,status,source_file_name,source_file_content,source_file_size,source_file_sha256,parsed_data,approved_at) VALUES($1,$2,$3,1,'APPROVED','test.xlsx',decode('00','hex'),1,repeat('0',64),'{}',now())",[revision,company,spec]);
 await admin.query("INSERT INTO manufacturing_work_orders(id,company_id,work_order_no,specification_id,specification_version_id,specification_snapshot,target_length_m,status,released_at) VALUES($1,$2,'EXEC',$3,$4,jsonb_build_object('original',true),1000,'IN_PROGRESS',now())",[work,company,spec,revision]);
 await admin.query("INSERT INTO manufacturing_warping_orders(id,company_id,warping_order_no,work_order_id,planned_length_m,warping_machine_id,specification_snapshot,status) VALUES($1,$2,'EXEC',$3,1000,$4,jsonb_build_object('original',true),'IN_PROGRESS')",[warp,company,work,machines[0]]);
 await admin.query("INSERT INTO manufacturing_warp_beams(id,company_id,warping_order_id,beam_no,barcode,length_m,status,quality_status) VALUES($1,$2,$3,'B1','BAR1',1000,'READY_FOR_SIZING','ACCEPTED')",[beam,company,warp]);
 await admin.query("INSERT INTO manufacturing_sizing_orders(id,company_id,sizing_order_no,input_beam_id,sizing_machine_id,planned_length_m,status) VALUES($1,$2,'EXEC',$3,$4,1000,'IN_PROGRESS')",[sizing,company,beam,machines[1]]);
 await admin.query("INSERT INTO manufacturing_sized_beams(id,company_id,sizing_order_id,input_beam_id,beam_no,barcode,length_m,quality_status) VALUES($1,$2,$3,$4,'S1','SIZED1',1000,'ACCEPTED')",[sized,company,sizing,beam]);
 await admin.query("INSERT INTO manufacturing_weaving_runs(id,company_id,run_no,work_order_id,sized_beam_id,loom_id,planned_length_m,status) VALUES($1,$2,'EXEC',$3,$4,$5,1000,'IN_PROGRESS')",[weaving,company,work,sized,machines[2]]);
 await admin.query("INSERT INTO manufacturing_weaving_shift_logs(id,company_id,weaving_run_id,shift_type_id,production_date,counter_start,counter_end,produced_length_m,downtime_minutes) VALUES($1,$2,$3,$4,'2026-11-20',0,10,10,15)",[shiftLog,company,weaving,shift]);
 const daily=(version=1)=>executionInput.parse({requestId:randomUUID(),version,operation:'DAILY_LOG',productionDate:'2026-11-20',shiftTypeId:shift,machineId:machines[0],workers:employees.slice(0,2).map(employeeId=>({employeeId,minutes:480})),lengthM:10,downtimes:[{reasonId:reason,minutes:10},{reasonId:reason,minutes:5}],notes:'Measured execution'});
 const first=executionInput.parse({...daily(),startedAt:'2026-11-20T08:00',endedAt:'2026-11-20T09:00'});const result=await recordExecution(company,user,'WARPING',warp,first);assert.equal(result.version,2);
 const measured=(await admin.query('SELECT details FROM manufacturing_execution_records WHERE id=$1',[result.id])).rows[0].details;
 assert.equal(measured.startedAt,'2026-11-20T08:00');assert.equal(measured.endedAt,'2026-11-20T09:00');
 assert.equal(measured.durationMinutes,60);assert.equal(measured.runtimeMinutes,45);
 await assert.rejects(recordExecution(company,user,'WARPING',warp,executionInput.parse({...daily(2),startedAt:'2026-11-20T08:00',endedAt:'2026-11-20T08:14'})));
 assert.equal((await recordExecution(company,user,'WARPING',warp,first)).replayed,true);
 await assert.rejects(recordExecution(company,user,'WARPING',warp,{...first,notes:'Different payload'}));
 await assert.rejects(recordExecution(company,user,'WARPING',warp,daily()));
 const invalid=executionInput.parse({...daily(2),workers:[{employeeId:employees[2],minutes:480}]});await assert.rejects(recordExecution(company,user,'WARPING',warp,invalid));
 assert.equal((await admin.query('SELECT version FROM manufacturing_warping_orders WHERE id=$1',[warp])).rows[0].version,2);
 const override=executionInput.parse({requestId:randomUUID(),version:2,operation:'SELVEDGE_OVERRIDE',threadCount:24,yarnDescription:'Cotton 30',notes:'Approved operational change'});
 await recordExecution(company,user,'WARPING',warp,override);
 const original=(await admin.query('SELECT specification_snapshot,selvedge_override FROM manufacturing_warping_orders WHERE id=$1',[warp])).rows[0];assert.deepEqual(original.specification_snapshot,{original:true});assert.equal(original.selvedge_override.threadCount,24);
 const racing=await Promise.allSettled([recordExecution(company,user,'WARPING',warp,daily(3)),recordExecution(company,user,'WARPING',warp,daily(3))]);assert.equal(racing.filter(x=>x.status==='fulfilled').length,1);
 await recordExecution(company,user,'SIZING',sizing,executionInput.parse({...daily(),machineId:machines[1]}));
 const legacy=(await admin.query("SELECT details FROM manufacturing_execution_records WHERE stage='SIZING' AND subject_id=$1",[sizing])).rows[0].details;
 assert.equal('startedAt' in legacy,false);assert.equal('runtimeMinutes' in legacy,false);
 await recordExecution(company,user,'WEAVING',weaving,executionInput.parse({...daily(),machineId:machines[2],shiftLogId:shiftLog}));
 await assert.rejects(recordExecution(company,user,'WEAVING',weaving,executionInput.parse({...daily(2),machineId:machines[2],shiftLogId:shiftLog})));
 const handover=executionInput.parse({requestId:randomUUID(),version:1,operation:'HANDOVER',barcode:'BAR1',senderEmployeeId:employees[0],recipientEmployeeId:employees[1],fromLocation:'Warping',toLocation:'Sizing',notes:'Physical handover'});
 await assert.rejects(recordExecution(company,user,'WARP',beam,{...handover,barcode:'WRONG'}));
 await recordExecution(company,user,'WARP',beam,handover);
 await assert.rejects(recordExecution(company,user,'WARP',beam,{...handover,version:2,requestId:randomUUID()}));
 await recordExecution(company,user,'SIZED',sized,{...handover,barcode:'SIZED1',requestId:randomUUID()});
 assert.equal(Number((await admin.query('SELECT count(*) FROM manufacturing_execution_workers')).rows[0].count),8);
 assert.equal(Number((await admin.query('SELECT count(*) FROM manufacturing_execution_downtimes')).rows[0].count),8);
 const otherUser=randomUUID();await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES($1,$2,'other','unused')",[otherUser,other]);
 const token=(permissions:string[],companyId=company)=>signAuthToken({sub:companyId===other?otherUser:user,companyId,username:'exec',role:'user',permissions,isPlatformAdmin:false});
 const denied=await app.inject({method:'POST',url:`/SIZING/${sizing}`,headers:{authorization:`Bearer ${token(['manufacturing.sizing.view'])}`},payload:daily()});assert.equal(denied.statusCode,403);
 const hidden=await app.inject({url:`/WARPING/${warp}`,headers:{authorization:`Bearer ${token(['manufacturing.warping.view'],other)}`}});assert.equal(hidden.statusCode,404);
 const view=await app.inject({url:`/WARPING/${warp}`,headers:{authorization:`Bearer ${token(['manufacturing.warping.view'])}`}});assert.equal(view.statusCode,200);assert.equal(view.json().data.history.length,3);
 assert.equal(Number((await admin.query('SELECT count(*) FROM audit_logs WHERE action LIKE $1',['MANUFACTURING_%'])).rows[0].count),7);
 }finally{await app.close();await resetPool();await admin.end();}
});
