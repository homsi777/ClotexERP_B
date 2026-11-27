import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

/**
 * مؤشرات وتقارير المبالغ لا تجمع عملات مختلفة: بيانات تشمل EGP وUSD وTRY وSYP
 * ويجب أن يظهر كل مجموع بعملته (لا رقم مختلط ولا «USD» ثابتة).
 */
test('money totals are reported per currency, never mixed', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'ct_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    setPoolOverrideForTests({ connect: async () => ({ query: (s: string, p?: unknown[]) => db.query(s, p), release: () => undefined, on: () => undefined }), query: (s: string, p?: unknown[]) => db.query(s, p), on: () => undefined });
    const company = randomUUID();
    await db.query("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع',true)", [company]);

    const voucher = async (type: 'RECEIPT' | 'PAYMENT', cur: string, amount: number, status = 'CONFIRMED') => {
      await db.query(
        `INSERT INTO vouchers(id,company_id,voucher_no,voucher_type,voucher_date,amount,currency_code,status,party_type,party_name)
         VALUES ($1,$2,$3,$4,current_date,$5,$6,$7,'CUSTOMER','عميل')`,
        [randomUUID(), company, `V${randomUUID().slice(0, 8)}`, type, amount, cur, status],
      );
    };
    await voucher('RECEIPT', 'EGP', 1000); await voucher('RECEIPT', 'EGP', 250);
    await voucher('RECEIPT', 'USD', 500); await voucher('RECEIPT', 'TRY', 2000); await voucher('RECEIPT', 'SYP', 5000000);
    await voucher('PAYMENT', 'EGP', 300); await voucher('PAYMENT', 'USD', 100);
    await voucher('RECEIPT', 'EGP', 99999, 'DRAFT'); // مسودة: لا تُحتسب

    // 1) ملخص اللوحة
    const { fetchExtendedDashboardSummary } = await import('./reportService.js');
    const d = (await fetchExtendedDashboardSummary(company)) as Record<string, unknown>;
    assert.equal('receipt_total' in d, false, 'الإجمالي المختلط القديم لا يُرجع');
    assert.equal('payment_total' in d, false);
    const rec = Object.fromEntries((d.receipt_by_currency as { currency_code: string; total: string }[]).map((r) => [r.currency_code, Number(r.total)]));
    const pay = Object.fromEntries((d.payment_by_currency as { currency_code: string; total: string }[]).map((r) => [r.currency_code, Number(r.total)]));
    assert.deepEqual(rec, { EGP: 1250, SYP: 5000000, TRY: 2000, USD: 500 });
    assert.deepEqual(pay, { EGP: 300, USD: 100 });

    // 2) سجل السندات (تقرير) — مجاميع لكل عملة
    const { reportVouchers } = await import('./reportService.js');
    const rv = await reportVouchers(company, {});
    const t = rv.totals as Record<string, string>;
    assert.equal(t['إجمالي القبض المؤكد (EGP)'], '1250.00');
    assert.equal(t['الصافي المؤكد (EGP)'], '950.00');
    assert.equal(t['إجمالي القبض المؤكد (USD)'], '500.00');
    assert.equal(t['الصافي المؤكد (USD)'], '400.00');
    assert.equal(t['إجمالي القبض المؤكد (TRY)'], '2000.00');
    assert.equal(t['إجمالي الصرف المؤكد (TRY)'], '0.00');
    assert.equal(Object.keys(t).some((k) => !/\((EGP|USD|TRY|SYP)\)/.test(k)), false, 'كل مفتاح بعملته');

    // 3) الملخص التنفيذي: نص كل عملة
    const { reportExecutiveSummary, reportOperationalIncomeExpense } = await import('./reportServiceExtended.js');
    const ex = await reportExecutiveSummary(company);
    const card = (ex.summaryCards ?? []).find((c) => c.label === 'إجمالي قبض (مؤكد)');
    assert.ok(card && /EGP 1,250\.00/.test(String(card.value)) && /USD 500\.00/.test(String(card.value)) && /TRY 2,000\.00/.test(String(card.value)));

    // 4) قائمة الدخل/المصروف التشغيلية: صفوف لكل عملة
    const pl = await reportOperationalIncomeExpense(company);
    const customerRows = (pl.rows as { category: string; currency_code: string; income: string }[]).filter((r) => r.category === 'قبض عملاء (سندات)');
    assert.equal(customerRows.find((r) => r.currency_code === 'EGP')?.income, '1250.00');
    assert.equal(customerRows.find((r) => r.currency_code === 'USD')?.income, '500.00');
    assert.equal(customerRows.length, 4);

    // 5) ملخص المبيعات والرواتب لا يفشلان ويعرضان العملة
    const { reportSalesSummary } = await import('./reportServiceMore.js');
    const sa = await reportSalesSummary(company);
    const rowsKv = Object.fromEntries((sa.rows as { k: string; v: unknown }[]).map((r) => [r.k, String(r.v)]));
    assert.match(rowsKv['— إجمالي قبض عملاء (سندات)'], /EGP 1,250\.00/);
    assert.match(rowsKv['— إجمالي قبض عملاء (سندات)'], /SYP 5,000,000\.00/);
    const { reportPayrollSummary } = await import('./reportService.js');
    await reportPayrollSummary(company);

    // 5b) عبر مسارات HTTP الفعلية (التحقق من الصلاحيات والنموذج الذي تستهلكه الواجهة)
    const userId = randomUUID();
    await db.query("INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,'adm','x','admin',true)", [userId, company]);
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
    const { setCompanyActivationStatus } = await import('./activationService.js');
    await setCompanyActivationStatus(fakeClient as never, company, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const tok = signAuthToken({ sub: userId, companyId: company, username: 'adm', role: 'admin', permissions: [], isPlatformAdmin: false });
    const get = async (path: string) => (await app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${tok}` } })).json();
    const dash = (await get('/api/reports/dashboard-summary')).data;
    assert.equal('receipt_total' in dash, false);
    assert.deepEqual(dash.receipt_by_currency.map((r: { currency_code: string }) => r.currency_code), ['EGP', 'SYP', 'TRY', 'USD']);
    const vs = (await get('/api/reports/vouchers-summary')).data;
    assert.equal('confirmed_receipts' in vs, false);
    assert.deepEqual(Object.fromEntries(vs.receipts_by_currency.map((r: { currency_code: string; total: string }) => [r.currency_code, Number(r.total)])), { EGP: 1250, SYP: 5000000, TRY: 2000, USD: 500 });
    assert.deepEqual(Object.fromEntries(vs.payments_by_currency.map((r: { currency_code: string; total: string }) => [r.currency_code, Number(r.total)])), { EGP: 300, USD: 100 });
    if (process.env.CLOTEX_DUMP_DIR) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(`${process.env.CLOTEX_DUMP_DIR}/currency-dump.json`, JSON.stringify({ dash, vs }));
    }

    // 6) أدوات المساعد الذكي: استعلامات صحيحة وتُرجع مصفوفات حسب العملة
    const ai = await import('./ai/fabricAiTools.js');
    const sales = await ai.getSalesSummaryByDateRange(company, '2020-01-01', '2100-01-01');
    assert.ok(Array.isArray(sales.byCurrency) && !('totalSales' in sales));
    const top = await ai.getTopSellingFabrics(company, '2020-01-01', '2100-01-01');
    assert.ok(Array.isArray(top.fabrics));

    setPoolOverrideForTests(null);
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
});
