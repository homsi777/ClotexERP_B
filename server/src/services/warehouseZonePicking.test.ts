import assert from 'node:assert/strict';
import { groupRollsByZone, type ZoneRoll } from './warehouseZoneService.js';
async function main(){
 const base={item_id:'item',item_name:'Fabric',color_id:null,color_name:null,color_code:null,weight_kg:null,created_at:'2026-11-19',location_id:null,zone_name:null,status:'AVAILABLE'};
 const rows:ZoneRoll[]=[{...base,id:'r1',barcode:'001',warehouse_id:'w1',warehouse_name:'Warehouse A',length_m:10.125},{...base,id:'r2',barcode:'002',warehouse_id:'w2',warehouse_name:'Warehouse B',length_m:20.375}];
 const calls:Array<unknown[]> = [];
 const db={query:async(sql:string,params:unknown[])=>{assert.match(sql,/fr.company_id = \$1/);calls.push(params);return{rows};}};
 const groups=await groupRollsByZone(db as never,'company',['r1','r2','r1']);
 assert.equal(groups.length,2,'Unassigned rolls from different warehouses must remain separate');
 assert.deepEqual(groups.map(g=>g.warehouseId),['w1','w2']);
 assert.deepEqual(calls[0],['company',['r1','r2']]);
 assert.equal((await groupRollsByZone(db as never,'company',[])).length,0);
 console.log('warehouseZonePicking: warehouse separation, deduplication and company scope passed');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
