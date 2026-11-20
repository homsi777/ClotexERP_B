import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {canYarn,yarnActions,yarnMutationActions} from './yarnPermissions.js';
import {receiveYarn,yarnReceiveSchema,parseYarnCsv} from './yarnDomainService.js';
import {mappedYarnCsv} from '../../../src/lib/inventory/yarnOpeningMapping.js';
for(const action of yarnActions){
 assert.equal(canYarn(null,action),false);
 assert.equal(canYarn({role:'admin',permissions:[]},action),true);
 assert.equal(canYarn({role:'legacy',permissions:['inventory.manage']},action),true);
 assert.equal(canYarn({role:'reader',permissions:['inventory.view']},action),false);
 for(const granted of yarnActions)assert.equal(canYarn({role:'restricted',permissions:['inventory.manage',`inventory.yarn.${granted}`]},action),action===granted);
}
assert.equal(canYarn({role:'legacy',permissions:['inventory.manage','inventory.yarn.cost.view']},'receiving'),true);
const item='00000000-0000-4000-8000-000000000001',warehouse='00000000-0000-4000-8000-000000000002';
const payload={itemId:item,warehouseId:warehouse,weightKg:10,barcode:'1234567',packageBarcodes:true,receiptPackages:{count:2,weightPerPackageKg:5}};
assert.equal(yarnReceiveSchema.safeParse({...payload,receiptPackages:null}).success,false);
assert.equal(yarnReceiveSchema.safeParse({...payload,weightKg:11}).success,false);
assert.equal(yarnReceiveSchema.safeParse({...payload,barcode:'12345678'}).success,false);
assert.equal(yarnReceiveSchema.safeParse({...payload,yarnProperties:{blend:[{fiber:'a',percent:99}]}}).success,false);
function mock(fail=false){const calls:Array<{sql:string;args?:unknown[]}>=[];const db={query:async(sql:string,args?:unknown[])=>{calls.push({sql,args});
 if(sql.includes('FROM fabric_items'))return {rows:[{id:item,unit:'kg'}]};
 if(sql.includes('FROM warehouses'))return {rows:[{id:warehouse}]};
 if(sql.includes('FROM currencies'))return {rows:[{code:'USD'}]};
 if(sql.includes('INSERT INTO yarn_lots'))return {rows:[{id:'lot',owner_type:'COMPANY'}]};
 if(sql.includes('INSERT INTO yarn_package_labels')&&fail)throw new Error('label failure');
 return {rows:[]};},release:()=>calls.push({sql:'RELEASE'})};return {calls,pool:{connect:async()=>db} as never};}
let m=mock();await receiveYarn(m.pool,'company','user',payload);
assert.equal(m.calls.filter(c=>c.sql.includes('INSERT INTO yarn_lots')).length,1);
assert.equal(m.calls.filter(c=>c.sql.includes('INSERT INTO yarn_lot_movements')).length,1);
assert.deepEqual(m.calls.filter(c=>c.sql.includes('INSERT INTO yarn_package_labels')).map(c=>c.args![3]),['1234567-0001','1234567-0002']);
assert.ok(m.calls.some(c=>c.sql==='COMMIT'));
m=mock(true);await assert.rejects(receiveYarn(m.pool,'company','user',payload),/label failure/);assert.ok(m.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!m.calls.some(c=>c.sql==='COMMIT'));
const rows=[['Code','Warehouse','Kg','Owner','Lot'],['001','W1','12.500','COMPANY','a,"b'],['','','','','']];const original=JSON.stringify(rows);
const mapping={itemCode:'0',warehouseCode:'1',weightKg:'2',ownerType:'3',lotNo:'4'};
const csv=mappedYarnCsv(rows,0,mapping);assert.equal(JSON.stringify(rows),original);const parsed=parseYarnCsv(csv);assert.equal(parsed[1][0],'001');assert.equal(parsed[1][2],'a,"b');assert.equal(parsed.length,2);
assert.throws(()=>mappedYarnCsv(rows,0,{...mapping,weightKg:'1'}));assert.throws(()=>mappedYarnCsv(rows,0,{itemCode:'0'}));assert.throws(()=>mappedYarnCsv([rows[0],...Array.from({length:501},()=>rows[1])],0,mapping));
console.log('yarnCompletion: permission matrix, package conservation/rollback, precision and Excel mapping passed');

const workbook=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(workbook,sheet,'Opening');
const binary=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});const reopened=XLSX.read(binary,{type:'buffer',cellText:true});
const extracted=XLSX.utils.sheet_to_json<string[]>(reopened.Sheets.Opening,{header:1,raw:false,defval:'',blankrows:true});
assert.equal(mappedYarnCsv(extracted,0,mapping),csv);
console.log('yarnCompletion: real XLSX in-memory round trip preserves code zeros, weights and quoted lot values');

for(const [path,body,expected] of [
 ['/profiles/:itemId',{},['profile']],['/minimum-stock/:itemId',{},['profile']],
 ['/opening/preview',{},['import']],['/opening/commit',{},['import']],
 ['/external/dispatch',{},['external']],['/external/:id/return',{shortageKg:0},['external']],
 ['/external/:id/return',{shortageKg:1},['external','settlement']],
 ['/:id/stock-operation',{type:'TRANSFER'},['transfer']],['/:id/stock-operation',{type:'ADJUST'},['settlement']],
 ['/',{},['receiving']],['/receipts/batch',{},['receiving']],['/:id',{},['receiving']]
] as const)assert.deepEqual(yarnMutationActions(path,body),expected);
assert.equal(yarnMutationActions('/external/:id/return',{shortageKg:1}).every(a=>canYarn({role:'restricted',permissions:['inventory.manage','inventory.yarn.external']},a)),false);
console.log('yarnCompletion: route permission mapping and separate external shortage approval passed');
