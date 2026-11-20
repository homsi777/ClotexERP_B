import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addManufacturingCharge,approveManufacturingCharge,manageManufacturingRate,validatePayrollAllocation,recordManufacturingConsumption,materialBalance} from './manufacturingCostService.js';
const company='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
function mock(responses:unknown[][]){const calls:{sql:string;args:unknown[]}[]=[];return {calls,db:{query:async(sql:string,args:unknown[]=[])=>{calls.push({sql,args});return {rows:responses.shift()??[]};}} as any};}
test('payroll reserves cannot exceed recognized source, including four-decimal boundary',()=>{
 validatePayrollAllocation(100,99.9999,0.0001);
 for(const a of [0,-1,0.0002,NaN])assert.throws(()=>validatePayrollAllocation(100,99.9999,a));
});
test('labor requires actual payroll identity, not a free-text reference',async()=>{
 const {db,calls}=mock([]);
 await assert.rejects(addManufacturingCharge(db,company,id,order,{requestId:id,kind:'LABOR',amount:10,currencyCode:'USD',sourceReference:'invented',notes:'test'}));
 assert.equal(calls.length,0);
});
test('foreign-company rate cannot be approved',async()=>{
 const {db,calls}=mock([[]]);await assert.rejects(manageManufacturingRate(db,company,id,{action:'APPROVE',rateId:id}));
 assert.deepEqual(calls[0].args,[company,id]);assert.match(calls[0].sql,/company_id=\$1/);
});
test('approved rate replay performs no mutation',async()=>{
 const {db,calls}=mock([[{id,status:'APPROVED'}]]);const r=await manageManufacturingRate(db,company,id,{action:'APPROVE',rateId:id});
 assert.equal(r.id,id);assert.equal(calls.length,1);
});
test('charge approval remains tenant/order scoped and idempotent',async()=>{
 const {db,calls}=mock([[{id:order}],[{id,kind:'OVERHEAD',approval_status:'APPROVED'}]]);
 await approveManufacturingCharge(db,company,id,order,{chargeId:id});assert.deepEqual(calls[1].args,[company,order,id]);assert.equal(calls.length,2);
});
test('closed order rejects new allocations before reading any payroll source',async()=>{
 const {db,calls}=mock([[],[],[{id:order,cost_closed:true}]]);
 await assert.rejects(addManufacturingCharge(db,company,id,order,{requestId:id,kind:'LABOR',payrollLineId:id,payrollBasis:'APPROVED_NET_SNAPSHOT',amount:1,currencyCode:'USD',notes:'test'}));
 assert.equal(calls.length,3);assert.ok(calls.every(c=>!c.sql.includes('FROM payroll_runs')));
});

test('shared consumption settles RECORDED sizing custody including prior returns and waste',async()=>{
 const entry={id,company_id:company,work_order_id:order,sizing_order_id:id,weaving_run_id:null,consumption_basis:'RECORDED',weight_kg:'100',waste_kg:'0'};
 const {db,calls}=mock([[{id:order,status:'IN_PROGRESS',cost_closed:false}],[],[entry],[],[{kg:'20'}],[{id}]]);
 const result=await recordManufacturingConsumption(db,company,id,order,{requestId:id,sourceEntryId:id,consumedKg:75,wasteKg:5,notes:'sizing custody settlement'});
 assert.equal(result.id,id);
 assert.equal(materialBalance(entry,20,[{consumed_kg:75,waste_kg:5}]).custodyKg,0);
 assert.deepEqual(calls[2].args,[company,order,id]);
 assert.ok(!calls.some(c=>c.sql.includes('FROM manufacturing_weaving_runs')));
});
test('sizing settlement cannot exceed custody after returns',async()=>{
 const entry={id,consumption_basis:'RECORDED',weight_kg:'100',waste_kg:'0'};
 const {db,calls}=mock([[{id:order,cost_closed:false}],[],[entry],[],[{kg:'20'}]]);
 await assert.rejects(recordManufacturingConsumption(db,company,id,order,{requestId:id,sourceEntryId:id,consumedKg:80,wasteKg:1,notes:'sizing'}));
 assert.ok(calls.every(c=>!c.sql.startsWith('INSERT')));
});
