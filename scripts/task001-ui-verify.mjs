import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const fixtures = JSON.parse(await fs.readFile('.local-test-results/task001-fixtures.json','utf8'));
assert.equal(fixtures.api,'http://127.0.0.1:14030');
const vite = await createServer({ configFile:false, envDir:false, plugins:[react(),tailwindcss()],
  cacheDir:'node_modules/.vite-task001', define:{ 'import.meta.env.VITE_API_BASE_URL':JSON.stringify(fixtures.api) },
  server:{host:'127.0.0.1',port:13030,strictPort:true}, clearScreen:false });
await vite.listen();
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-proxy-server']});
const pool = new pg.Pool({connectionString:'postgresql://task001@127.0.0.1:5432/clotex_transfer_test_task001'});
assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,'clotex_transfer_test_task001');
assert.equal(path.resolve((await pool.query("SELECT current_setting('data_directory') AS directory")).rows[0].directory).toLowerCase(),path.resolve('.local-test-tools/pgdata').toLowerCase());
const page = await browser.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const browserErrors=[];
page.on('pageerror', e=>browserErrors.push(e.message));
await page.setRequestInterception(true);
page.on('request', request=>{
  const url=new URL(request.url());
  if(['data:','blob:','about:'].includes(url.protocol) || (url.hostname==='127.0.0.1' && ['13030','14030'].includes(url.port))) request.continue();
  else request.abort();
});
await page.evaluateOnNewDocument((token,api)=>{
  localStorage.setItem('obada_erp_api_token',token);
  localStorage.setItem('obada_erp_api_base_url',api);
}, fixtures.token, fixtures.api);
const scope='section[aria-label="اختيار رولات المناقلة"]';
async function clickText(text) {
  const clicked=await page.evaluate((text)=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!b||b.disabled)return false;b.click();return true;},text);
  assert.ok(clicked,`Button unavailable: ${text}`);
}
async function selectFabric(id) { await page.select(`${scope} select`,id); }
async function clickGroupColor(text) {
  const ok=await page.evaluate((text)=>{const labels=[...document.querySelectorAll('section[aria-label="اختيار رولات المناقلة"] label')];const l=labels.find(l=>l.textContent.includes(text)&&l.querySelector('input[type=checkbox]'));if(!l)return false;l.querySelector('input').click();return true;},text);
  assert.ok(ok,'Color checkbox missing');
}
const selectedCount=()=>page.$$eval(`${scope} h4`,els=>els.reduce((n,h)=>n+h.parentElement.querySelectorAll('tbody tr').length,0));
const results=[];
try {
  await page.goto('http://127.0.0.1:13030/inventory/transfers',{waitUntil:'domcontentloaded'});
  for(const f of fixtures.ui) {
    await page.waitForSelector('fieldset select');
    const selects=await page.$$('fieldset select');
    await selects[0].select(f.warehouses[0]);
    await selects[2].select(f.warehouses[1]);
    await page.waitForFunction((selector)=>document.querySelectorAll(selector+' table:first-of-type tbody tr').length>=4,{},scope);
    // Wait for scope load and then constrain the source shelf explicitly.
    await page.waitForFunction(()=>[...document.querySelectorAll('fieldset select')[1].options].length>1);
    const current=await page.$$('fieldset select');await current[1].select(f.location);
    await page.waitForFunction((selector)=>{const c=document.querySelector(selector+' table tbody input');return c&&!c.disabled;},{},scope);
    let expected;
    if(f.label==='ui-single') {
      await clickText('رولة منفردة'); await page.click(`${scope} table tbody input`); expected=1;
    } else if(f.label==='ui-multiple') {
      await clickText('خامات متعددة');
      await clickGroupColor('Fabric A'); await clickGroupColor('Fabric B'); expected=4;
    } else if(f.label==='ui-entire') {
      await clickText('خامة بالكامل'); await selectFabric(f.items[0]);
      await clickText('تحديد جميع رولات الخامة (3)'); expected=3;
    } else {
      await clickText('حسب اللون'); await selectFabric(f.items[0]);
      await clickGroupColor('Red'); await clickGroupColor('Blue');
      assert.equal(await selectedCount(),3);
      // Individual exclusion remains possible after a bulk color selection.
      await page.evaluate((selector)=>document.querySelector(selector+' h4').parentElement.querySelector('tbody input').click(),scope);
      assert.equal(await selectedCount(),2);
      await selectFabric(f.items[1]); await clickGroupColor('Red'); expected=3;
    }
    assert.equal(await selectedCount(),expected);
    await clickText('حفظ جميع الاختيارات في مسودة مناقلة واحدة');
    await page.waitForFunction(()=>[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('حُفظت المسودة')));
    const docs=(await pool.query('SELECT id FROM inventory_transfers WHERE from_warehouse_id=$1 ORDER BY created_at DESC',[f.warehouses[0]])).rows;
    assert.equal(docs.length,1,'One UI submission must create exactly one document');
    const count=Number((await pool.query('SELECT count(*) FROM inventory_transfer_lines WHERE transfer_id=$1',[docs[0].id])).rows[0].count);
    assert.equal(count,expected);
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='مراجعة وتأكيد'&&!b.disabled));
    await page.evaluate(id=>{const row=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes(id));row?.querySelector('button')?.click();},(await pool.query('SELECT transfer_no FROM inventory_transfers WHERE id=$1',[docs[0].id])).rows[0].transfer_no);
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='تأكيد نقل جميع الرولات'&&!b.disabled));
    await clickText('تأكيد نقل جميع الرولات');
    await page.waitForFunction(()=>[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('تمت المناقلة بنجاح')));
    const rows=(await pool.query('SELECT fr.* FROM fabric_rolls fr JOIN inventory_transfer_lines l ON l.fabric_roll_id=fr.id WHERE l.transfer_id=$1',[docs[0].id])).rows;
    assert.equal(rows.length,expected);
    assert.ok(rows.every(r=>r.warehouse_id===f.warehouses[1]&&r.status==='AVAILABLE'&&Number(r.length_m)===12.345&&Number(r.unit_cost)===7));
    results.push({method:f.label,rolls:expected,result:'PASS'});
    console.log('UI PASS:',f.label,expected);
  }
  assert.deepEqual(browserErrors,[],'Browser must not have uncaught JavaScript errors');
  await page.screenshot({path:'.local-test-results/task001-ui.png',fullPage:true});
  await fs.writeFile('.local-test-results/task001-ui-results.json',JSON.stringify({results,browserErrors},null,2));
} catch(error) {
  await page.screenshot({path:'.local-test-results/task001-ui-failure.png',fullPage:true}).catch(()=>{});
  console.error('Browser errors:',browserErrors);
  throw error;
} finally { await browser.close(); await vite.close(); await pool.end(); }
