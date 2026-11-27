import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

const keysOf = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
};

test('purchase receiving: invoice-first/partial/over receipts, kg weight entry, pending receipt link, no finance data for warehouse, no duplicate accounting', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'rcv_' + randomUUID().replaceAll('-', '');
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

    const a = randomUUID(), b = randomUUID(), acc = randomUUID(), wk = randomUUID(), viewer = randomUUID(), sup = randomUUID(), wh = randomUUID(), wh2 = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع أ',true),($2,'B','فرع ب',true)", [a, b]);
    const mk = (id: string, name: string, role: string) => q("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,$3,'x',$4,true)", [id, a, name, role]);
    const mgr = randomUUID();
    await mk(acc, 'acc', 'accountant'); await mk(wk, 'wk', 'inventory'); await mk(viewer, 'viewer', 'viewer'); await mk(mgr, 'mgr', 'manager');
    await q("INSERT INTO suppliers(id,company_id,code,name) VALUES ($1,$2,'S1','مورد الأقمشة')", [sup, a]);
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$3,'W1','الرئيسي'),($2,$3,'W2','مستودع ثان')", [wh, wh2, a]);
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    for (const c of [a, b]) await setCompanyActivationStatus(fakeClient as never, c, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const tok = (id: string, name: string, role: string, perms: string[]) => signAuthToken({ sub: id, companyId: a, username: name, role, permissions: perms });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'GET' | 'POST', path: string, token: string, payload?: unknown) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
    const tMgr = tok(mgr, 'mgr', 'manager', []);
    const tWk = tok(wk, 'wk', 'inventory', ['inventory.view', 'inventory.manage']), tViewer = tok(viewer, 'viewer', 'viewer', []);
    const today = new Date().toISOString().slice(0, 10);

    // ── المحاسب يسجّل الفاتورة (استلام عبر المخزن): مالية فقط، بلا أتواب ولا دفعات ──
    const { createPurchaseInvoice } = await import('../services/purchaseInvoiceService.js');
    const line = (description: string, quantity: number, unit: string, unitPrice: number, materialKind: string, metadata: Record<string, unknown> = {}) =>
      ({ description, quantity, unit, unitPrice, lineDiscount: 0, lineTax: 0, lineTotal: quantity * unitPrice, materialKind, metadata });
    const inv = await createPurchaseInvoice(fakeClient as never, a, acc, {
      invoiceNo: 'x', supplierInvoiceNo: 'SUP-77', invoiceDate: today, supplierId: sup, warehouseId: wh, currencyCode: 'USD', convertToUsd: true, receiveViaWarehouse: true,
      subtotal: 1900, discountTotal: 0, taxTotal: 0, totalAmount: 1900, paidAmount: 0, remainingAmount: 1900, confirm: true,
      lines: [
        line('كتان أبيض', 100, 'meter', 2, 'FABRIC', { materialName: 'كتان', designCode: 'K1', colorName: 'أبيض', colorCode: 'W1', widthCm: 150, gsm: 150 }),
        line('قطن كحلي بالكيلو', 50, 'kg', 10, 'FABRIC', { materialName: 'قطن', designCode: 'C1', colorName: 'كحلي', colorCode: 'N1', widthCm: 150, gsm: 150 }),
        line('غزل 30', 200, 'kg', 5, 'YARN', { materialName: 'غزل 30', designCode: 'Y30' }),
        line('كراتين تغليف', 10, 'package', 20, 'OTHER'),
      ],
    } as never);
    assert.equal((await q('SELECT count(*)::int AS n FROM fabric_rolls WHERE company_id=$1', [a]))[0].n, 0, 'التأكيد لا يُنشئ أتواباً');
    assert.equal((await q('SELECT count(*)::int AS n FROM yarn_lots WHERE company_id=$1', [a]))[0].n, 0, 'ولا دفعات خيط');
    const journals = (await q('SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1', [a]))[0].n as number;
    assert.ok(journals >= 1, 'القيد المالي سُجِّل مرة واحدة مع الفاتورة');

    // ── المخزن يرى الفاتورة بلا أي بيانات مالية (على الخادم) ──
    assert.equal((await call('GET', '/api/purchase-receiving/invoices', tViewer)).statusCode, 403);
    // المحاسب (وضع الدور) يعاين الاستلامات دون صلاحيات مخزون صريحة، ولا يسجّل استلاماً
    const tAcc = tok(acc, 'acc', 'accountant', []);
    assert.equal((await call('GET', '/api/purchase-receiving/invoices', tAcc)).statusCode, 200, 'المحاسب يعاين');
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tAcc, { warehouseId: wh, lines: [] })).statusCode, 403, 'المحاسب لا يسجّل استلاماً');
    const list = await call('GET', '/api/purchase-receiving/invoices?search=SUP-77', tWk);
    assert.equal(list.statusCode, 200);
    const invoices = list.json().data as Array<{ id: string; supplierInvoiceNo: string; overall: string; lines: Array<{ id: string; lineNo: number; status: string; remaining: number; quantity: number; unit: string }> }>;
    assert.equal(invoices.length, 1); assert.equal(invoices[0].overall, 'NOT_RECEIVED');
    const forbidden = keysOf(list.json()).filter((k) => /price|cost|total|discount|tax|paid|amount|payment|balance|rate/i.test(k));
    assert.deepEqual(forbidden, [], 'لا حقول مالية في استجابة المخزن');
    assert.ok(!/"unit_cost"|"unitPrice"|"line_total"/.test(list.body));
    const detail = await call('GET', `/api/purchase-receiving/invoices/${inv.id}`, tWk);
    assert.deepEqual(keysOf(detail.json()).filter((k) => /price|cost|total|discount|tax|paid|amount|payment|balance|rate/i.test(k)), []);
    const L = invoices[0].lines; const [lFab, lKg, lYarn, lPack] = L;

    // ── استلام جزئي للقماش بالمتر ثم زيادة (فرق للمراجعة بلا تغيير الفاتورة) ──
    const r1 = await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv.id, warehouseId: wh, lines: [{ invoiceLineId: lFab.id, unit: 'meter', rolls: [{ lengthM: 60, barcode: 'RC-A' }, { lengthM: 30 }] }] });
    assert.equal(r1.statusCode, 201, r1.body);
    let d = (await call('GET', `/api/purchase-receiving/invoices/${inv.id}`, tWk)).json().data.invoice.lines as typeof L;
    assert.deepEqual([d[0].status, d[0].remaining], ['PARTIAL', 10]);
    const rolls = await q("SELECT barcode, length_m::float AS len, unit_cost::float AS cost, purchase_invoice_no FROM fabric_rolls WHERE company_id=$1 ORDER BY barcode", [a]);
    assert.equal(rolls.length, 2); assert.equal(rolls.find((r) => r.barcode === 'RC-A')!.cost, 2, 'تكلفة التوب من بند الفاتورة (داخلياً)');
    const overBody = { invoiceId: inv.id, warehouseId: wh, lines: [{ invoiceLineId: lFab.id, unit: 'meter', rolls: [{ lengthM: 20 }] }] };
    // تجاوز المتبقي (10م) مرفوض لموظف المخزن، ومسموح للمدير بتأكيد صريح فقط
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tWk, { ...overBody, allowOver: true })).statusCode, 400, 'موظف المخزن لا يتجاوز المتبقي');
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tMgr, overBody)).statusCode, 400, 'المدير بلا تأكيد صريح لا يتجاوز');
    const r2 = await call('POST', '/api/purchase-receiving/receipts', tMgr, { ...overBody, allowOver: true });
    assert.equal(r2.statusCode, 201, r2.body);
    d = (await call('GET', `/api/purchase-receiving/invoices/${inv.id}`, tWk)).json().data.invoice.lines;
    assert.deepEqual([d[0].status, d[0].diff], ['OVER', 10], 'الزيادة تظهر للمراجعة');
    assert.equal((await q('SELECT total_amount::float AS t FROM purchase_invoices WHERE id=$1', [inv.id]))[0].t, 1900, 'قيمة الفاتورة لا تتغير تلقائياً');
    assert.equal((await q('SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1', [a]))[0].n, journals, 'الاستلام لا يُنشئ قيداً مالياً');

    // ── الاستلام بالكيلو: الطول من الوزن والعرض والـ gsm، والتكلفة بالمتر من سعر الكيلو ──
    const r3 = await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv.id, warehouseId: wh, lines: [{ invoiceLineId: lKg.id, unit: 'kg', rolls: [{ weightKg: 25, barcode: 'RC-KG' }] }] });
    assert.equal(r3.statusCode, 201, r3.body);
    const kgRoll = (await q("SELECT length_m::float AS len, actual_weight_kg::float AS kg, unit_cost::float AS cost FROM fabric_rolls WHERE barcode='RC-KG'"))[0];
    assert.equal(kgRoll.len, 25, 'كمية التوب بالكيلو نفسه (لا اشتقاق متر)'); assert.equal(kgRoll.kg, 25); assert.equal(kgRoll.cost, 10, 'التكلفة للكيلو = سعر بند الفاتورة');
    d = (await call('GET', `/api/purchase-receiving/invoices/${inv.id}`, tWk)).json().data.invoice.lines;
    assert.deepEqual([d[1].status, d[1].received, d[1].remaining], ['PARTIAL', 25, 25]);
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv.id, warehouseId: wh, lines: [{ invoiceLineId: lKg.id, unit: 'kg', rolls: [{ lengthM: 50 }] }] })).statusCode, 400, 'بند بالكيلو يتطلب وزن كل توب');

    // ── الخيط: دفعات بأوزان فعلية ──
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv.id, warehouseId: wh, lines: [{ invoiceLineId: lYarn.id, unit: 'kg', lots: [{ weightKg: 120, lotNo: 'L1' }, { weightKg: 80, lotNo: 'L2' }] }] })).statusCode, 201);
    d = (await call('GET', `/api/purchase-receiving/invoices/${inv.id}`, tWk)).json().data.invoice.lines;
    assert.equal(d[2].status, 'COMPLETE');
    assert.equal((await q('SELECT count(*)::int AS n FROM yarn_lots WHERE company_id=$1', [a]))[0].n, 2);

    // ── مواد أخرى بالطرد: كمية فقط، وفرق الوحدة يتطلب معامل تحويل ──
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv.id, warehouseId: wh, lines: [{ invoiceLineId: lPack.id, unit: 'piece', quantity: 40 }] })).statusCode, 400, 'قطعة مقابل طرد بلا معامل');
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv.id, warehouseId: wh, lines: [{ invoiceLineId: lPack.id, unit: 'piece', quantity: 40, conversionFactor: 0.1 }] })).statusCode, 201, 'معامل 0.1 طرد لكل قطعة');
    d = (await call('GET', `/api/purchase-receiving/invoices/${inv.id}`, tWk)).json().data.invoice.lines;
    assert.deepEqual([d[3].status, d[3].received], ['PARTIAL', 4]);

    // ── استلام معلّق قبل الفاتورة ثم الربط (بلا قيد ولا قيمة افتراضية) ──
    const pend = await call('POST', '/api/purchase-receiving/receipts', tWk, { supplierId: sup, warehouseId: wh2, lines: [{ unit: 'meter', materialKind: 'FABRIC', description: 'بضاعة وصلت قبل الفاتورة', rolls: [{ lengthM: 40, barcode: 'RC-PEND', materialName: 'بوبلين', designCode: 'P1' }] }] });
    assert.equal(pend.statusCode, 201); assert.equal(pend.json().data.status, 'PENDING_INVOICE');
    assert.equal((await q("SELECT unit_cost FROM fabric_rolls WHERE barcode='RC-PEND'"))[0].unit_cost, null, 'بلا تكلفة افتراضية');
    assert.equal((await call('GET', '/api/purchase-receiving/receipts?pending=1', tWk)).json().data.length, 1);
    const inv2 = await createPurchaseInvoice(fakeClient as never, a, acc, {
      invoiceNo: 'x', supplierInvoiceNo: 'SUP-78', invoiceDate: today, supplierId: sup, warehouseId: wh2, currencyCode: 'USD', convertToUsd: true, receiveViaWarehouse: true,
      subtotal: 120, discountTotal: 0, taxTotal: 0, totalAmount: 120, paidAmount: 0, remainingAmount: 120, confirm: true,
      lines: [line('بوبلين', 40, 'meter', 3, 'FABRIC', { materialName: 'بوبلين', designCode: 'P1' })],
    } as never);
    const [pinv] = (await call('GET', `/api/purchase-receiving/invoices?search=SUP-78`, tWk)).json().data as Array<{ lines: Array<{ id: string }> }>;
    const pr = (await call('GET', '/api/purchase-receiving/receipts?pending=1', tWk)).json().data[0] as { id: string; lines: Array<{ id: string }> };
    const jBefore = (await q('SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1', [a]))[0].n;
    assert.equal((await call('POST', `/api/purchase-receiving/receipts/${pr.id}/link`, tWk, { invoiceId: inv2.id, map: [{ receiptLineId: pr.lines[0].id, invoiceLineId: pinv.lines[0].id }] })).statusCode, 200);
    assert.equal((await q("SELECT unit_cost::float AS c, purchase_invoice_no FROM fabric_rolls WHERE barcode='RC-PEND'"))[0].c, 3, 'تكلفة التوب من الفاتورة بعد الربط');
    assert.equal((await q('SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1', [a]))[0].n, jBefore, 'الربط بلا قيد مالي');
    assert.equal(((await call('GET', `/api/purchase-receiving/invoices/${inv2.id}`, tWk)).json().data.invoice as { overall: string }).overall, 'COMPLETE');
    assert.equal((await call('POST', `/api/purchase-receiving/receipts/${pr.id}/link`, tWk, { invoiceId: inv2.id, map: [{ receiptLineId: pr.lines[0].id, invoiceLineId: pinv.lines[0].id }] })).statusCode, 400, 'لا ربط مرتين');

    // ── الفاتورة بالاستلام التلقائي (السلوك القديم): تُنشئ مخزونها عند التأكيد ولا استلام ثانٍ عليها ──
    const inv3 = await createPurchaseInvoice(fakeClient as never, a, acc, {
      invoiceNo: 'x', supplierInvoiceNo: 'SUP-79', invoiceDate: today, supplierId: sup, warehouseId: wh, currencyCode: 'USD', convertToUsd: true,
      subtotal: 20, discountTotal: 0, taxTotal: 0, totalAmount: 20, paidAmount: 0, remainingAmount: 20, confirm: true,
      lines: [line('قماش قديم', 10, 'meter', 2, 'FABRIC', { materialName: 'قديم', designCode: 'O1' })],
    } as never);
    assert.equal((await q("SELECT count(*)::int AS n FROM fabric_rolls WHERE purchase_invoice_no=(SELECT invoice_no FROM purchase_invoices WHERE id=$1)", [inv3.id]))[0].n, 1, 'السلوك القديم محفوظ');
    const [old] = (await call('GET', '/api/purchase-receiving/invoices?search=SUP-79', tWk)).json().data as Array<{ overall: string; lines: Array<{ id: string; autoReceived: boolean }> }>;
    assert.equal(old.overall, 'COMPLETE'); assert.equal(old.lines[0].autoReceived, true);
    assert.equal((await call('POST', '/api/purchase-receiving/receipts', tWk, { invoiceId: inv3.id, warehouseId: wh, lines: [{ invoiceLineId: old.lines[0].id, unit: 'meter', rolls: [{ lengthM: 10 }] }] })).statusCode, 400, 'لا استلام مكرر على التلقائي');

    // ── شراء قماش بالكيلو (استلام تلقائي): الطول من الوزن والعرض والـ gsm، وتكلفة المتر من سعر الكيلو ──
    const inv4 = await createPurchaseInvoice(fakeClient as never, a, acc, {
      invoiceNo: 'x', supplierInvoiceNo: 'SUP-80', invoiceDate: today, supplierId: sup, warehouseId: wh, currencyCode: 'USD', convertToUsd: true,
      subtotal: 90, discountTotal: 0, taxTotal: 0, totalAmount: 90, paidAmount: 0, remainingAmount: 90, confirm: true,
      lines: [line('قماش بالكيلو', 22.5, 'kg', 4, 'FABRIC', { materialName: 'مخمل', designCode: 'V1', widthCm: 150, gsm: 150 })],
    } as never);
    const kgAuto = (await q("SELECT length_m::float AS len, actual_weight_kg::float AS kg, unit_cost::float AS cost FROM fabric_rolls WHERE purchase_invoice_no=(SELECT invoice_no FROM purchase_invoices WHERE id=$1)", [inv4.id]))[0];
    assert.deepEqual([kgAuto.len, kgAuto.kg, Math.round(kgAuto.cost * 1000) / 1000], [22.5, 22.5, 4], 'قماش بالكيلو: الكمية 22.5 كغ وتكلفة 4 للكيلو');
    assert.equal((await q("SELECT count(*)::int AS n FROM yarn_lots WHERE purchase_invoice_id=$1", [inv4.id]))[0].n, 0, 'ليس خيطاً');

    // ── البحث والتصفية ──
    assert.equal(((await call('GET', '/api/purchase-receiving/invoices?status=COMPLETE', tWk)).json().data as unknown[]).length, 3);
    assert.equal(((await call('GET', '/api/purchase-receiving/invoices?materialKind=YARN', tWk)).json().data as unknown[]).length, 1);
    assert.equal(((await call('GET', '/api/purchase-receiving/receipts', tWk)).json().data as unknown[]).length >= 6, true);
    // تكرار الضغط على «حفظ» بنفس المعرّف لا يُدخل مخزوناً ثانياً
    const rid = randomUUID();
    const dupBody = { supplierId: sup, warehouseId: wh, clientRequestId: rid, lines: [{ materialKind: 'FABRIC', unit: 'meter', rolls: [{ lengthM: 5, barcode: 'DUP-1', materialName: 'مادة تجربة' }] }] };
    const d1 = await call('POST', '/api/purchase-receiving/receipts', tWk, dupBody);
    assert.equal(d1.statusCode, 201, d1.body);
    const d2 = await call('POST', '/api/purchase-receiving/receipts', tWk, dupBody);
    assert.equal(d2.statusCode, 200, d2.body);
    assert.equal(d2.json().data.id, d1.json().data.id); assert.equal(d2.json().data.duplicate, true);
    assert.equal((await q("SELECT count(*)::int AS n FROM fabric_rolls WHERE barcode='DUP-1'"))[0].n, 1, 'لا مخزون مكرر');
    assert.equal((await q("SELECT count(*)::int AS n FROM purchase_receipts WHERE client_request_id=$1", [rid]))[0].n, 1);
    await app.close();
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
