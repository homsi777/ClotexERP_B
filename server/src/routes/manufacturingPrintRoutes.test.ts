import assert from 'node:assert/strict';
import {test} from 'node:test';
import Fastify from 'fastify';
import type {Pool,PoolClient} from 'pg';
import * as XLSX from 'xlsx';
import {createManufacturingPrintRoutes,readManufacturingDraft} from './manufacturingPrintRoutes.js';
import type {JwtPayload} from '../middleware/auth.js';

const id='11111111-1111-4111-8111-111111111111';
const user:JwtPayload={sub:id,companyId:'22222222-2222-4222-8222-222222222222',role:'user',username:'test',permissions:[],isPlatformAdmin:false};
async function fixture(actor:JwtPayload|undefined,missing=false,auditFailure=false){
  const calls:Array<{sql:string;values?:unknown[]}>=[];
  let released=false;
  const db={query:async(sql:string,values?:unknown[])=>{
    calls.push({sql,values});
    if(sql.includes('INSERT INTO audit_logs')&&auditFailure)throw new Error('audit unavailable');
    if(sql.startsWith('SELECT')){
      assert.equal(values?.[0],user.companyId,'tenant is taken from authenticated user');
      assert.equal(values?.[1],id,'entity is parameterized');
      if(missing)return {rows:[]};
      if(sql.includes('manufacturing_work_order_allocations'))return {rows:[]};
      return {rows:[{id,beam_no:'ACTUAL',barcode:'ACTUAL-BC',status:'REJECTED',work_order_no:'WO',version:2,...(sql.includes('v.source_file_content')?{parsed_data:{warp:null,weft:null},source_file_content:null}:{})}]};
    }
    return {rows:[]};
  },release:()=>{released=true;}};
  const app=Fastify();
  await app.register(createManufacturingPrintRoutes({authenticate:async req=>{if(actor)req.user=actor;},pool:()=>({connect:async()=>db as unknown as PoolClient}) as Pick<Pool,'connect'>}),{prefix:'/api/manufacturing/print'});
  return {app,calls,released:()=>released};
}
test('all print resources deny unauthenticated and wrong-module access without database reads',async()=>{
  for(const actor of [undefined,user,{...user,permissions:['manufacturing.dashboard.view','manufacturing.work_orders.manage']}]){
    const f=await fixture(actor);
    try{for(const kind of ['work-orders','warp-beams','sized-beams']){
      const r=await f.app.inject({method:'POST',url:'/api/manufacturing/print/'+kind+'/'+id});
      assert.equal(r.statusCode,actor?403:401);
    }assert.equal(f.calls.length,0);}finally{await f.app.close();}
  }
});
test('module view permission and admin work; data is tenant scoped and audited before response',async()=>{
  for(const [kind,permission] of [['work-orders','manufacturing.work_orders.view'],['warp-beams','manufacturing.warping.view'],['sized-beams','manufacturing.sizing.view']]){
    for(const actor of [{...user,permissions:[permission]},{...user,role:'admin'}]){
      const f=await fixture(actor);
      try{
        const r=await f.app.inject({method:'POST',url:'/api/manufacturing/print/'+kind+'/'+id});
        assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');
        assert.equal(r.json().data.source_file_content,undefined);
        const audit=f.calls.find(c=>c.sql.includes('INSERT INTO audit_logs'))!;
        assert.equal(audit.values?.[0],user.companyId);assert.equal(audit.values?.[1],user.sub);
        assert.equal(JSON.parse(String(audit.values?.[4])).physicalPrintConfirmed,false);
        assert.equal(f.calls.at(-1)?.sql,'COMMIT');assert.equal(f.released(),true);
        for(const c of f.calls.filter(c=>c.sql.startsWith('SELECT')))assert.ok(c.sql.includes('company_id=$1'));
      }finally{await f.app.close();}
    }
  }
});
test('invalid ids, invisible entities and failed audits never return print data',async()=>{
  for(const mode of ['invalid','missing','audit']){
    const f=await fixture({...user,role:'admin'},mode==='missing',mode==='audit');
    try{
      const r=await f.app.inject({method:'POST',url:'/api/manufacturing/print/work-orders/'+(mode==='invalid'?'bad':id)});
      assert.equal(r.statusCode,mode==='invalid'?400:mode==='missing'?404:500);
      assert.equal(r.json().data,undefined);
      if(mode==='invalid')assert.equal(f.calls.length,0);
      else{assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.ok(f.released());}
    }finally{await f.app.close();}
  }
});
test('draft extraction preserves original bytes, cached values, formulas and source cell order',()=>{
  const wb=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([['<unsafe>',0],[1,2]]);
  sheet.B2={t:'n',v:2,f:'A2*2'};XLSX.utils.book_append_sheet(wb,sheet,'التركيب واللقي');
  const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}) as Buffer,original=Buffer.from(buffer);
  const result=readManufacturingDraft(buffer);
  assert.deepEqual(buffer,original);assert.deepEqual(result.cells.map(c=>c.address),['A1','B1','A2','B2']);
  assert.equal(result.cells[1].value,0);assert.equal(result.cells[3].formula,'A2*2');assert.equal(result.cells[3].value,2);
  assert.ok(result.limitation.includes('ليست مستنسخة'));
  assert.equal(readManufacturingDraft(null).cells.length,0);
  assert.equal(readManufacturingDraft(buffer,'missing').cells.length,0);
});
