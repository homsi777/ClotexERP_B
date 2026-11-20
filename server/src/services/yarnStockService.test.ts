import assert from 'node:assert/strict';
import { stockOperationSchema, yarnReceiptSchema, yarnStockOperation } from './yarnStockService.js';
assert.equal(stockOperationSchema.safeParse({ type:'ADJUST',targetWeightKg:1.0001,expectedWeightKg:10,reason:'count',approved:true }).success,false);
assert.equal(stockOperationSchema.safeParse({ type:'ADJUST',targetWeightKg:1,expectedWeightKg:10,reason:'count',approved:false }).success,false);
assert.equal(yarnReceiptSchema.safeParse({ yarnProperties:{blend:[{fiber:'cotton',percent:80}]} }).success,false);
assert.equal(yarnReceiptSchema.safeParse({ yarnProperties:{blend:[{fiber:'cotton',percent:80},{fiber:'poly',percent:20}]} }).success,true);
function mock(weight = 100, owner = 'COMPANY', failMovement = false) {
 const calls: { sql:string; args?:unknown[] }[] = [];
 const client = { query: async (sql:string,args?:unknown[]) => {
   calls.push({sql,args});
   if (sql.includes('SELECT * FROM yarn_lots')) return { rows:[{weight_kg:weight,status:'AVAILABLE',owner_type:owner,warehouse_id:'source',location_id:null}] };
   if (sql.includes('SELECT id FROM warehouses')) return { rows:[{id:'dest'}] };
   if (sql.includes('INSERT INTO yarn_lots')) return {rows:[{id:'target'}]};
   if (failMovement && sql.includes('INSERT INTO yarn_lot_movements')) throw new Error('injected ledger failure');
   return {rows:[]};
 }, release:()=>calls.push({sql:'RELEASE'}) };
 return { calls,pool:{connect:async()=>client} as never };
}
const dest='00000000-0000-4000-8000-000000000001';
let m=mock();
await yarnStockOperation(m.pool,'company','user','lot',{type:'TRANSFER',weightKg:50,warehouseId:dest,reason:'relocate'});
assert.ok(m.calls.some(c=>c.sql.includes('FOR UPDATE')));
const movements=m.calls.filter(c=>c.sql.includes('INSERT INTO yarn_lot_movements'));
assert.equal(movements.length,2);
assert.equal(Number(movements[0].args![2])+Number(movements[1].args![3]),0);
assert.ok(m.calls.some(c=>c.sql==='COMMIT'));
m=mock(10); await assert.rejects(yarnStockOperation(m.pool,'c','u','l',{type:'TRANSFER',weightKg:11,warehouseId:dest,reason:'relocate'}));
assert.ok(m.calls.some(c=>c.sql==='ROLLBACK')); assert.ok(!m.calls.some(c=>c.sql.includes('UPDATE yarn_lots')));
m=mock(10); await assert.rejects(yarnStockOperation(m.pool,'c','u','l',{type:'ADJUST',targetWeightKg:9,expectedWeightKg:11,reason:'count',approved:true}));
m=mock(10,'CUSTOMER'); await assert.rejects(yarnStockOperation(m.pool,'c','u','l',{type:'ADJUST',targetWeightKg:9,expectedWeightKg:10,reason:'count',approved:true}));
m=mock(10,'COMPANY',true); await assert.rejects(yarnStockOperation(m.pool,'c','u','l',{type:'ADJUST',targetWeightKg:9,expectedWeightKg:10,reason:'count',approved:true}));
assert.ok(m.calls.some(c=>c.sql==='ROLLBACK')); assert.ok(!m.calls.some(c=>c.sql==='COMMIT'));
m=mock(10); await yarnStockOperation(m.pool,'c','u','l',{type:'ADJUST',targetWeightKg:9,expectedWeightKg:10,reason:'count',approved:true});
assert.equal(m.calls.find(c=>c.sql.includes('INSERT INTO yarn_lot_movements'))!.args![3],-1);
console.log('yarnStockService: validation, transfer conservation, locking, stale counts, ownership, rollback and audit passed');
