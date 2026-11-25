import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('management v2: analytics, preferences, optional location alert, owner-side alert actions, kg admin cost, profitability dimensions/returns/below-cost', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'mv2_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    let sp = 0;
    const fakeClient = {
      query: (sql: string, params?: unknown[]) => {
        const t = String(sql).trim().toUpperCase();
        if (t === 'BEGIN' || t.startsWith('BEGIN ')) return db.query(`SAVEPOINT sp${++sp}`);
        if (t === 'COMMIT') return db.query(`RELEASE SAVEPOINT sp${sp--}`);
        if (t === 'ROLLBACK') return db.query(`ROLLBACK TO SAVEPOINT sp${sp--}`);
        return db.query(sql, params);
      },
      release: () => undefined, on: () => undefined,
    };
    setPoolOverrideForTests({ connect: async () => fakeClient, query: (sql: string, params?: unknown[]) => db.query(sql, params), on: () => undefined });
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const a = randomUUID(), b = randomUUID(), owner = randomUUID(), mgrA = randomUUID(), mgrB = randomUUID(), acc = randomUUID(), custA = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع أ',true),($2,'B','فرع ب',true)", [a, b]);
    const mk = (id: string, co: string, name: string, role: string, plat = false) => q("INSERT INTO users(id,company_id,username,password_hash,role,is_active,is_platform_admin) VALUES ($1,$2,$3,'x',$4,true,$5)", [id, co, name, role, plat]);
    await mk(owner, a, 'owner', 'admin', true); await mk(mgrA, a, 'mgrA', 'admin'); await mk(mgrB, b, 'mgrB', 'admin'); await mk(acc, a, 'acc', 'accountant');
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C','عميل أ')", [custA, a]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    for (const c of [a, b]) await setCompanyActivationStatus(fakeClient as never, c, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const tok = (id: string, co: string, name: string, role: string, plat = false) => signAuthToken({ sub: id, companyId: co, username: name, role, permissions: [], isPlatformAdmin: plat });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string, payload?: unknown) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
    const tA = tok(mgrA, a, 'mgrA', 'admin'), tB = tok(mgrB, b, 'mgrB', 'admin'), tOwner = tok(owner, a, 'owner', 'admin', true), tAcc = tok(acc, a, 'acc', 'accountant');

    const tAccGranted = signAuthToken({ sub: acc, companyId: a, username: 'acc', role: 'accountant', permissions: ['management.view'] });
    const wh = randomUUID(), item = randomUUID(), color = randomUUID(), r1 = randomUUID(), r2 = randomUUID(), r3 = randomUUID();
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'W','المستودع الرئيسي')", [wh, a]);
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'I1','قماش')", [item, a]);
    await q("INSERT INTO fabric_colors(id,name_ar,color_code) VALUES ($1,'أزرق','V1')", [color]);
    // ثلاثة أتواب بلا موقع: متاح (50 كغ لكل 100 م)، محجوز، تالف — حالات طبيعية لا تنتج تنبيهاً
    await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,color_id,warehouse_id,length_m,actual_weight_kg,width_cm,gsm,status) VALUES ($1,$2,'R1',$3,$4,$5,100,50,100,500,'AVAILABLE'),($6,$2,'R2',$3,$4,$5,80,NULL,NULL,NULL,'RESERVED'),($7,$2,'R3',$3,$4,$5,60,NULL,NULL,NULL,'DAMAGED')", [r1, a, item, color, wh, r2, r3]);

    // ── أتواب بلا موقع: لا تنبيه افتراضياً؛ يُفعَّل لكل فرع صراحةً؛ المحجوز/المعزول ليسا مشكلة ──
    let alerts = (await call('GET', '/api/management/alerts', tA)).json().data.alerts as Array<{ type: string; department: string }>;
    assert.equal(alerts.filter((x) => x.type === 'NO_LOCATION').length, 0, 'بلا موقع ليس تنبيهاً افتراضياً');
    assert.equal((await call('PUT', '/api/management/alert-settings', tA, { enabledOptionalTypes: ['NO_LOCATION'] })).statusCode, 200);
    alerts = (await call('GET', '/api/management/alerts', tA)).json().data.alerts;
    const nl = alerts.find((x) => x.type === 'NO_LOCATION');
    assert.ok(nl, 'يظهر بعد التفعيل'); assert.equal(nl!.department, 'المخزون');
    assert.equal(alerts.length, 1, 'المحجوز والتالف لا ينتجان تنبيهات');
    assert.equal(((await call('GET', '/api/management/alerts', tB)).json().data.alerts as unknown[]).length, 0, 'تفعيل فرع لا يمسّ آخر');
    assert.equal((await call('PUT', '/api/management/alert-settings', tA, { enabledOptionalTypes: ['BOGUS'] })).statusCode, 400);

    // ── إجراءات التنبيه من لوحة المالك دون تبديل الفرع، مع تسجيل المنفِّذ ──
    const key = 'NO_LOCATION:branch';
    assert.equal((await call('POST', `/api/platform/alerts/action?branchId=${a}`, tA, { key, action: 'ack' })).statusCode, 403, 'مدير الفرع ليس مالكاً');
    assert.equal((await call('POST', `/api/platform/alerts/action?branchId=${a}`, tOwner, { key, action: 'assign', assigneeUserId: acc })).statusCode, 200);
    assert.equal((await call('POST', `/api/platform/alerts/action?branchId=${a}`, tOwner, { key, action: 'note', note: 'تابع' })).statusCode, 200);
    assert.equal((await call('POST', `/api/platform/alerts/action?branchId=${b}`, tOwner, { key, action: 'ack' })).statusCode, 404, 'التنبيه لا يعبر الفروع');
    assert.equal((await call('POST', '/api/platform/alerts/action?branchId=nope', tOwner, { key, action: 'ack' })).statusCode, 400);
    const after = (await call('GET', '/api/management/alerts', tA)).json().data.alerts as Array<{ assigneeName: string | null; updatedByName: string | null; note: string | null }>;
    assert.deepEqual([after[0].assigneeName, after[0].updatedByName, after[0].note], ['acc', 'owner', 'تابع']);
    assert.equal(((await call('GET', `/api/platform/branch-users?branchId=${a}`, tOwner)).json().data as unknown[]).length, 3);

    // ── التحليلات (الرسوم): بيانات فعلية، لكل عملة، وعزل الفروع ──
    const today = new Date().toISOString().slice(0, 10);
    await q("INSERT INTO sales_invoices(company_id,invoice_no,customer_id,invoice_date,document_status,currency_code,subtotal,total_amount,remaining_amount) VALUES ($1,'S1',$2,$3,'CONFIRMED','EGP',500,500,500),($1,'S2',$2,$3,'CONFIRMED','USD',70,70,70)", [a, custA, today]);
    const sup = randomUUID();
    await q("INSERT INTO suppliers(id,company_id,code,name) VALUES ($1,$2,'S','مورد')", [sup, a]);
    await q("INSERT INTO purchase_invoices(company_id,invoice_no,supplier_id,invoice_date,document_status,currency_code,subtotal,total_amount,remaining_amount) VALUES ($1,'P1',$3,$2,'CONFIRMED','EGP',200,200,200)", [a, today, sup]);
    const an = (await call('GET', '/api/management/analytics?period=month', tA)).json().data as { sales: Array<{ currency: string; total: number }>; purchases: Array<{ total: number }>; inventoryByStatus: Array<{ status: string; rolls: number; kg: number }>; inventoryByWarehouse: Array<{ warehouse: string; rolls: number }>; bucketUnit: string };
    assert.deepEqual(an.sales.map((s) => [s.currency, s.total]).sort(), [['EGP', 500], ['USD', 70]], 'عملات منفصلة لا تُجمع');
    assert.equal(an.purchases[0].total, 200); assert.equal(an.bucketUnit, 'day');
    assert.deepEqual(an.inventoryByStatus.map((s) => [s.status, s.rolls]), [['AVAILABLE', 1], ['DAMAGED', 1], ['RESERVED', 1]]);
    assert.equal(an.inventoryByStatus.find((s) => s.status === 'AVAILABLE')!.kg, 50);
    assert.equal(an.inventoryByWarehouse[0].warehouse, 'المستودع الرئيسي'); assert.equal(an.inventoryByWarehouse[0].rolls, 2);
    assert.equal(((await call('GET', '/api/management/analytics?period=month', tB)).json().data as { sales: unknown[] }).sales.length, 0, 'فرع آخر لا يرى مبيعات هذا الفرع');
    assert.equal((await call('GET', `/api/platform/analytics?branchId=${a}&period=year`, tOwner)).json().data.bucketUnit, 'month', 'السنة تجميع شهري');
    assert.equal((await call('GET', `/api/platform/analytics?branchId=${a}`, tA)).statusCode, 403);
    assert.equal((await call('GET', '/api/management/analytics?period=custom', tA)).statusCode, 400, 'مخصّص بلا تواريخ');

    // ── تخصيص اللوحة لكل مستخدم (عرض فقط) ──
    assert.equal((await call('GET', '/api/management/preferences', tA)).json().data, null);
    assert.equal((await call('PUT', '/api/management/preferences', tA, { hidden: ['inventory.slow'], order: ['sales', 'cash'], defaultTab: 'alerts', defaultPeriod: 'week' })).statusCode, 200);
    assert.equal((await call('PUT', '/api/management/preferences', tA, { hidden: [], isAdmin: true })).statusCode, 400, 'لا حقول غريبة (لا تعديل صلاحيات)');
    assert.deepEqual((await call('GET', '/api/management/preferences', tA)).json().data.hidden, ['inventory.slow']);
    assert.equal((await call('GET', '/api/management/preferences', tAccGranted)).json().data, null, 'تخصيص كل مستخدم منفصل');
    assert.equal((await call('DELETE', '/api/management/preferences', tA)).statusCode, 200);
    assert.equal((await call('GET', '/api/management/preferences', tA)).json().data, null, 'استعادة الافتراضي');
    assert.equal((await call('PUT', '/api/platform/preferences', tOwner, { hidden: ['x'], defaultTab: 'cost' })).statusCode, 200);
    assert.equal((await call('GET', '/api/platform/preferences', tA)).statusCode, 403);

    // ── التكلفة الإدارية: كيلو/متر، الأولوية، المرتجعات، تحت التكلفة، غير المسعّر ونسبته ──
    for (const [tk, label] of [[tAcc, 'محاسب'], [tA, 'مدير فرع']] as const) {
      assert.equal((await call('GET', `/api/platform/admin-cost/rolls?branchId=${a}&itemId=${item}`, tk)).statusCode, 403, label);
      assert.equal((await call('GET', `/api/platform/admin-cost/history?branchId=${a}&itemId=${item}`, tk)).statusCode, 403, label);
    }
    const r4 = randomUUID(), r5 = randomUUID();
    await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,color_id,warehouse_id,length_m,status) VALUES ($1,$2,'R4',$3,$4,$5,40,'AVAILABLE'),($6,$2,'R5',$3,$4,$5,40,'AVAILABLE')", [r4, a, item, color, wh, r5]);
    // سعر الخامة بالكيلو (2/كغ) وسعر التوب R5 بالمتر (0.5): الأولوية للتوب
    assert.equal((await call('PUT', `/api/platform/admin-cost/rates?branchId=${a}`, tOwner, { rates: [{ scope: 'ITEM', itemId: item, unitCostPerMeter: 2, basis: 'KG', currency: 'EGP' }, { scope: 'ROLL', rollId: r5, unitCostPerMeter: 0.5, basis: 'METER', currency: 'EGP' }] })).statusCode, 200);
    const rolls = (await call('GET', `/api/platform/admin-cost/rolls?branchId=${a}&itemId=${item}`, tOwner)).json().data as Array<{ barcode: string; rate: { scope: string; basis: string } | null }>;
    assert.deepEqual(rolls.map((r) => [r.barcode, r.rate?.scope, r.rate?.basis]), [['R1', 'ITEM', 'KG'], ['R2', 'ITEM', 'KG'], ['R4', 'ITEM', 'KG'], ['R5', 'ROLL', 'METER']]);
    assert.equal(((await call('GET', `/api/platform/admin-cost/rolls?branchId=${a}&itemId=${item}&onlyMissing=true`, tOwner)).json().data as unknown[]).length, 0);
    const hist = (await call('GET', `/api/platform/admin-cost/history?branchId=${a}&itemId=${item}`, tOwner)).json().data as Array<{ by: string }>;
    assert.equal(hist.length, 1); assert.equal(hist[0].by, 'owner');

    const { createSalesInvoice, confirmSalesInvoice } = await import('../services/salesInvoiceService.js');
    const sale = (roll: string, qty: number, unitPrice: number) => createSalesInvoice(fakeClient as never, a, owner, {
      invoiceNo: 'x', invoiceDate: today, customerId: custA, currencyCode: 'EGP', convertToUsd: false,
      subtotal: qty * unitPrice, discountTotal: 0, taxTotal: 0, totalAmount: qty * unitPrice, paidAmount: 0, remainingAmount: qty * unitPrice, confirm: false,
      lines: [{ fabricRollId: roll, fabricItemId: item, description: 'قماش', quantity: qty, unit: 'meter', unitPrice, lineDiscount: 0, lineTax: 0, lineTotal: qty * unitPrice }],
    });
    // R1: 10 م × 0.5 كغ/م = 5 كغ × 2 = 10 تكلفة؛ بيع 3/م = 30
    const s1 = await sale(r1, 10, 3); await confirmSalesInvoice(fakeClient as never, a, owner, s1.id);
    const sn1 = (await q('SELECT unit_basis, basis_quantity::float AS bq, total_cost::float AS t FROM sales_line_admin_cost WHERE invoice_id=$1', [s1.id]))[0];
    assert.deepEqual([sn1.unit_basis, sn1.bq, sn1.t], ['KG', 5, 10], 'تحويل المتر للكيلو عبر العرض × gsm (0.5 كغ/م) لا عبر طول الثوب المتناقص');
    // R5 (سعر توب بالمتر 0.5): 20 م → 10؛ بيع 0.4/م = 8 → تحت التكلفة (خسارة 2)
    const s2 = await sale(r5, 20, 0.4); await confirmSalesInvoice(fakeClient as never, a, owner, s2.id);
    assert.equal((await q('SELECT total_cost::float AS t FROM sales_line_admin_cost WHERE invoice_id=$1', [s2.id]))[0].t, 10, 'الأولوية لتكلفة التوب على الخامة');
    // R4: بلا عرض/gsm وسعر الخامة بالكيلو → غير مسعّر (لا تكلفة مختلقة)
    const s3 = await sale(r4, 10, 1); await confirmSalesInvoice(fakeClient as never, a, owner, s3.id);
    assert.equal((await q('SELECT 1 FROM sales_line_admin_cost WHERE invoice_id=$1', [s3.id])).length, 0);

    // مرتجع معتمد لنصف بيع R1 (5 م بإيراد 15) يُخصم بإيراده وبنصف تكلفته (5)
    await q("INSERT INTO return_invoices(id,company_id,return_no,return_type,customer_id,return_date,currency_code,status) VALUES (gen_random_uuid(),$1,'RT1','SALES_RETURN',$2,$3,'EGP','CONFIRMED')", [a, custA, today]);
    await q("INSERT INTO return_invoice_lines(company_id,return_invoice_id,fabric_roll_id,fabric_item_id,description,quantity,unit,unit_price,line_total) SELECT $1, id, $2, $3, 'مرتجع', 5, 'meter', 3, 15 FROM return_invoices WHERE return_no='RT1' AND company_id=$1", [a, r1, item]);

    const p = (await call('GET', `/api/platform/admin-cost/profitability?branchId=${a}&period=month&by=roll`, tOwner)).json().data as {
      byCurrency: Array<{ currency: string; revenue: number; cost: number; profit: number }>; belowCost: Array<{ currency: string; lines: number; loss: number }>;
      unpriced: Array<{ lines: number; revenue: number; totalRevenue: number; sharePct: number }>; returns: { counted: Array<{ revenue: number; cost: number }> }; breakdown: Array<{ label: string }>; notes: string[];
    };
    const eg = p.byCurrency.find((x) => x.currency === 'EGP')!;
    assert.deepEqual([eg.revenue, eg.cost, eg.profit], [30 + 8 - 15, 10 + 10 - 5, 8], 'صافي بعد المرتجع');
    assert.deepEqual(p.belowCost, [{ currency: 'EGP', lines: 1, loss: 2 }]);
    assert.equal(p.unpriced[0].revenue, 10); assert.equal(p.unpriced[0].totalRevenue, 48);
    assert.equal(Math.round(p.unpriced[0].sharePct * 10) / 10, 20.8, 'نسبة غير المسعّر من إجمالي المبيعات');
    assert.deepEqual(p.returns.counted.map((r) => [r.revenue, r.cost]), [[15, 5]]);
    assert.deepEqual(p.breakdown.map((r) => r.label).sort(), ['R1', 'R5']);
    assert.ok(p.notes[0].includes('تقديرية'), 'توضيح أنها ليست صافي الربح المحاسبي');
    for (const by of ['item', 'color', 'customer', 'invoice', 'creator']) assert.equal((await call('GET', `/api/platform/admin-cost/profitability?branchId=${a}&period=month&by=${by}`, tOwner)).statusCode, 200, by);

    // ── لوحة إدارة الفرع صلاحية يمنحها المالك: المحاسب بلا منح مرفوض، وبمنح management.view مقبول ──
    assert.equal((await call('GET', '/api/management/overview?period=month', tAcc)).statusCode, 403, 'الدور وحده لا يكفي');
    assert.equal((await call('GET', '/api/management/overview?period=month', tAccGranted)).statusCode, 200, 'بعد منح الصلاحية');
    assert.equal((await call('GET', '/api/management/alerts', tAcc)).statusCode, 403);
    // ── المبيعات بالمتر في التقرير: المتر والياردة محوّلة والكيلو منفصل ──
    const ov = (await call('GET', '/api/management/overview?period=month', tA)).json().data.branches[0].metrics.sales.quantity as { current: { meters: number; kg: number; invoices: number } };
    assert.deepEqual([ov.current.meters, ov.current.kg, ov.current.invoices], [40, 0, 3], '10 + 20 + 10 متراً في 3 فواتير معتمدة');
    await app.close();
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
