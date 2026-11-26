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
    let sp = 0;
    const fake = {
      query: (sql: string, p?: unknown[]) => {
        const t = String(sql).trim().toUpperCase();
        if (t === 'BEGIN' || t.startsWith('BEGIN ')) return db.query(`SAVEPOINT sp${++sp}`);
        if (t === 'COMMIT') return db.query(`RELEASE SAVEPOINT sp${sp--}`);
        if (t === 'ROLLBACK') return db.query(`ROLLBACK TO SAVEPOINT sp${sp--}`);
        return db.query(sql, p);
      },
      release: () => undefined, on: () => undefined,
    };
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

    // ───── المرتجعات بالمتر والكيلو (بيع وشراء) عبر الواجهة البرمجية ─────
    const { setCompanyActivationStatus } = await import('./activationService.js');
    await setCompanyActivationStatus(fake as never, co, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const adm = randomUUID();
    await q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,'adm','x','admin',true)", [adm, co]);
    const { signAuthToken } = await import('../middleware/auth.js');
    const token = signAuthToken({ sub: adm, companyId: co, username: 'adm', role: 'admin', permissions: [] });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'POST' | 'PATCH' | 'GET', path: string, payload?: unknown) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
    // الأتواب بيعت (فرغت): توب المتر 0، توب الوزن 0
    await q("UPDATE fabric_rolls SET length_m=0, status='SOLD' WHERE id IN ($1,$2)", [rm, rk]);
    const lines = await q('SELECT id, fabric_roll_id, unit FROM sales_invoice_lines WHERE invoice_id=$1 ORDER BY line_no', [inv]);
    const mkReturn = async (srcLine: { id: string; fabric_roll_id: string; unit: string }, qty: number, price: number, unitSent: string) => {
      const r = await call('POST', '/api/returns', { returnType: 'SALES_RETURN', customerId: cust, originalSalesInvoiceId: inv, currencyCode: 'USD', exchangeRateToUsd: 1,
        lines: [{ description: 'مرتجع', quantity: qty, unitPrice: price, unit: unitSent, fabricRollId: srcLine.fabric_roll_id, originalSalesInvoiceLineId: srcLine.id }] });
      assert.equal(r.statusCode, 201, r.body);
      const rid = (r.json().data?.id ?? r.json().id) as string;
      const c = await call('PATCH', `/api/returns/${rid}/confirm`, {});
      assert.equal(c.statusCode, 200, c.body);
      return rid;
    };
    // مرتجع 30م من سطر المتر، و400كغ من سطر الكيلو (العميل/الواجهة يرسل 'meter' والخادم يسجّل الوحدة الصحيحة 'kg')
    await mkReturn(lines[0], 30, 5, 'meter');
    await mkReturn(lines[1], 400, 4, 'meter');
    const ru = await q("SELECT ril.unit, ril.quantity::float AS qty FROM return_invoice_lines ril ORDER BY ril.quantity");
    assert.deepEqual(ru.map((r) => [r.unit, r.qty]), [['meter', 30], ['kg', 400]], 'وحدة المرتجع تتبع وحدة سطر البيع');
    // المخزون: توب المتر 30م، توب الوزن 400 (كغ)، وكلاهما متاح
    const st = await q('SELECT barcode, length_m::float AS q, status FROM fabric_rolls ORDER BY barcode');
    assert.deepEqual(st.map((r) => [r.barcode, r.q, r.status]), [['K1', 400, 'AVAILABLE'], ['M1', 30, 'AVAILABLE']]);
    // التقارير: مبيعات حسب الصنف — مباع 80م/1000كغ، مرتجع 30م/400كغ، صافي 50م/600كغ
    const byItem2 = (await more.reportSalesByItem(co, {})).rows[0] as Record<string, string>;
    assert.deepEqual([byItem2.meters_sold, byItem2.kg_sold, byItem2.returned_quantity, byItem2.returned_kg, byItem2.net_quantity_after_returns, byItem2.net_kg_after_returns].map(Number), [80, 1000, 30, 400, 50, 600]);
    const ic2 = await more.reportSalesByItemColorForCustomer(co, cust, '2000-01-01', '2100-01-01');
    const sum = (k: 'returned_meters' | 'returned_kg' | 'net_meters_after_returns' | 'net_kg_after_returns') => ic2.reduce((a, r) => a + Number((r as unknown as Record<string, string>)[k] ?? 0), 0);
    assert.deepEqual([sum('returned_meters'), sum('returned_kg'), sum('net_meters_after_returns'), sum('net_kg_after_returns')], [30, 400, 50, 600]);
    const det = await more.reportSalesByItem(co, { fabricItemId: item });
    const dt = det.totals as Record<string, string>;
    assert.deepEqual([dt.returned_meters, dt.returned_kg, dt.net_meters, dt.net_kg].map(Number), [30, 400, 50, 600]);
    // القيود: قيدان للمرتجع متوازنان، وقيمة الذمة للعميل من المبلغ فقط (30×5 + 400×4) دون أثر لوحدة القياس
    const je = await q("SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1 AND source_type='RETURN_INVOICE'", [co]);
    assert.equal(je[0].n, 2);
    const gl = await q("SELECT COALESCE(SUM(debit),0)::float AS d, COALESCE(SUM(credit),0)::float AS c FROM journal_lines WHERE company_id=$1", [co]);
    assert.equal(gl[0].d, gl[0].c, 'القيود متوازنة');
    const custCredit = await q("SELECT COALESCE(SUM(credit),0)::float AS c FROM journal_lines WHERE company_id=$1 AND party_type='CUSTOMER' AND party_id=$2", [co, cust]);
    assert.equal(custCredit[0].c, 30 * 5 + 400 * 4, 'رصيد العميل يتأثر بقيمة المرتجع فقط');
    // رصيد العميل: يتأثر بقيمة المرتجع فقط (30×5 + 400×4)
    const retTotal = await q("SELECT COALESCE(SUM(total_amount),0)::float AS t FROM return_invoices WHERE company_id=$1 AND status='CONFIRMED'", [co]);
    assert.equal(retTotal[0].t, 30 * 5 + 400 * 4);

    // ───── الشراء بالمتر وبالكيلو ثم مرتجع الشراء بالوحدتين ─────
    const { createPurchaseInvoice } = await import('./purchaseInvoiceService.js');
    const pl = (desc: string, qty: number, unit: string, price: number, meta: Record<string, unknown>) => ({ description: desc, quantity: qty, unit, unitPrice: price, lineDiscount: 0, lineTotal: qty * price, materialKind: 'FABRIC', metadata: meta });
    const pinv = await createPurchaseInvoice(fake as never, co, adm, {
      invoiceNo: 'x', supplierInvoiceNo: 'P-1', invoiceDate: new Date().toISOString().slice(0, 10), supplierId: sup, warehouseId: wh, currencyCode: 'USD', convertToUsd: true,
      subtotal: 200 * 2 + 500 * 3, discountTotal: 0, taxTotal: 0, totalAmount: 1900, paidAmount: 0, remainingAmount: 1900, confirm: true,
      lines: [pl('قماش بالمتر', 200, 'meter', 2, { materialName: 'pm', designCode: 'PM1', colorName: 'أبيض', colorCode: 'W' }), pl('قماش بالكيلو', 500, 'kg', 3, { materialName: 'pk', designCode: 'PK1', colorName: 'أسود', colorCode: 'B' })],
    } as never);
    const prolls = await q("SELECT r.id, r.length_m::float AS q, r.entry_basis, r.unit_cost::float AS c, r.barcode FROM fabric_rolls r WHERE r.purchase_invoice_no=(SELECT invoice_no FROM purchase_invoices WHERE id=$1) ORDER BY r.entry_basis", [pinv.id]);
    assert.deepEqual(prolls.map((r) => [r.entry_basis, r.q, r.c]), [['LENGTH', 200, 2], ['WEIGHT', 500, 3]], 'شراء: 200م بتكلفة 2/م، و500كغ بتكلفة 3/كغ');
    const plines = await q('SELECT id, fabric_roll_id, unit FROM purchase_invoice_lines WHERE invoice_id=$1 ORDER BY line_no', [pinv.id]);
    const mkPReturn = async (srcLine: { id: string; fabric_roll_id: string }, qty: number, price: number) => {
      const r = await call('POST', '/api/returns', { returnType: 'PURCHASE_RETURN', supplierId: sup, originalPurchaseInvoiceId: pinv.id, currencyCode: 'USD', exchangeRateToUsd: 1,
        lines: [{ description: 'مرتجع شراء', quantity: qty, unitPrice: price, unit: 'meter', fabricRollId: srcLine.fabric_roll_id, originalPurchaseInvoiceLineId: srcLine.id }] });
      assert.equal(r.statusCode, 201, r.body);
      const c = await call('PATCH', `/api/returns/${(r.json().data?.id ?? r.json().id) as string}/confirm`, {});
      assert.equal(c.statusCode, 200, c.body);
    };
    await mkPReturn(plines[0], 20, 2);
    await mkPReturn(plines[1], 100, 3);
    const pu = await q("SELECT ril.unit, ril.quantity::float AS qty FROM return_invoice_lines ril JOIN return_invoices ri ON ri.id=ril.return_invoice_id WHERE ri.return_type='PURCHASE_RETURN' ORDER BY ril.quantity");
    assert.deepEqual(pu.map((r) => [r.unit, r.qty]), [['meter', 20], ['kg', 100]], 'مرتجع الشراء يسجّل وحدة سطر الشراء');
    const pst = await q("SELECT entry_basis, length_m::float AS q FROM fabric_rolls WHERE id = ANY($1::uuid[]) ORDER BY entry_basis", [prolls.map((r) => r.id)]);
    assert.deepEqual(pst.map((r) => [r.entry_basis, r.q]), [['LENGTH', 180], ['WEIGHT', 400]], 'المخزون: 180م و400كغ بعد مرتجع الشراء');
    // تقارير المشتريات: الأمتار تستثني الكيلو والكيلو منفصل
    const pbi = (await more.reportPurchasesByItem(co)).rows as Array<Record<string, string>>;
    const pmRow = pbi.find((r) => r.item_name === 'pm'), pkRow = pbi.find((r) => r.item_name === 'pk');
    assert.deepEqual([Number(pmRow?.total_m), Number(pmRow?.total_kg)], [180, 0], 'خامة بالمتر: 180م بلا كيلو');
    assert.deepEqual([Number(pkRow?.total_m), Number(pkRow?.total_kg)], [0, 400], 'خامة بالكيلو: 400كغ بلا أمتار');
    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
