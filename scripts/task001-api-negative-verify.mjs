import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
const data=JSON.parse(await fs.readFile('.local-test-results/task001-fixtures.json','utf8'));
assert.equal(data.api,'http://127.0.0.1:14030');
const pool=new pg.Pool({connectionString:'postgresql://task001@127.0.0.1:5432/clotex_transfer_test_task001'});
assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,'clotex_transfer_test_task001');
const identity=(await pool.query("SELECT current_setting('data_directory') AS directory")).rows[0];
assert.equal(path.resolve(identity.directory).toLowerCase(),path.resolve('.local-test-tools/pgdata').toLowerCase(),'Refusing an instance outside the isolated test cluster');
const results=[];
async function request(method,url,payload,token=data.token) {
  const response=await fetch(data.api+url,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
  return {status:response.status,body:await response.json()};
}
try {
  const suffix=randomUUID();const company=data.company;
  const warehouses=[];
  for(const name of ['source','dest','other'])warehouses.push((await pool.query('INSERT INTO warehouses(company_id,code,name) VALUES($1,$2,$3) RETURNING id',[company,`negative-${name}-${suffix}`,`Negative test ${name}`])).rows[0].id);
  const item=(await pool.query('INSERT INTO fabric_items(company_id,internal_code,name) VALUES($1,$2,$3) RETURNING id',[company,`negative-${suffix}`,'Negative test fabric'])).rows[0].id;
  const roll=(await pool.query("INSERT INTO fabric_rolls(company_id,barcode,item_id,warehouse_id,status,length_m,unit_cost,currency_code) VALUES($1,$2,$3,$4,'AVAILABLE',10,7,'USD') RETURNING id",[company,`negative-${suffix}`,item,warehouses[0]])).rows[0].id;
  const payload=()=>({fromWarehouseId:warehouses[0],toWarehouseId:warehouses[1],clientRequestId:randomUUID(),lines:[{fabricRollId:roll,quantity:1}]});
  for(const status of ['RESERVED','SOLD','DAMAGED','INACTIVE','TRANSFERRED']){
    await pool.query('UPDATE fabric_rolls SET status=$2 WHERE id=$1',[roll,status]);
    assert.equal((await request('POST','/api/inventory/transfers',payload())).status,409);
    results.push({test:`reject ${status}`,result:'PASS'});
  }
  await pool.query("UPDATE fabric_rolls SET status='AVAILABLE' WHERE id=$1",[roll]);
  assert.equal((await request('POST','/api/inventory/transfers',{...payload(),lines:[{fabricRollId:roll,quantity:2}]})).status,400);
  assert.equal((await request('POST','/api/inventory/transfers',{...payload(),toWarehouseId:randomUUID()})).status,400);
  assert.equal((await request('POST','/api/inventory/transfers',{...payload(),fromLocationId:randomUUID()})).status,400);
  await pool.query('UPDATE warehouses SET is_active=false WHERE id=$1',[warehouses[1]]);
  assert.equal((await request('POST','/api/inventory/transfers',payload())).status,400);
  await pool.query('UPDATE warehouses SET is_active=true WHERE id=$1',[warehouses[1]]);
  results.push({test:'invalid quantity, destination, location and inactive warehouse',result:'PASS'});
  const p=payload();const draft=await request('POST','/api/inventory/transfers',p);assert.equal(draft.status,201);
  assert.equal((await request('POST','/api/inventory/transfers',{...p,notes:'different'})).status,409);
  await pool.query('UPDATE fabric_rolls SET warehouse_id=$2 WHERE id=$1',[roll,warehouses[2]]);
  assert.equal((await request('PATCH',`/api/inventory/transfers/${draft.body.data.id}/confirm`,{})).status,409);
  assert.equal((await pool.query('SELECT status FROM inventory_transfers WHERE id=$1',[draft.body.data.id])).rows[0].status,'DRAFT');
  assert.equal(Number((await pool.query('SELECT count(*) FROM inventory_movements WHERE reference_id=$1',[draft.body.data.id])).rows[0].count),0);
  results.push({test:'changed payload and source revalidated without partial execution',result:'PASS'});
  await pool.query('UPDATE fabric_rolls SET warehouse_id=$2 WHERE id=$1',[roll,warehouses[0]]);
  const fresh=await request('POST','/api/inventory/transfers',payload());const id=fresh.body.data.id;
  await request('PUT',`/api/inventory/transfers/${id}`,{...payload(),notes:'edited after review'});
  assert.equal((await request('PATCH',`/api/inventory/transfers/${id}/confirm`,{expectedUpdatedAt:fresh.body.data.updated_at})).status,409);
  results.push({test:'stale review rejected',result:'PASS'});
  const race=await Promise.all([request('PATCH',`/api/inventory/transfers/${id}/confirm`,{}),request('PATCH',`/api/inventory/transfers/${id}/cancel`,{})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const final=(await pool.query('SELECT status FROM inventory_transfers WHERE id=$1',[id])).rows[0].status;
  const moved=(await pool.query('SELECT warehouse_id FROM fabric_rolls WHERE id=$1',[roll])).rows[0].warehouse_id;
  assert.equal(moved,final==='CONFIRMED'?warehouses[1]:warehouses[0]);
  results.push({test:'confirm/cancel race remains consistent',result:'PASS'});
  const username=`viewer-${suffix}`;
  const testPassword=randomUUID();
  await pool.query("INSERT INTO users(company_id,username,password_hash,role) VALUES($1,$2,$3,'viewer')",[company,username,await bcrypt.hash(testPassword,10)]);
  const login=await request('POST','/api/auth/login',{username,password:testPassword});
  assert.equal((await request('POST','/api/inventory/transfers',payload(),login.body.token)).status,403);
  results.push({test:'viewer cannot create transfers',result:'PASS'});
  await fs.writeFile('.local-test-results/task001-api-negative-results.json',JSON.stringify(results,null,2));
  console.log('Additional API verification groups passed:',results.length);
}finally{await pool.end();}
