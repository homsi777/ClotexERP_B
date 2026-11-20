import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {FastifyInstance} from 'fastify';
export async function verifySizingCompletionUI(app:FastifyInstance,token:string,order:Record<string,unknown>){
  const {createServer}=await import('vite'),{default:puppeteer}=await import('puppeteer-core');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),fixture=path.join(root,'sizing-completion-check.tmp.html');
  let server:import('vite').ViteDevServer|undefined,browser:import('puppeteer-core').Browser|undefined;
  const errors:string[]=[],failures:string[]=[];
  try{
    await writeFile(fixture,`<!doctype html><html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from'react';import{createRoot}from'react-dom/client';import{SizingCompletionForm}from'/src/components/manufacturing/SizingCompletionForm.tsx';import'/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(SizingCompletionForm,{order:${JSON.stringify(order).replaceAll('<','\\u003c')},onSaved:async()=>{document.body.setAttribute('data-saved','true')},onCancel:()=>{}}));</script></body></html>`,'utf8');
    server=await createServer({root,server:{host:'127.0.0.1',port:51790,strictPort:true}});await server.listen();
    browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const page=await browser.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.evaluateOnNewDocument(auth=>{localStorage.setItem('fabric_erp_api_base_url','http://127.0.0.1:51790');localStorage.setItem('fabric_erp_api_token',auth);},token);
    await page.setRequestInterception(true);page.on('request',async req=>{
      const url=new URL(req.url());if(url.pathname.startsWith('/api/manufacturing/')){const response=await app.inject({method:'POST',url:url.pathname.replace('/api/manufacturing',''),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},payload:JSON.parse(req.postData()!)});if(response.statusCode>=400)failures.push(response.body);await req.respond({status:response.statusCode,contentType:'application/json',body:response.body});return;}
      if(url.hostname!=='127.0.0.1'||url.pathname==='/favicon.ico'){await req.respond({status:204});return;}await req.continue();
    });
    await page.setViewport({width:390,height:844});await page.goto('http://127.0.0.1:51790/sizing-completion-check.tmp.html',{waitUntil:'networkidle0'});
    assert.equal(await page.$eval('select',s=>(s as HTMLSelectElement).value),'','Quality must never default to accepted');
    await page.select('select[aria-label="نتيجة فحص التصميغ"]','CONDITIONAL');
    await page.type('textarea[aria-label="ملاحظات فحص التصميغ"]','Needs reprocessing');
    await page.click('button[type="submit"]');await page.waitForSelector('body[data-saved="true"]');
    assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'..','clotex-sizing-completion-mobile.png'),fullPage:true});
  }finally{await browser?.close();if(server){await server.waitForRequestsIdle();await server.close();await server.watcher.close();}await unlink(fixture).catch(()=>undefined);}
}
