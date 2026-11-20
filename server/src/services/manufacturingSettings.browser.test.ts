import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {FastifyInstance} from 'fastify';

export async function verifyManufacturingSettingsUI(app:FastifyInstance,token:string,itemId:string,userId:string){
  const {createServer}=await import('vite'),{default:puppeteer}=await import('puppeteer-core');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),fixture=path.join(root,'manufacturing-settings-check.tmp.html');
  const html=`<!doctype html><html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from'react';import{createRoot}from'react-dom/client';import{YarnProfileLibrary}from'/src/components/inventory/YarnProfileLibrary.tsx';import{OrderNotificationRouting}from'/src/components/orders/OrderNotificationRouting.tsx';import'/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(YarnProfileLibrary,{items:[{id:${JSON.stringify(itemId)},name:'Cotton yarn'}]}),React.createElement(OrderNotificationRouting)));</script></body></html>`;
  let server:import('vite').ViteDevServer|undefined,browser:import('puppeteer-core').Browser|undefined;
  const failures:string[]=[],errors:string[]=[];
  try{
    await writeFile(fixture,html,'utf8');server=await createServer({root,server:{host:'127.0.0.1',port:51789,strictPort:true}});await server.listen();
    browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.evaluateOnNewDocument(auth=>{localStorage.setItem('fabric_erp_api_base_url','http://127.0.0.1:51789');localStorage.setItem('fabric_erp_api_token',auth);},token);
    await page.setRequestInterception(true);page.on('request',async request=>{
      const url=new URL(request.url());
      if(url.pathname.startsWith('/api/')){
        const route=url.pathname.replace('/api/inventory/yarn-lots','/yarn').replace('/api/auth','/auth').replace('/api/customer-orders','/customer-orders');
        try{const response=await app.inject({method:request.method() as 'GET'|'PUT',url:route+url.search,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(request.postData()?{payload:JSON.parse(request.postData()!)}:{})});
          if(response.statusCode>=400)failures.push(`${route}: ${response.body}`);
          await request.respond({status:response.statusCode,contentType:'application/json',body:response.body});
        }catch(e){failures.push(String(e));await request.respond({status:500,body:String(e)});}return;
      }
      if(url.hostname!=='127.0.0.1'||url.pathname==='/favicon.ico'){await request.respond({status:204});return;}await request.continue();
    });
    await page.setViewport({width:390,height:844});await page.goto('http://127.0.0.1:51789/manufacturing-settings-check.tmp.html',{waitUntil:'networkidle0'});
    await page.waitForSelector('summary');
    await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('select[aria-label="صنف تصنيف الخيط"] option')).length>1&&!document.querySelector<HTMLSelectElement>('select[aria-label="صنف تصنيف الخيط"]')?.disabled);
    await page.select('select[aria-label="صنف تصنيف الخيط"]',itemId);
    await page.type('input[aria-label="طريقة الغزل"]',' combed');
    await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.startsWith('حفظ إصدار التصنيف'));b?.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('حُفظ إصدار التصنيف'));
    await page.waitForFunction(()=>document.querySelectorAll('select[aria-label="مسؤول جاهز جزئياً"] option').length>1);
    await page.select('select[aria-label="مسؤول جاهز جزئياً"]',userId);await page.waitForNetworkIdle();
    assert.equal(await page.$eval('select[aria-label="مسؤول جاهز جزئياً"]',s=>(s as HTMLSelectElement).value),userId);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(root,'..','clotex-manufacturing-settings-mobile.png'),fullPage:true});
    console.log('Real browser saved a yarn profile revision and order notification phase routing at mobile width');
  }finally{await browser?.close();if(server){await server.waitForRequestsIdle();await server.close();await server.watcher.close();}await unlink(fixture).catch(()=>undefined);}
}
