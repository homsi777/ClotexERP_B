import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'order-picking-ui-check.tmp.html');
const order={id:'order-1',orderNumber:'CO0000001',items:[{id:'line-1',materialName:'قطن',colorName:'أبيض',length:30,remainingMeters:30}],status:'pending'};
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {OrderPickingByZonePanel} from '/src/components/orders/OrderPickingByZonePanel.tsx';import '/src/index.css';window.printed=[];window.open=()=>({document:{open(){},write(html){window.printed.push(html)},close(){}}});createRoot(document.getElementById('root')).render(React.createElement(OrderPickingByZonePanel,{order:${JSON.stringify(order)},customerName:'عميل التجربة'}));</script></body></html>`;
let browser,server,blocked=false,requests=0;
const errors=[];
try{
 await writeFile(fixture,html,'utf8');server=await createServer({root,server:{host:'127.0.0.1',port:51785,strictPort:true}});await server.listen();
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('fabric_erp_api_base_url','http://127.0.0.1:51785');localStorage.setItem('fabric_erp_api_token','isolated-ui-test');});
 await page.setRequestInterception(true);page.on('request',async req=>{
  const url=new URL(req.url());
  if(url.pathname==='/api/warehouse-zones/group-rolls'){
   requests++;const codes=JSON.parse(req.postData()).barcodes;assert.deepEqual(codes,['0000001','0000002']);
   const groups=codes.map((code,i)=>({warehouseId:'w'+i,warehouseName:'مستودع '+(i+1),zoneId:null,zoneName:'عنبر غير محدد',totals:{count:1,meters:15,weightKg:0},rolls:[{id:'r'+i,barcode:code,item_name:'قطن',color_name:'أبيض',length_m:15,weight_kg:null,status:blocked&&i===1?'RESERVED':'AVAILABLE'}]}));
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:groups})});
  }
  if(url.pathname==='/favicon.ico')return req.respond({status:204});
  if(url.hostname!=='127.0.0.1')return req.respond({status:200,contentType:'text/css',body:''});
  return req.continue();
 });
 await page.setViewport({width:1280,height:900});await page.goto('http://127.0.0.1:51785/order-picking-ui-check.tmp.html',{waitUntil:'networkidle0'});
 await page.type('input[aria-label="باركود رول التجهيز"]','0000001 0000002');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===2);
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='طباعة كشف التجهيز').click());
 await page.waitForFunction(()=>window.printed.length===1);
 const printed=await page.evaluate(()=>window.printed[0]);assert.ok(printed.includes('مستودع 1'));assert.ok(printed.includes('مستودع 2'));assert.ok(printed.includes('CO0000001'));
 blocked=true;await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='طباعة كشف التجهيز').click());
 await page.waitForSelector('[role="alert"]');assert.equal(await page.evaluate(()=>window.printed.length),1,'Unavailable stock must not produce another print');assert.equal(requests,3);
 await page.setViewport({width:390,height:844});assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(root,'..','clotex-order-picking-mobile.png'),fullPage:true});
 console.log('Order picking UI passed: barcode entry, separate warehouses, printable sheet and fresh-stock rejection.');
}finally{await browser?.close();await server?.close();await unlink(fixture).catch(()=>undefined);}
