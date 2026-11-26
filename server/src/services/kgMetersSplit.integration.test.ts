import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

/** بيانات مختلطة (أقمشة بالمتر وأقمشة بالكيلو): كل كمية تظهر بوحدتها الصحيحة في التقارير ولوحة الإدارة، والمصنعية/الطلبات ترفض أتواب الوزن. */
test('meters and kg are separated in sales/customer reports, inventory reports and management metrics; meter-only flows reject weight rolls', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'kg_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const fake = { query: (s: string, p?: unknown[]) => db.query(s, p), release: () => undefined, on: () => undefined };
    setPoolOverrideForTests({ connect: async () => fake, query: (s: string, p?: unknown[]) => db.query(s, p), on: () => undefined });
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const co = randomUUID(), wh = randomUUID(), item = randomUUID(), cust = randomUUID(), sup = randomUUID();
    const rm = randomUUID(), rk = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع',true)", [co]);
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'W1','الرئيسي')", [wh, co]);
    await q("INSERT INTO fabric_items(id,company_id,name,internal_code,is_active) VALUES ($1,$2,'samre','K22',true)", [item, co]);
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C1','عميل')", [cust, co]);
    await q("INSERT INTO suppliers(id,company_id,code,name) VALUES ($1,$2,'S1','مورد')", [sup, co]);
    // توب بالمتر 80م وتوب بالوزن 1000كغ (الكمية = الكيلو)
    await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,warehouse_id,length_m,actual_weight_kg,unit_cost,status,entry_basis) VALUES ($1,$2,'M1',$3,$4,80,12,2,'AVAILABLE','LENGTH')", [rm, co, item, wh]);
    await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,warehouse_id,length_m,actual_weight_kg,unit_cost,status,entry_basis) VALUES ($1,$2,'K1',$3,$4,1000,1000,3,'AVAILABLE','WEIGHT')", [rk, co, item, wh]);
    // فاتورة بيع مؤكدة: سطر متر (80م×5) وسطر كيلو (1000كغ×4)
    const inv = randomUUID();
    await q(`INSERT INTO sales_invoices(id,company_id,invoice_no,customer_id,invoice_date,currency_code,subtotal,total_amount,paid_amount,remaining_amount,payment_status,document_status,exchange_rate_to_usd,subtotal_usd,total_amount_usd)
             VALUES ($1,$2,'SI-1',$3,current_date,'USD',4400,4400,0,4400,'unpaid','CONFIRMED',1,4400,4400)`, [inv, co, cust]);
    await q(`INSERT INTO sales_invoice_lines(company_id,invoice_id,line_no,fabric_roll_id,fabric_item_id,description,quantity,unit,unit_price,line_total,unit_price_usd,line_total_usd)
             VALUES ($1,$2,1,$3,$4,'متر',80,'meter',5,400,5,400),($1,$2,2,$5,$4,'كيلو',1000,'kg',4,4000,4,4000)`, [co, inv, rm, item, rk]);

    const more = await import('./reportServiceMore.js');
    // المبيعات حسب الصنف: أمتار 80 وكيلو 1000 منفصلة
    const byItem = await more.reportSalesByItem(co, {});
    const row = byItem.rows[0] as Record<string, string>;
    assert.equal(Number(row.meters_sold), 80); assert.equal(Number(row.kg_sold), 1000);
    // تقرير عميل: صنف/لون
    const ic = await more.reportSalesByItemColorForCustomer(co, cust, '2000-01-01', '2100-01-01');
    assert.equal(ic.reduce((a, r) => a + Number(r.meters_sold), 0), 80); assert.equal(ic.reduce((a, r) => a + Number(r.kg_sold), 0), 1000);
    // تفاصيل الأرباح للعميل
    const pd = await more.reportProfitDetails(co, {});
    const tot = JSON.stringify(pd);
    assert.ok(tot.includes('sold_kg') && tot.includes('1000.00'), 'أرباح العملاء تعرض كيلو 1000');
    assert.ok(!/"sold_meters":"1080\.00"/.test(tot), 'لا تُضم الكيلوغرامات للأمتار');

    // المخزون: أمتار 80 فقط وكيلو 1000 منفصل
    const bal = await more.reportInventoryBalances(co);
    const brow = bal.rows[0] as Record<string, string>;
    assert.equal(Number(brow.total_m), 80); assert.equal(Number(brow.total_kg), 1000);

    // لوحة الإدارة
    const { getBranchMetrics } = await import('./managementMetricsService.js');
    const m = await getBranchMetrics({ query: (s: string, p?: unknown[]) => db.query(s, p) } as never, co, { kind: 'custom', from: '2000-01-01', to: '2100-01-01', prevFrom: '1990-01-01', prevTo: '1999-12-31', label: 't' });
    assert.deepEqual([m.inventory.available.meters, m.inventory.available.kg], [80, 1000]);
    assert.deepEqual([m.sales.quantity.current.meters, m.sales.quantity.current.kg], [80, 1000]);

    // المصنعية الخارجية ترفض توب الوزن
    const { createExternalJob } = await import('./externalJobService.js');
    await assert.rejects(() => createExternalJob(fake as never, co, null, { supplierId: sup, lines: [{ rollId: rk }] }), /بالوزن/);
    await q("UPDATE fabric_rolls SET status='AVAILABLE' WHERE id=$1", [rm]);
    const ok = await createExternalJob(fake as never, co, null, { supplierId: sup, lines: [{ rollId: rm }] });
    assert.ok(ok.id, 'توب المتر يُرسل كما كان');
    // حجز لطلب عميل مرفوض لتوب الوزن ومسموح لمسودة بيع
    const { reserveRoll } = await import('./rollReservationService.js');
    await assert.rejects(() => reserveRoll(fake as never, co, null, rk, { type: 'CUSTOMER_ORDER_LINE', id: randomUUID(), number: 'O1' }), /بالوزن/);
    await reserveRoll(fake as never, co, null, rk, { type: 'DRAFT_SALE', id: randomUUID(), number: 'D1' });
    assert.equal((await q('SELECT status FROM fabric_rolls WHERE id=$1', [rk]))[0].status, 'RESERVED');
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
