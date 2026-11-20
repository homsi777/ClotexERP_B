import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { validateExternalReferences, saveExternalReferences } from './externalJobTraceability.js';
function testClient(){
  const url=new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL??'');
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55483');assert.equal(url.pathname,'/clotex_manufacturing_test');assert.equal(url.search,'');
  return new pg.Client({connectionString:url.href,connectionTimeoutMillis:3000});
}

test('migration 100 installs after the complete current migration chain', {
  skip: process.env.CLOTEX_GAP011_LOCAL_TESTS !== '1' && process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const db=testClient();
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema='gap011_chain_'+randomUUID().replaceAll('-','');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir=new URL('../db/migrations/',import.meta.url);
    const files=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
    for(const file of files) {
      try {await db.query(await readFile(new URL(file,dir),'utf8'));}
      catch(error) {throw new Error(`Migration ${file} failed`,{cause:error});}
    }
    assert.ok(files.includes('100_external_line_customer_order_traceability.sql'));
    console.log(`Installed ${files.length} migrations in an isolated rollback-only schema`);
  } finally {await db.query('ROLLBACK');await db.end();}
});

// Explicit opt-in, loopback only. Never loads application dotenv or production config.
test('external per-line order traceability, migration constraints and stage inheritance', {
  skip: process.env.CLOTEX_GAP011_LOCAL_TESTS !== '1' && process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const db = testClient();
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema='gap011_'+randomUUID().replaceAll('-','');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    await db.query(`CREATE TABLE customer_orders(id uuid PRIMARY KEY,company_id uuid NOT NULL,status text);
      CREATE TABLE customer_order_lines(id uuid PRIMARY KEY,company_id uuid NOT NULL,order_id uuid,line_no integer);
      CREATE TABLE external_jobs(id uuid PRIMARY KEY,company_id uuid);
      CREATE TABLE external_job_lines(id uuid PRIMARY KEY,company_id uuid NOT NULL,job_id uuid,roll_id uuid,line_status text DEFAULT 'SENT');
      CREATE TABLE external_job_return_lines(id uuid PRIMARY KEY,company_id uuid NOT NULL,job_id uuid,source_line_id uuid,result_roll_id uuid UNIQUE);`);
    await db.query(await readFile(new URL('../db/migrations/100_external_line_customer_order_traceability.sql',import.meta.url),'utf8'));
    const company=randomUUID(),foreign=randomUUID(),orderA=randomUUID(),orderB=randomUUID(),other=randomUUID();
    const colorA=randomUUID(),colorB=randomUUID(),job=randomUUID(),lineA=randomUUID(),lineB=randomUUID(),stock=randomUUID();
    const rollA=randomUUID(),rollB=randomUUID(),rollStock=randomUUID();
    await db.query(`INSERT INTO customer_orders VALUES($1,$4,'pending_supply'),($2,$4,'partial_ready'),($3,$5,'pending_supply')`,[orderA,orderB,other,company,foreign]);
    await db.query('INSERT INTO customer_order_lines VALUES($1,$3,$4,1),($2,$3,$5,1)',[colorA,colorB,company,orderA,orderB]);
    await db.query('INSERT INTO external_jobs(id,company_id) VALUES($1,$2)',[job,company]);
    for (const [id,roll] of [[lineA,rollA],[lineB,rollB],[stock,rollStock]]) await db.query('INSERT INTO external_job_lines(id,company_id,job_id,roll_id) VALUES($1,$2,$3,$4)',[id,company,job,roll]);
    const refs=await validateExternalReferences(db,company,[rollA,rollB,rollStock],[
      {rollId:rollA,customerOrderId:orderA,customerOrderLineId:colorA},
      {rollId:rollB,customerOrderId:orderB,customerOrderLineId:colorB},
      {rollId:rollStock,customerOrderId:null},
    ]);
    await saveExternalReferences(db,company,job,refs);
    assert.equal((await db.query('SELECT count(*)::int n FROM external_job_lines WHERE customer_order_id IS NOT NULL')).rows[0].n,2);
    assert.equal((await db.query('SELECT customer_order_id FROM external_job_lines WHERE id=$1',[stock])).rows[0].customer_order_id,null);
    for (const ref of [
      {rollId:rollA,customerOrderId:other},
      {rollId:rollA,customerOrderId:orderA,customerOrderLineId:colorB},
      {rollId:randomUUID(),customerOrderId:orderA},
      {rollId:rollA,customerOrderLineId:colorA},
    ]) await assert.rejects(validateExternalReferences(db,company,[rollA],[ref]));
    await assert.rejects(validateExternalReferences(db,company,[rollA],[refs[0],refs[0]]));
    const rejectSql=async(sql:string,args:unknown[],code:string)=>{
      await db.query('SAVEPOINT expected_failure');
      await assert.rejects(db.query(sql,args),(e:unknown)=>(e as {code:string}).code===code);
      await db.query('ROLLBACK TO SAVEPOINT expected_failure');
    };
    await rejectSql('UPDATE external_job_lines SET customer_order_id=$1 WHERE id=$2',[other,stock],'23503');
    await rejectSql('UPDATE external_job_lines SET customer_order_line_id=$1 WHERE id=$2',[colorB,lineA],'23503');
    const returnedRoll=randomUUID();
    for (const roll of [returnedRoll,randomUUID()]) await db.query('INSERT INTO external_job_return_lines(id,company_id,job_id,source_line_id,result_roll_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),company,job,lineA,roll]);
    const returns=(await db.query('SELECT * FROM external_job_return_lines')).rows;
    assert.equal(returns.length,2);assert.ok(returns.every(r=>r.customer_order_id===orderA&&r.customer_order_line_id===colorA));
    await rejectSql('UPDATE external_job_lines SET customer_order_id=NULL,customer_order_line_id=NULL WHERE id=$1',[lineA],'23514');
    await rejectSql('DELETE FROM customer_order_lines WHERE id=$1',[colorA],'23503');
    const next=randomUUID();
    await db.query('INSERT INTO external_job_lines(id,company_id,job_id,roll_id) VALUES($1,$2,$3,$4)',[next,company,job,returnedRoll]);
    const inherited=(await db.query('SELECT * FROM external_job_lines WHERE id=$1',[next])).rows[0];
    assert.equal(inherited.customer_order_id,orderA);assert.equal(inherited.customer_order_line_id,colorA);
    await rejectSql('INSERT INTO external_job_return_lines(id,company_id,job_id,source_line_id,result_roll_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),foreign,job,lineA,randomUUID()],'23503');
    for (const status of ['draft','cancelled','completed']) {
      await db.query('UPDATE customer_orders SET status=$1 WHERE id=$2',[status,orderB]);
      await assert.rejects(validateExternalReferences(db,company,[rollB],[refs[1]]));
    }
  } finally { await db.query('ROLLBACK'); await db.end(); }
});
