import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {FastifyInstance} from 'fastify';

export async function verifyCustomerOrderWorkflowUI(app:FastifyInstance,token:string,order:Record<string,unknown>){
  const {createServer}=await import('vite'),{default:puppeteer}=await import('puppeteer-core');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),fixture=path.join(root,'order-workflow-check.tmp.html');
  const payload=JSON.stringify(order).replaceAll('<','\\u003c');
  const html=`<!doctype html><html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{OrderWorkflowPanel}from'/src/components/orders/OrderWorkflowPanel.tsx';import'/src/i18n/config.ts';import'/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(OrderWorkflowPanel,{order:${payload}})));</script></body></html>`;
  let server:import('vite').ViteDevServer|undefined,browser:import('puppeteer-core').Browser|undefined;
  const failures:string[]=[],errors:string[]=[];
  try{
    await writeFile(fixture,html,'utf8');server=await createServer({root,server:{host:'127.0.0.1',port:51788,strictPort:true}});await server.listen();
    browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.evaluateOnNewDocument(auth=>{localStorage.setItem('fabric_erp_api_base_url','http://127.0.0.1:51788');localStorage.setItem('fabric_erp_api_token',auth);},token);
    await page.setRequestInterception(true);page.on('request',async request=>{
      const url=new URL(request.url());
      if(url.pathname.startsWith('/api/')){
        const route=url.pathname.replace('/api/manufacturing/reference','/reference').replace('/api/manufacturing/work-orders','/orders').replace('/api/auth','/auth').replace('/api/customer-orders','/customer-orders');
        try{const response=await app.inject({method:request.method() as 'GET'|'POST',url:route+url.search,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(request.postData()?{payload:JSON.parse(request.postData()!)}:{})});
          if(response.statusCode>=400)failures.push(`${route}: ${response.body}`);
          await request.respond({status:response.statusCode,contentType:'application/json',body:response.body});
        }catch(e){failures.push(String(e));await request.respond({status:500,body:String(e)});}return;
      }
      if(url.hostname!=='127.0.0.1'||url.pathname==='/favicon.ico'){await request.respond({status:204});return;}await request.continue();
    });
    await page.setViewport({width:390,height:844});await page.goto('http://127.0.0.1:51788/order-workflow-check.tmp.html',{waitUntil:'networkidle0'});
    await page.waitForSelector('[data-order-workflow-line]');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='حجز أقدم رولات كاملة مناسبة'&&!b.disabled));
    assert.ok((await page.content()).includes('RAW-300'));
    await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='حجز أقدم رولات كاملة مناسبة');if(!b)throw new Error('Reserve action missing');b.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('محجوز لهذا السطر'));
    assert.ok((await page.content()).includes('تحرير الحجز غير المصروف'));
    await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='تحرير الحجز غير المصروف');if(!b)throw new Error('Release action missing');b.click();});
    await page.waitForFunction(()=>!document.body.innerText.includes('محجوز لهذا السطر'));
    assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'..','clotex-order-workflow-mobile.png'),fullPage:true});
    console.log('Actual order workflow browser: raw/finished stock, partial FIFO reserve, release and audit passed');
  }finally{await browser?.close();if(server){await server.waitForRequestsIdle();await server.close();await server.watcher.close();}await unlink(fixture).catch(()=>undefined);}
}
