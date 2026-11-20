import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {resolveOrderItemSpecification,setItemSpecification,confirmOrderLineProduction} from './customerOrderWorkflowService.js';

test('mapping migration and services: isolation, approval, revisions, immutable history, stale defaults and production confirmation',{
 skip:process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS!=='1',
},async()=>{
 // Guard the shared disposable localhost cluster before connecting; never load application .env.
 const url=new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL??'');
 assert.equal(url.hostname,'127.0.0.1');
 assert.equal(url.port,'55483');
 assert.equal(url.pathname,'/clotex_manufacturing_test');
 assert.equal(url.search,'');
 const db=new pg.Client({connectionString:url.href,connectionTimeoutMillis:3000});await db.connect();
 try{
 await db.query('BEGIN');
 const schema='mapping_'+randomUUID().replaceAll('-','');await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET LOCAL search_path TO ${schema},public`);
 const dir=new URL('../db/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()){
  try{await db.query(await readFile(new URL(file,dir),'utf8'));}
  catch(error){throw new Error(`Migration ${file} failed`,{cause:error});}
 }
 const company=randomUUID(),other=randomUUID(),user=randomUUID(),item=randomUUID(),foreignItem=randomUUID(),spec=randomUUID(),version=randomUUID();
 await db.query("INSERT INTO companies(id,code,name) VALUES($1,'A','A'),($2,'B','B')",[company,other]);
 await db.query("INSERT INTO users(id,company_id,username,password_hash) VALUES($1,$2,'mapping','unused')",[user,company]);
 await db.query("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES($1,$2,'FAB','Fabric'),($3,$4,'FAB','Fabric')",[item,company,foreignItem,other]);
 await db.query("INSERT INTO manufacturing_specifications(id,company_id,code,name) VALUES($1,$2,'S','Spec')",[spec,company]);
 await db.query(`INSERT INTO manufacturing_specification_versions(id,company_id,specification_id,version_no,status,source_file_name,source_file_content,source_file_size,source_file_sha256,parsed_data,approved_at) VALUES($1,$2,$3,1,'APPROVED','test.xlsx',decode('00','hex'),1,repeat('0',64),'{}',now())`,[version,company,spec]);
 const line={roll_no:'FAB',material_name:'Fabric'};
 assert.equal((await resolveOrderItemSpecification(db as any,company,line)).state,'UNMAPPED');
 const first=await setItemSpecification(db as any,company,user,item,{specificationVersionId:version,expectedRevision:0,reason:'initial'});
 assert.equal(first.revision,1);
 assert.equal((await resolveOrderItemSpecification(db as any,company,line)).mapping.id,first.id);
 assert.equal((await resolveOrderItemSpecification(db as any,other,line)).state,'UNMAPPED');
 const rejects=async(fn:()=>Promise<unknown>,pattern:RegExp|{code:string})=>{await db.query('SAVEPOINT rejection');await assert.rejects(fn,pattern);await db.query('ROLLBACK TO SAVEPOINT rejection');};
 await rejects(()=>setItemSpecification(db as any,company,user,foreignItem,{specificationVersionId:version,expectedRevision:0,reason:'foreign'}),{code:'NOT_FOUND'});
 await rejects(()=>setItemSpecification(db as any,company,user,item,{specificationVersionId:version,expectedRevision:0,reason:'stale client'}),{code:'CONFLICT'});
 await rejects(()=>db.query('UPDATE manufacturing_item_specifications SET reason=$1 WHERE id=$2',['tampered',first.id]),/immutable/);
 await rejects(()=>db.query('DELETE FROM manufacturing_item_specifications WHERE id=$1',[first.id]),/immutable/);
 const removed=await setItemSpecification(db as any,company,user,item,{specificationVersionId:null,expectedRevision:1,reason:'remove'});assert.equal(removed.revision,2);
 assert.equal((await resolveOrderItemSpecification(db as any,company,line)).state,'UNMAPPED');
 await rejects(()=>setItemSpecification(db as any,company,user,item,{specificationVersionId:version,expectedRevision:1,reason:'stale after removal'}),{code:'CONFLICT'});
 const restored=await setItemSpecification(db as any,company,user,item,{specificationVersionId:version,expectedRevision:2,reason:'restore'});assert.equal(restored.revision,3);
 const customer=randomUUID(),order=randomUUID(),orderLine=randomUUID();
 await db.query("INSERT INTO customers(id,company_id,code,name) VALUES($1,$2,'C','Customer')",[customer,company]);
 await db.query("INSERT INTO customer_orders(id,company_id,order_no,customer_id,status) VALUES($1,$2,'CO1',$3,'pending_supply')",[order,company,customer]);
 await db.query("INSERT INTO customer_order_lines(id,company_id,order_id,line_no,material_name,roll_no,length) VALUES($1,$2,$3,1,'Fabric','FAB',100)",[orderLine,company,order]);
 const confirmation={confirmed:true,specificationVersionId:version,mappingId:restored.id,targetLengthM:100};
 await rejects(()=>confirmOrderLineProduction(db as any,other,user,order,orderLine,confirmation),{code:'NOT_FOUND'});
 await rejects(()=>confirmOrderLineProduction(db as any,company,user,order,orderLine,{...confirmation,mappingId:first.id}),{code:'CONFLICT'});
 await rejects(()=>confirmOrderLineProduction(db as any,company,user,order,orderLine,{...confirmation,targetLengthM:101}),{code:'CONFLICT'});
 const production=await confirmOrderLineProduction(db as any,company,user,order,orderLine,confirmation);
 assert.equal(production.status,'DRAFT');
 assert.equal((await db.query('SELECT specification_version_id FROM manufacturing_work_orders WHERE id=$1',[production.id])).rows[0].specification_version_id,version);
 assert.equal(Number((await db.query('SELECT allocated_length_m FROM manufacturing_work_order_allocations WHERE work_order_id=$1',[production.id])).rows[0].allocated_length_m),100);
 await rejects(()=>confirmOrderLineProduction(db as any,company,user,order,orderLine,confirmation),{code:'CONFLICT'});
 // A subsequent mapping change must never rewrite an existing approved production snapshot.
 await db.query("UPDATE manufacturing_work_orders SET status='RELEASED',released_at=now(),specification_snapshot=$2::jsonb WHERE id=$1",[production.id,JSON.stringify({immutable:'approved original'})]);
 await setItemSpecification(db as any,company,user,item,{specificationVersionId:null,expectedRevision:3,reason:'after release'});
 assert.deepEqual((await db.query('SELECT specification_snapshot FROM manufacturing_work_orders WHERE id=$1',[production.id])).rows[0].specification_snapshot,{immutable:'approved original'});
 await setItemSpecification(db as any,company,user,item,{specificationVersionId:version,expectedRevision:4,reason:'restore again'});
 await db.query("UPDATE manufacturing_specification_versions SET status='ARCHIVED',archived_at=now() WHERE id=$1",[version]);
 assert.equal((await resolveOrderItemSpecification(db as any,company,line)).state,'STALE');
 await rejects(()=>setItemSpecification(db as any,company,user,item,{specificationVersionId:version,expectedRevision:5,reason:'archived'}),{code:'VALIDATION'});
 await rejects(()=>confirmOrderLineProduction(db as any,company,user,randomUUID(),randomUUID(),{confirmed:false,specificationVersionId:version,mappingId:restored.id,targetLengthM:10}),{code:'VALIDATION'});
 await db.query("INSERT INTO fabric_items(company_id,internal_code,name) VALUES($1,'SECOND','Fabric')",[company]);
 assert.equal((await resolveOrderItemSpecification(db as any,company,{roll_no:'FAB',dsam_number:'SECOND',material_name:'Fabric'})).state,'AMBIGUOUS_ITEM');
 assert.equal((await resolveOrderItemSpecification(db as any,company,{material_name:'Fabric'})).state,'AMBIGUOUS_ITEM');
 assert.equal((await resolveOrderItemSpecification(db as any,company,{roll_no:'UNKNOWN',material_name:'Fabric'})).state,'ITEM_NOT_FOUND');
 assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='SET_ITEM_SPECIFICATION'",[company])).rows[0].n,5);
 assert.deepEqual((await db.query('SELECT parsed_data FROM manufacturing_specification_versions WHERE id=$1',[version])).rows[0].parsed_data,{});
 }finally{await db.query('ROLLBACK');await db.end();}
});
