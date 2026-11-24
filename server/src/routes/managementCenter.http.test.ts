import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('management center: alerts lifecycle, decisions, liquidity, summary, oversight, secret admin cost (owner/delegate only)', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'mgc_' + randomUUID().replaceAll('-', '');
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

    const a = randomUUID(), b = randomUUID(), owner = randomUUID(), mgrA = randomUUID(), mgrB = randomUUID(), acc = randomUUID(), viewer = randomUUID(), custA = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع أ',true),($2,'B','فرع ب',true)", [a, b]);
    const mk = (id: string, co: string, name: string, role: string, plat = false) => q("INSERT INTO users(id,company_id,username,password_hash,role,is_active,is_platform_admin) VALUES ($1,$2,$3,'x',$4,true,$5)", [id, co, name, role, plat]);
    await mk(owner, a, 'owner', 'admin', true); await mk(mgrA, a, 'mgrA', 'admin'); await mk(mgrB, b, 'mgrB', 'admin'); await mk(acc, a, 'acc', 'accountant'); await mk(viewer, a, 'viewer', 'viewer');
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C','عميل أ')", [custA, a]);
    // مصادر التنبيه: شيك متأخر، مسودة قديمة، طلبية متأخرة
    const chk = randomUUID();
    await q("INSERT INTO checks(id,company_id,check_no,bank_name,party_type,party_name,amount,currency_code,due_date,status) VALUES ($1,$2,'777','بنك','CUSTOMER','عميل أ',400,'EGP',current_date - 5,'RECEIVED')", [chk, a]);
    await q("INSERT INTO sales_invoices(company_id,invoice_no,customer_id,invoice_date,document_status,currency_code,subtotal,total_amount,remaining_amount) VALUES ($1,'D1',$2,current_date - 10,'DRAFT','EGP',10,10,10)", [a, custA]);
    await q("INSERT INTO customer_orders(company_id,order_no,customer_id,order_date,status,expected_date) VALUES ($1,'O1',$2,current_date - 20,'pending_supply',current_date - 3)", [a, custA]);
    await q("INSERT INTO party_collection_profiles(company_id,party_type,party_id,expected_collection_date,promised_amount,promised_currency) VALUES ($1,'CUSTOMER',$2,current_date + 5,700,'EGP')", [a, custA]);
    await q("INSERT INTO cashboxes(company_id,code,name,currency_code,current_balance) VALUES ($1,'X','ص','EGP',250)", [a]);

    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    for (const c of [a, b]) await setCompanyActivationStatus(fakeClient as never, c, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const tok = (id: string, co: string, name: string, role: string, plat = false) => signAuthToken({ sub: id, companyId: co, username: name, role, permissions: [], isPlatformAdmin: plat });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
    const tA = tok(mgrA, a, 'mgrA', 'admin'), tB = tok(mgrB, b, 'mgrB', 'admin'), tOwner = tok(owner, a, 'owner', 'admin', true), tAcc = tok(acc, a, 'acc', 'accountant'), tViewer = tok(viewer, a, 'viewer', 'viewer');

    // ───── التنبيهات: التصنيف، عدم التكرار، العزل، الدورة ─────
    assert.equal((await call('GET', '/api/management/alerts', tViewer)).statusCode, 403);
    const r1 = (await call('GET', '/api/management/alerts', tA)).json().data.alerts as Array<{ key: string; type: string; severity: string; href: string; status: string }>;
    const types = r1.map((x) => x.type).sort();
    assert.deepEqual(types, ['CHEQUE_OVERDUE', 'DRAFT_STALE', 'ORDER_LATE']);
    assert.equal(r1.find((x) => x.type === 'CHEQUE_OVERDUE')!.severity, 'HIGH');
    assert.ok(r1.find((x) => x.type === 'CHEQUE_OVERDUE')!.href.includes('/treasury/checks-vault'));
    const r2 = (await call('GET', '/api/management/alerts', tA)).json().data.alerts as unknown[];
    assert.equal(r2.length, 3, 'لا تكرار عند إعادة الحساب');
    assert.equal(((await call('GET', '/api/management/alerts', tB)).json().data.alerts as unknown[]).length, 0, 'فرع آخر لا يرى تنبيهات هذا الفرع');

    const key = `CHEQUE_OVERDUE:${chk}`;
    assert.equal((await call('POST', '/api/management/alerts/action', tA, { key, action: 'assign', assigneeUserId: acc })).statusCode, 200);
    assert.equal((await call('POST', '/api/management/alerts/action', tA, { key, action: 'ack' })).statusCode, 200);
    assert.equal((await call('POST', '/api/management/alerts/action', tA, { key: `ORDER_LATE:${(await q("SELECT id FROM customer_orders WHERE company_id=$1", [a]))[0].id}`, action: 'snooze', until: '2000-01-01' })).statusCode, 400, 'تأجيل لتاريخ ماضٍ مرفوض');
    const ord = (r1.find((x) => x.type === 'ORDER_LATE')!).key;
    assert.equal((await call('POST', '/api/management/alerts/action', tA, { key: ord, action: 'snooze', until: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) })).statusCode, 200);
    const r3 = (await call('GET', '/api/management/alerts', tA)).json().data.alerts as Array<{ key: string; status: string; assigneeName: string | null }>;
    assert.equal(r3.find((x) => x.key === key)!.status, 'ACKNOWLEDGED');
    assert.equal(r3.find((x) => x.key === key)!.assigneeName, 'acc');
    assert.equal(r3.find((x) => x.key === ord)!.status, 'SNOOZED');
    // معالجة السبب (تحصيل الشيك) تُغلق التنبيه تلقائياً
    await q("UPDATE checks SET status='CLEARED' WHERE id=$1", [chk]);
    const r4 = (await call('GET', '/api/management/alerts?status=RESOLVED', tA)).json().data.alerts as Array<{ key: string; status: string }>;
    assert.equal(r4.find((x) => x.key === key)?.status, 'RESOLVED');
    assert.ok(!((await call('GET', '/api/management/alerts', tA)).json().data.alerts as Array<{ key: string }>).some((x) => x.key === key));
    // تخصيص الشروط لكل فرع: تعطيل نوع
    assert.equal((await call('PUT', '/api/management/alert-settings', tA, { disabledTypes: ['DRAFT_STALE'] })).statusCode, 200);
    assert.ok(!((await call('GET', '/api/management/alerts', tA)).json().data.alerts as Array<{ type: string }>).some((x) => x.type === 'DRAFT_STALE'));
    assert.equal((await call('PUT', '/api/management/alert-settings', tA, { draftAgeDays: 0 })).statusCode, 400);

    // ───── القرارات والسيولة والملخصات ─────
    const dec = (await call('GET', '/api/management/decisions', tA)).json().data as Array<{ kind: string }>;
    assert.ok(Array.isArray(dec));
    const liq = (await call('GET', '/api/management/liquidity', tA)).json().data as { horizons: Array<{ days: number; byCurrency: Array<{ currency: string; confirmedCash: number; forecastCollections: number; forecastTotal: number; confirmedTotal: number }> }> };
    assert.deepEqual(liq.horizons.map((h) => h.days), [7, 30, 60, 90]);
    const h30 = liq.horizons[1].byCurrency.find((x) => x.currency === 'EGP')!, h7 = liq.horizons[0].byCurrency.find((x) => x.currency === 'EGP')!;
    assert.equal(h30.confirmedCash, 250);
    assert.equal(h30.forecastCollections, 700, 'المبلغ الموعود (بعد 5 أيام) ضمن 30 يوماً');
    assert.equal(h7.forecastCollections, 700);
    assert.equal(h30.forecastTotal, h30.confirmedTotal + 700, 'التوقع منفصل عن المؤكد');
    const sum = (await call('GET', '/api/management/summary?kind=weekly', tA)).json().data as { text: string; alerts: { active: number } };
    assert.ok(sum.text.includes('ملخص أسبوعي'));

    // ───── الرقابة: فرعه فقط للمدير، وكل الفروع للمالك ─────
    const ovA = (await call('GET', '/api/management/oversight', tA)).json().data as { users: Array<{ branch: string }> };
    assert.ok(ovA.users.every((u) => u.branch === 'A'));
    const ovOwner = (await call('GET', '/api/platform/users', tOwner)).json().data as { users: Array<{ branch: string }> };
    assert.deepEqual([...new Set(ovOwner.users.map((u) => u.branch))].sort(), ['A', 'B']);
    assert.equal((await call('GET', '/api/platform/users', tA)).statusCode, 403, 'مدير الفرع ليس مالكاً');

    // ───── التكلفة الإدارية السرّية ─────
    const item = randomUUID(), color = randomUUID(), roll = randomUUID(), wh = randomUUID();
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'W','مخزن')", [wh, a]);
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'I1','قماش')", [item, a]);
    await q("INSERT INTO fabric_colors(id,name_ar,color_code) VALUES ($1,'أزرق','V1')", [color]);
    await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,color_id,warehouse_id,length_m,unit_cost,currency_code,status) VALUES ($1,$2,'R1',$3,$4,$5,100,5,'USD','AVAILABLE')", [roll, a, item, color, wh]);
    for (const [tk, label] of [[tAcc, 'محاسب'], [tA, 'مدير فرع'], [tViewer, 'مشاهد']] as const) {
      assert.equal((await call('GET', `/api/platform/admin-cost/groups?branchId=${a}`, tk)).statusCode, 403, `${label} لا يرى التكلفة الإدارية`);
      assert.equal((await call('PUT', `/api/platform/admin-cost/rates?branchId=${a}`, tk, { rates: [{ scope: 'ITEM', itemId: item, unitCostPerMeter: 1, currency: 'EGP' }] })).statusCode, 403);
    }
    const groups = (await call('GET', `/api/platform/admin-cost/groups?branchId=${a}`, tOwner)).json().data as Array<{ itemId: string; adminRate: unknown; rolls: number }>;
    assert.equal(groups.length, 1); assert.equal(groups[0].adminRate, null);
    assert.equal((await call('PUT', `/api/platform/admin-cost/rates?branchId=${a}`, tOwner, { rates: [{ scope: 'ITEM_COLOR', itemId: item, colorId: color, unitCostPerMeter: 0, currency: 'EGP' }] })).statusCode, 400, 'لا تكلفة صفرية');
    assert.equal((await call('PUT', `/api/platform/admin-cost/rates?branchId=${a}`, tOwner, { rates: [{ scope: 'ITEM_COLOR', itemId: item, colorId: color, unitCostPerMeter: 60, currency: 'EGP' }] })).statusCode, 200);

    // بيع يُعتمد: تُحفظ التكلفة السارية وقتها
    const { createSalesInvoice, confirmSalesInvoice } = await import('../services/salesInvoiceService.js');
    const sale = (no: string, qty: number) => createSalesInvoice(fakeClient as never, a, owner, {
      invoiceNo: 'x', invoiceDate: new Date().toISOString().slice(0, 10), customerId: custA, currencyCode: 'EGP', convertToUsd: false,
      subtotal: qty * 100, discountTotal: 0, taxTotal: 0, totalAmount: qty * 100, paidAmount: 0, remainingAmount: qty * 100, confirm: false,
      lines: [{ fabricRollId: roll, fabricItemId: item, description: 'قماش', quantity: qty, unit: 'meter', unitPrice: 100, lineDiscount: 0, lineTax: 0, lineTotal: qty * 100 }],
    });
    const s1 = await sale('1', 10); await confirmSalesInvoice(fakeClient as never, a, owner, s1.id);
    const snap = (await q('SELECT unit_cost_per_meter::float AS c, total_cost::float AS t, source FROM sales_line_admin_cost WHERE invoice_id=$1', [s1.id]))[0];
    assert.deepEqual([snap.c, snap.t, snap.source], [60, 600, 'ITEM_COLOR']);
    // تغيير التكلفة لاحقاً لا يغيّر أرباح المبيعات السابقة
    assert.equal((await call('PUT', `/api/platform/admin-cost/rates?branchId=${a}`, tOwner, { rates: [{ scope: 'ITEM_COLOR', itemId: item, colorId: color, unitCostPerMeter: 90, currency: 'EGP' }] })).statusCode, 200);
    assert.equal((await q('SELECT unit_cost_per_meter::float AS c FROM sales_line_admin_cost WHERE invoice_id=$1', [s1.id]))[0].c, 60);
    const s2 = await sale('2', 5); await confirmSalesInvoice(fakeClient as never, a, owner, s2.id);
    assert.equal((await q('SELECT unit_cost_per_meter::float AS c FROM sales_line_admin_cost WHERE invoice_id=$1', [s2.id]))[0].c, 90, 'البيع الجديد بالتكلفة الجديدة');
    const prof = (await call('GET', `/api/platform/admin-cost/profitability?branchId=${a}&period=month`, tOwner)).json().data as { byCurrency: Array<{ currency: string; revenue: number; cost: number; profit: number }>; unpriced: unknown[] };
    const e = prof.byCurrency.find((x) => x.currency === 'EGP')!;
    assert.deepEqual([e.revenue, e.cost, e.profit], [1500, 600 + 450, 450], 'ربح = صافي البيع − اللقطة وقت البيع');
    // لا تأثير على المحاسبة/المخزون الرسمي: unit_cost الثوب ثابت
    assert.equal((await q('SELECT unit_cost::float AS c FROM fabric_rolls WHERE id=$1', [roll]))[0].c, 5);
    // سطر بلا تكلفة إدارية = غير مسعّر (لا صفر)
    await q("DELETE FROM sales_line_admin_cost WHERE invoice_id=$1", [s2.id]);
    const prof2 = (await call('GET', `/api/platform/admin-cost/profitability?branchId=${a}&period=month`, tOwner)).json().data as { byCurrency: Array<{ currency: string; revenue: number }>; unpriced: Array<{ lines: number; revenue: number }> };
    assert.equal(prof2.byCurrency.find((x) => x.currency === 'EGP')!.revenue, 1000);
    assert.equal(prof2.unpriced[0].revenue, 500);

    // التفويض الصريح: المفوَّض يرى فرعه فقط ولا يفوّض غيره
    assert.equal((await call('PUT', `/api/platform/admin-cost/delegates?branchId=${a}`, tA, { userIds: [acc] })).statusCode, 403, 'مدير الفرع لا يفوّض');
    assert.equal((await call('PUT', `/api/platform/admin-cost/delegates?branchId=${a}`, tOwner, { userIds: [acc] })).statusCode, 200);
    assert.equal((await call('GET', `/api/platform/admin-cost/profitability?branchId=${a}&period=month`, tAcc)).statusCode, 200);
    assert.equal((await call('GET', `/api/platform/admin-cost/profitability?branchId=${b}&period=month`, tAcc)).statusCode, 403, 'المفوَّض لا يرى فرعاً آخر');
    assert.equal((await call('GET', `/api/platform/overview`, tAcc)).statusCode, 403, 'التفويض لا يمنح لوحة المالك');
    await app.close();
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
