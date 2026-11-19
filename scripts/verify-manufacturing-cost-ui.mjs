// Isolated component smoke check: mocked HTTP, no production account or database.
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'manufacturing-cost-ui-check.tmp.html');
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {ManufacturingCostPanel} from '/src/components/manufacturing/ManufacturingCostPanel.tsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(ManufacturingCostPanel));</script></body></html>`;
const id='11111111-1111-4111-8111-111111111111',stage='22222222-2222-4222-8222-222222222222',lot='33333333-3333-4333-8333-333333333333';
const report={work:{work_order_no:'MO0000001',status:'IN_PROGRESS'},materials:[],warp:[],charges:[],external:[],rolls:[],unrated:0,totalUsd:0,acceptedLengthM:0,unitCostUsd:null,closure:null,breakdown:{warpUsd:0,materialUsd:0,chargeUsd:0,externalUsd:0}};
const options={orders:[{id,work_order_no:'MO0000001',status:'IN_PROGRESS'}],stages:[{id:stage,work_order_id:id,stage:'WEAVING',name:'WV0000001',status:'IN_PROGRESS'}],lots:[{id:lot,name:'خيط لحمة',barcode:'WEFT-1',weight_kg:'100.000'}],jobs:[],canPost:true,canPrice:true};
let browser,server;let posted=0;const errors=[];
try{
 await writeFile(fixture,html,'utf8');
 server=await createServer({root,server:{host:'127.0.0.1',port:51784,strictPort:true}});await server.listen();
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage();page.setDefaultTimeout(10000);page.on('requestfailed',r=>console.error('Failed:',r.url()));page.on('pageerror',e=>{errors.push(e.message);console.error('Page error:',e.message);});
 page.on('console',m=>{if(m.type()==='error')console.error('Browser:',m.text());});
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('fabric_erp_api_token','isolated-ui-test');localStorage.setItem('fabric_erp_api_base_url','http://127.0.0.1:51784');});
 await page.setRequestInterception(true);
 page.on('request',async req=>{
  const url=new URL(req.url());
  if(url.pathname.startsWith('/api/')){
   let data;
   if(url.pathname.endsWith('/options'))data=options;
   else if(req.method()==='POST'&&url.pathname.endsWith('/materials')){
    const body=JSON.parse(req.postData());assert.equal(body.weightKg,10);assert.equal(body.lotId,lot);assert.equal(body.stageId,stage);assert.match(body.requestId,/^[a-f0-9-]{36}$/);posted++;
    report.materials=[{id:'usage-1',kind:'ISSUE',yarn_lot_id:lot,weaving_run_id:stage,sizing_order_id:null,weight_kg:'10.000',waste_kg:'1.000',unit_cost:'4.0000',currency_code:'USD',notes:body.notes}];data={id:'usage-1'};
   }else data=report;
   return req.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify({ok:true,data})});
  }
  if(url.hostname!=='127.0.0.1'&&url.protocol!=='data:')return req.abort();
  return req.continue();
 });
 await page.setViewport({width:1440,height:1100});
 await page.goto('http://127.0.0.1:51784/manufacturing-cost-ui-check.tmp.html',{waitUntil:'networkidle0'});
 await page.waitForSelector('select[aria-label="أمر الإنتاج"] option[value="'+id+'"]');
 await page.select('select[aria-label="أمر الإنتاج"]',id);
 await page.waitForSelector('select[aria-label="مرحلة الإنتاج"]');
 await page.select('select[aria-label="مرحلة الإنتاج"]',stage);await page.select('select[aria-label="لوط المادة"]',lot);
 await page.type('input[aria-label="الوزن"]','10');
 await page.$eval('input[aria-label="الهالك ضمن المصروف"]',el=>{el.value='';});await page.type('input[aria-label="الهالك ضمن المصروف"]','1');
 await page.type('input[aria-label="ملاحظات الحركة"]','استهلاك لحمة للوردية');
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='تسجيل الحركة').click());
 await page.waitForFunction(()=>document.body.innerText.includes('استهلاك لحمة للوردية')&&document.querySelector('tbody tr'));
 assert.equal(posted,1);assert.deepEqual(errors,[]);console.log('Layout',await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,root:document.getElementById('root').getBoundingClientRect().toJSON(),fieldset:document.querySelector('fieldset').getBoundingClientRect().toJSON()})));
 await page.screenshot({path:path.join(root,'..','clotex-manufacturing-cost-desktop.png'),fullPage:true});
 await page.setViewport({width:390,height:844});
 await page.screenshot({path:path.join(root,'..','clotex-manufacturing-cost-mobile.png'),fullPage:true});
 console.log('Manufacturing cost UI: desktop/mobile render and material form submission passed; no page errors.');
}catch(e){if(browser){const pages=await browser.pages();console.error('UI body:',await pages[pages.length-1].evaluate(()=>document.body.innerText));}throw e;}finally{await browser?.close();await server?.close();await unlink(fixture).catch(()=>undefined);}
