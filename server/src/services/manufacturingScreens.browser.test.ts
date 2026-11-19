import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
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
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()==='قبول وفحص');if(!b)throw new Error('Missing quality action');b.click();});
  await page.waitForSelector('select[aria-label="المرحلة التالية للمطواة"]');
  await page.select('select[aria-label="المرحلة التالية للمطواة"]',nextStage);
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()==='حفظ نتيجة الفحص');if(!b)throw new Error('Missing save action');b.click();});
  await page.waitForFunction(()=>!document.querySelector('select[aria-label="المرحلة التالية للمطواة"]'));
  assert.equal(completionCount,1);assert.deepEqual(failedRequests,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(root,'..',`clotex-manufacturing-fixed-${nextStage.toLowerCase()}.png`),fullPage:true});
  console.log(`Real browser + Fastify + PostgreSQL passed: three operational tabs and ${nextStage} beam handoff`);
 }finally{await browser?.close();await server?.close();await unlink(fixture).catch(()=>undefined);}
}
