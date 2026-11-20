import {randomUUID} from 'node:crypto';
import {manufacturingAssetRegister,setManufacturingAssetAcquisition} from './manufacturingFinancialSourcesService.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {addManufacturingCharge,manageManufacturingRate,approveManufacturingCharge} from './manufacturingCostService.js';
async function localTestClient() {
 const url=new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL??'');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55483');assert.equal(url.pathname,'/clotex_manufacturing_test');assert.equal(url.search,'');
 const db=new pg.Client({connectionString:url.href,connectionTimeoutMillis:3000});await db.connect();return db;
}
test('migration 116: real PostgreSQL tenant FKs, approvals, allocation limits, freeze and payroll guard', {skip:process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS!=='1'},async()=>{
 const db=await localTestClient();
 try{await db.query('BEGIN');const schema=`rates_116_${randomUUID().replaceAll('-','')}`;await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema},public`);
 await db.query(`CREATE TABLE companies(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE currencies(code text PRIMARY KEY);
 CREATE TABLE manufacturing_machines(id uuid,company_id uuid,is_active boolean,code text,name text,asset_value numeric,asset_currency_code text,ownership_type text,owner_name text,version integer DEFAULT 1,updated_by_user_id uuid,updated_at timestamptz,UNIQUE(company_id,id));
 CREATE TABLE manufacturing_work_orders(id uuid,company_id uuid,status text,UNIQUE(company_id,id));
 CREATE TABLE manufacturing_cost_closures(company_id uuid,work_order_id uuid,created_by_user_id uuid,created_at timestamptz);
 CREATE TABLE payroll_runs(id uuid PRIMARY KEY,company_id uuid,status text,currency_code text,exchange_rate_to_usd numeric);
 CREATE TABLE payroll_run_lines(id uuid PRIMARY KEY,company_id uuid,payroll_run_id uuid REFERENCES payroll_runs(id),employee_id uuid,net_salary numeric,base_salary numeric,allowances numeric,deductions numeric);
 CREATE TABLE audit_logs(company_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,details jsonb);
 CREATE TABLE exchange_rates(company_id uuid,currency_code text,exchange_rate_to_usd numeric,is_active boolean);
 CREATE TABLE manufacturing_cost_charges(id uuid DEFAULT gen_random_uuid(),company_id uuid,work_order_id uuid,request_id uuid,request_hash text,kind text,amount numeric(14,4),currency_code text,exchange_rate numeric,notes text,created_by_user_id uuid,source_reference text,UNIQUE(company_id,request_id));`);
 await db.query(await readFile(new URL('../db/migrations/116_manufacturing_internal_rates.sql',import.meta.url),'utf8'));
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',o='33333333-3333-4333-8333-333333333333',m='44444444-4444-4444-8444-444444444444',l='55555555-5555-4555-8555-555555555555';
 await db.query("INSERT INTO companies VALUES($1),($2);",[a,b]);await db.query('INSERT INTO users VALUES($1)',[a]);await db.query("INSERT INTO currencies VALUES('USD')");await db.query("INSERT INTO manufacturing_machines(id,company_id,is_active,code,name,asset_value,asset_currency_code,ownership_type) VALUES($1,$2,true,'LOOM','Test loom',5000,'USD','COMPANY')",[m,a]);await db.query("INSERT INTO manufacturing_work_orders VALUES($1,$2,'IN_PROGRESS')",[o,a]);
 await db.query("INSERT INTO payroll_runs VALUES($1,$2,'CONFIRMED','USD',1)",[m,a]);await db.query('INSERT INTO payroll_run_lines VALUES($1,$2,$3,$2,100,100,20,20)',[l,a,m]);
 const reject=async(fn:()=>Promise<unknown>)=>{await db.query('SAVEPOINT expected_failure');await assert.rejects(fn);await db.query('ROLLBACK TO SAVEPOINT expected_failure');};
 const rate=await manageManufacturingRate(db,a,a,{action:'CREATE',requestId:m,machineId:m,unit:'HOUR',kind:'OVERHEAD',amount:5,currencyCode:'USD',assetReference:'ASSET-1',notes:'approved business document'});
 assert.equal(rate.status,'UNAPPROVED');
 const register=await manufacturingAssetRegister(db,a);assert.equal(Number(register[0].asset_value),5000);assert.equal(register[0].acquisition_date,null);
 assert.deepEqual(await manufacturingAssetRegister(db,b),[]);
 await db.query('UPDATE manufacturing_machines SET asset_value=6000 WHERE company_id=$1 AND id=$2',[a,m]);
 assert.equal(Number((await manufacturingAssetRegister(db,a))[0].asset_value),6000,'register reads canonical machine value immediately');
 const acquisition={requestId:randomUUID(),machineId:m,version:1,acquisitionDate:'2026-11-01',notes:'Invoice evidence'};
 const saved=await setManufacturingAssetAcquisition(db,a,a,acquisition);assert.equal(saved.version,2);
 assert.equal((await setManufacturingAssetAcquisition(db,a,a,acquisition)).version,2,'same request does not increment machine version twice');
 await reject(()=>setManufacturingAssetAcquisition(db,b,a,{...acquisition,requestId:randomUUID()}));
 await reject(()=>setManufacturingAssetAcquisition(db,a,a,{...acquisition,requestId:randomUUID()}));
 const canonical=(await manufacturingAssetRegister(db,a))[0];assert.equal(canonical.acquisition_date,'2026-11-01');assert.equal(Number(canonical.asset_value),6000);

 await reject(()=>db.query('INSERT INTO manufacturing_cost_charges(company_id,internal_rate_id) VALUES($1,$2)',[b,rate.id]));
 await reject(()=>addManufacturingCharge(db,a,a,o,{requestId:l,kind:'OVERHEAD',internalRateId:rate.id,allocationQuantity:2,amount:10,currencyCode:'USD',notes:'allocation'}));
 await manageManufacturingRate(db,a,a,{action:'APPROVE',rateId:rate.id});
 await reject(()=>db.query('UPDATE manufacturing_internal_rates SET amount=6 WHERE id=$1',[rate.id]));
 const input={requestId:l,kind:'LABOR',payrollLineId:l,payrollBasis:'APPROVED_NET_SNAPSHOT',amount:60,currencyCode:'USD',notes:'payroll analytical allocation'};
 const charge=await addManufacturingCharge(db,a,a,o,input);assert.equal((await addManufacturingCharge(db,a,a,o,input)).duplicate,true);
 const snapshot=(await db.query('SELECT payroll_source_snapshot FROM manufacturing_cost_charges WHERE id=$1',[charge.id])).rows[0].payroll_source_snapshot;
 assert.equal(snapshot.grossEarnings,120);assert.equal(snapshot.deductions,20);assert.equal(snapshot.netSalary,100);assert.equal(snapshot.eligibleAmount,100);
 await reject(()=>addManufacturingCharge(db,a,a,o,{...input,requestId:o,amount:41}));
 await reject(()=>addManufacturingCharge(db,a,a,o,{...input,requestId:o,payrollBasis:'ELIGIBLE_EARNINGS',payrollEligibleAmount:120,amount:10}));
 // Separate real employee line explicitly allocates eligible earnings above net payment.
 const earningsLine=randomUUID();await db.query('INSERT INTO payroll_run_lines VALUES($1,$2,$3,$2,100,100,20,20)',[earningsLine,a,m]);
 const earnings={...input,requestId:randomUUID(),payrollLineId:earningsLine,payrollBasis:'ELIGIBLE_EARNINGS',payrollEligibleAmount:120,amount:110};
 await addManufacturingCharge(db,a,a,o,earnings);
 await reject(()=>addManufacturingCharge(db,a,a,o,{...earnings,requestId:randomUUID(),amount:10.0001}));
 await addManufacturingCharge(db,a,a,o,{...earnings,requestId:randomUUID(),amount:10});

 await approveManufacturingCharge(db,a,a,o,{chargeId:charge.id});
 await reject(()=>db.query('UPDATE manufacturing_cost_charges SET amount=10 WHERE id=$1',[charge.id]));
 await reject(()=>db.query("UPDATE payroll_runs SET status='CANCELLED' WHERE id=$1",[m]));
 await db.query("UPDATE payroll_runs SET status='PAID' WHERE id=$1",[m]);
 await reject(()=>db.query('UPDATE payroll_run_lines SET net_salary=10 WHERE id=$1',[l]));
 }finally{await db.query('ROLLBACK');await db.end();}
});

test('migration 116 installs with actual repository migration chain', {skip:process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS!=='1'},async()=>{
 const db=await localTestClient();
 try{await db.query('BEGIN');const schema=`rates_chain_${randomUUID().replaceAll('-','')}`;await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema},public`);
 const dir=new URL('../db/migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()) {
   try{await db.query(await readFile(new URL(file,dir),'utf8'));}catch(e){throw new Error(`Migration ${file} failed`,{cause:e});}
 }
 }finally{await db.query('ROLLBACK');await db.end();}
});
