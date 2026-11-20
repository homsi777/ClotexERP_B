import assert from 'node:assert/strict';
import { writeFile, unlink,readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

/** Uses the real Fastify handlers and isolated PostgreSQL fixture, not canned API responses. */
export async function verifyManufacturingScreens(app:FastifyInstance,token:string,nextStage:'SIZING'|'WEAVING',warpingId:string){
 const {createServer}=await import('vite');const{default:puppeteer}=await import('puppeteer-core');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
 const fixture=path.join(root,'manufacturing-screens-check.tmp.html');
 const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{WarpingOrdersPanel}from'/src/components/manufacturing/WarpingOrdersPanel.tsx';import{SizingOrdersPanel}from'/src/components/manufacturing/SizingOrdersPanel.tsx';import{WeavingRunsPanel}from'/src/components/manufacturing/WeavingRunsPanel.tsx';import'/src/index.css';function Screens(){const[tab,setTab]=useState('warping');return React.createElement('main',{style:{maxWidth:'100%',overflow:'hidden'}},React.createElement('nav',null,...['warping','sizing','weaving'].map(t=>React.createElement('button',{'data-tab':t,onClick:()=>setTab(t),key:t},t))),tab==='warping'?React.createElement(WarpingOrdersPanel,{canManage:true,canQuality:true,canApproveYarn:true}):tab==='sizing'?React.createElement(SizingOrdersPanel,{canManage:true}):React.createElement(WeavingRunsPanel,{canManage:true}));}createRoot(document.getElementById('root')).render(React.createElement(Screens));</script></body></html>`;
 let browser:import('puppeteer-core').Browser|undefined,server:import('vite').ViteDevServer|undefined;
 const errors:string[]=[],failedRequests:string[]=[],seen=new Set<string>();
 let completionCount=0;
 try{
  await writeFile(fixture,html,'utf8');server=await createServer({root,server:{host:'127.0.0.1',port:51786,strictPort:true}});await server.listen();
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument((auth)=>{localStorage.setItem('fabric_erp_api_base_url','http://127.0.0.1:51786');localStorage.setItem('fabric_erp_api_token',auth);},token);
  await page.setRequestInterception(true);page.on('request',async req=>{
   const url=new URL(req.url());
   if(url.pathname.startsWith('/api/manufacturing/')){
    try{
     const route=url.pathname.replace('/api/manufacturing','');seen.add(`${req.method()} ${route}`);
     const result=await app.inject({method:req.method() as 'GET'|'POST'|'PUT',url:route+url.search,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(req.postData()?{payload:JSON.parse(req.postData()!)}:{})});
     if(result.statusCode>=400)failedRequests.push(`${route}: ${result.body}`);
     if(route===`/warping/${warpingId}/complete`){completionCount++;assert.equal(JSON.parse(req.postData()!).nextStage,nextStage);}
     await req.respond({status:result.statusCode,contentType:'application/json',body:result.body});
    }catch(e){failedRequests.push(String(e));await req.respond({status:500,contentType:'application/json',body:JSON.stringify({message:String(e)})});}
    return;
   }
   if(url.pathname==='/favicon.ico'){await req.respond({status:204});return;}
   if(url.hostname!=='127.0.0.1'){await req.respond({status:200,contentType:'text/css',body:''});return;}
   await req.continue();
  });
  await page.setViewport({width:390,height:844});await page.goto('http://127.0.0.1:51786/manufacturing-screens-check.tmp.html',{waitUntil:'networkidle0'});
  for(const tab of ['sizing','weaving','warping']){
   await page.click(`[data-tab="${tab}"]`);await page.waitForNetworkIdle();
   assert.ok(seen.has(`GET /${tab}/options`),`UI must load ${tab} options`);
   assert.deepEqual(failedRequests,[],`Screen ${tab} API failures`);
  }
  const cardPopup= new Promise<import('puppeteer-core').Page>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Warp-card popup did not open')),10000);page.once('popup',popup=>{if(popup){clearTimeout(timer);resolve(popup);}});});
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim().startsWith('طباعة ('));if(!b)throw new Error('Missing card print action');b.click();});
  const popup=await cardPopup;
  await popup.waitForFunction(()=>document.body?.innerText.includes('كارت السداء'));
  assert.ok((await popup.content()).includes('WARP-'),'Printed card must contain its barcode');
  await popup.close();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='قبول وفحص'&&!b.disabled));
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()==='قبول وفحص');if(!b)throw new Error('Missing quality action');b.click();});
  await page.waitForSelector('select[aria-label="المرحلة التالية للمطواة"]');
  await page.select('select[aria-label="المرحلة التالية للمطواة"]',nextStage);
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()==='حفظ نتيجة الفحص');if(!b)throw new Error('Missing save action');b.click();});
  await page.waitForFunction(()=>!document.querySelector('select[aria-label="المرحلة التالية للمطواة"]'));
  assert.equal(completionCount,1);assert.deepEqual(failedRequests,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(root,'..',`clotex-manufacturing-fixed-${nextStage.toLowerCase()}.png`),fullPage:true});
  console.log(`Real browser + Fastify + PostgreSQL passed: three operational tabs and ${nextStage} beam handoff`);
 }finally{await browser?.close();if(server){await server.waitForRequestsIdle();await server.close();await server.watcher.close();}await unlink(fixture).catch(()=>undefined);}
}

export async function verifyExternalManufacturingUI(app:FastifyInstance,token:string,jobId:string,warehouseId:string,lineId:string){
 const{createServer}=await import('vite');const{default:puppeteer}=await import('puppeteer-core');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
 const fixture=path.join(root,'manufacturing-navigation-check.tmp.html');
 const texts=JSON.parse(await readFile(path.join(root,'src/locales/ar/externalJobs.json'),'utf8'));
 const label=(key:string)=>texts[`lifecycle.${key}`] as string;
 const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import{ToastProvider}from'/src/components/NonBlockingToast.tsx';import{Manufacturing}from'/src/pages/Manufacturing.tsx';import{ExternalJobReceipt}from'/src/pages/purchases/ExternalJobReceipt.tsx';import'/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/manufacturing']},React.createElement(ToastProvider,null,React.createElement(Routes,null,React.createElement(Route,{path:'/manufacturing',element:React.createElement(Manufacturing)}),React.createElement(Route,{path:'/purchases/external-jobs/:id',element:React.createElement(ExternalJobReceipt)})))));</script></body></html>`;
 let browser:import('puppeteer-core').Browser|undefined,server:import('vite').ViteDevServer|undefined;
 const failed:string[]=[],errors:string[]=[];let received=0;
 try{
  await writeFile(fixture,html,'utf8');server=await createServer({root,server:{host:'127.0.0.1',port:51787,strictPort:true}});await server.listen();
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(auth=>{localStorage.setItem('fabric_erp_api_base_url','http://127.0.0.1:51787');localStorage.setItem('fabric_erp_api_token',auth);},token);
  await page.setRequestInterception(true);page.on('request',async req=>{
   const url=new URL(req.url());if(url.pathname.startsWith('/api/')){
    let route=url.pathname.replace('/api/manufacturing','').replace('/api/external-jobs','/external').replace('/api/warehouse-locations','/locations').replace('/api/warehouses','/warehouses').replace('/api/auth','/auth');
    try{const result=await app.inject({method:req.method() as 'GET'|'POST',url:route+url.search,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(req.postData()?{payload:JSON.parse(req.postData()!)}:{})});
     if(result.statusCode>=400)failed.push(`${route}: ${result.body}`);
     if(route===`/external/${jobId}/lifecycle/returns`){received++;assert.equal(JSON.parse(req.postData()!).lines[0].sourceLineId,lineId);}
     await req.respond({status:result.statusCode,contentType:'application/json',body:result.body});
    }catch(e){failed.push(String(e));await req.respond({status:500,contentType:'application/json',body:JSON.stringify({message:String(e)})});}return;
   }
   if(url.pathname==='/favicon.ico'){await req.respond({status:204});return;}
   if(url.hostname!=='127.0.0.1'){await req.respond({status:200,contentType:'text/css',body:''});return;}
   await req.continue();
  });
  await page.setViewport({width:390,height:844});await page.goto('http://127.0.0.1:51787/manufacturing-navigation-check.tmp.html',{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-manufacturing-group="operations"]');
  assert.equal(await page.$$eval('[data-manufacturing-group]',els=>els.length),6,'Manufacturing home must have six clear sections');
  await page.screenshot({path:path.join(root,'..','clotex-manufacturing-home-mobile.png'),fullPage:true});
  await page.setViewport({width:1280,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Desktop navigation must fit its viewport');
  assert.equal(await page.$$eval('[data-manufacturing-group]',els=>els.every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),true,'Every navigation card must be visible within the desktop viewport');
  await page.screenshot({path:path.join(root,'..','clotex-manufacturing-home-desktop.png'),fullPage:true});
  await page.screenshot({path:path.join(root,'..','clotex-manufacturing-home-desktop-viewport.png'),captureBeyondViewport:false});
  await page.setViewport({width:390,height:844});
  await page.click('[data-manufacturing-group="operations"]');
  await page.waitForSelector('[data-manufacturing-section="warping"]');
  assert.equal(await page.$$eval('[data-manufacturing-section]',els=>els.length),3);
  await page.click('[data-manufacturing-section="warping"]');await page.waitForNetworkIdle();assert.deepEqual(failed,[]);
  await page.evaluate(()=>{const nav=document.querySelector('nav[aria-label="أقسام التصنيع"]');(nav?.querySelector('button') as HTMLButtonElement)?.click();});
  await page.waitForSelector('[data-manufacturing-group="external"]');await page.click('[data-manufacturing-group="external"]');await page.waitForSelector('[data-manufacturing-section="external"]');await page.click('[data-manufacturing-section="external"]');
  await page.waitForSelector(`[data-external-job="${jobId}"]`);await page.click(`[data-external-job="${jobId}"]`);
  await page.waitForSelector('[data-external-lifecycle]');assert.deepEqual(failed,[]);
  await page.click('[data-external-tab="receive"]');
  await page.select(`select[aria-label="${label('warehouse')}"]`,warehouseId);
  await page.type(`input[aria-label="${label('dyePaper')}"]`,'DYE-UI-1');
  await page.select(`select[aria-label="${label('sentRoll')}"]`,lineId);
  await page.type(`input[aria-label="${label('actualMeters')}"]`,'35');
  await page.click(`input[aria-label="${label('defectiveCheck')}"]`);
  await page.type(`input[placeholder="${label('responsible')}"]`,'Dye house');
  await page.evaluate((text)=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text);if(!button||button.disabled)throw new Error('Receipt action missing or disabled');button.click();},label('confirmReceipt'));
  await page.waitForFunction(()=>document.querySelector('[data-external-tab="overview"]')?.getAttribute('aria-current')==='page');
  await page.waitForFunction(()=>document.querySelector('[data-external-lifecycle]')?.textContent?.includes('DYE-UI-1'));
  assert.equal(received,1);assert.deepEqual(failed,[]);
  await page.click('[data-external-tab="quality"]');
  assert.ok(await page.evaluate(()=>Boolean(document.querySelector('[data-external-lifecycle] button'))));
  await page.click('[data-external-tab="pricing"]');await page.click('[data-external-tab="settlements"]');await page.click('[data-external-tab="quality"]');
  const popupPromise=new Promise<import('puppeteer-core').Page>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Batch print window missing')),10000);page.once('popup',p=>{if(p){clearTimeout(timer);resolve(p);}});});
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='طباعة استلام هذه الدفعة');if(!b)throw new Error('Batch print action missing');b.click();});
  const popup=await popupPromise;await popup.waitForFunction(()=>document.body.innerText.includes('DYE-UI-1'));await popup.close();
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  await page.screenshot({path:path.join(root,'..','clotex-external-quality-mobile.png'),fullPage:true});
  await page.goto('http://127.0.0.1:51787/manufacturing-navigation-check.tmp.html',{waitUntil:'networkidle0'});
  await page.click('[data-manufacturing-group="costs"]');
  await page.waitForSelector('[data-manufacturing-section="reports"]');
  await page.click('[data-manufacturing-section="reports"]');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='عرض التقرير'));
  await page.evaluate(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='عرض التقرير');button?.click();});
  await page.waitForSelector('table tbody tr');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Operational report table must scroll inside its panel');
  await page.screenshot({path:path.join(root,'..','clotex-manufacturing-report-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  console.log('Manufacturing hierarchy + actual external-job receipt UI + quality/pricing/settlement navigation + batch printing passed on real PostgreSQL');
 }catch(e){console.error('Browser JS failures:',errors,'API failures:',failed);if(browser){const pages=await browser.pages();console.error('Browser page:',await pages[pages.length-1]?.evaluate(()=>document.body.innerText.slice(0,3000)));}throw e;}finally{await browser?.close();if(server){await server.waitForRequestsIdle();await server.close();await server.watcher.close();}await unlink(fixture).catch(()=>undefined);}
}
