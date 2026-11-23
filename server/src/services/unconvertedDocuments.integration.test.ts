import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('documents without exchange rate stay in their own currency end-to-end (ledger, statement, no USD)', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await db.connect();
  const stm = await import('./partyStatementService.js');
  try {
    await db.query('BEGIN');
    const schema = 'unc_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    stm.__setStatementDbForTests(db as never);
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
    const { createSalesInvoice, confirmSalesInvoice } = await import('./salesInvoiceService.js');
    const { createPurchaseInvoice, confirmPurchaseInvoice } = await import('./purchaseInvoiceService.js');
    const { insertDraftVoucher, applyVoucherConfirmation } = await import('./voucherCashboxService.js');

    const company = randomUUID(), user = randomUUID(), cust = randomUUID(), sup = randomUUID(), box = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'UNC','unc')", [company]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$2,'u','x','admin')", [user, company]);
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C1','عميل')", [cust, company]);
    await q("INSERT INTO suppliers(id,company_id,code,name) VALUES ($1,$2,'S1','مورد')", [sup, company]);
    await q("INSERT INTO cashboxes(id,company_id,code,name,currency_code) VALUES ($1,$2,'B1','صندوق جنيه','EGP')", [box, company]);

    const wh = randomUUID(), item = randomUUID(), roll = randomUUID();
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'W1','مخزن')", [wh, company]);
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'I1','قماش')", [item, company]);
    await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,warehouse_id,length_m,unit_cost,currency_code,status) VALUES ($1,$2,'R1',$3,$4,100,5,'USD','AVAILABLE')", [roll, company, item, wh]);
    const line = { fabricRollId: roll, fabricItemId: item, description: 'قماش', quantity: 10, unit: 'meter', unitPrice: 100, lineDiscount: 0, lineTax: 0, lineTotal: 1000 };
    const sale = await createSalesInvoice(client, company, user, {
      invoiceNo: 'x', invoiceDate: '2026-11-10', customerId: cust, currencyCode: 'EGP', convertToUsd: false,
      subtotal: 1000, discountTotal: 0, taxTotal: 0, totalAmount: 1000, paidAmount: 0, remainingAmount: 1000, lines: [line], confirm: false,
    });
    const row = (await q('SELECT usd_converted, total_amount, total_amount_usd, exchange_rate_to_usd FROM sales_invoices WHERE id=$1', [sale.id]))[0];
    assert.equal(row.usd_converted, false);
    assert.equal(Number(row.total_amount), 1000);
    assert.equal(Number(row.total_amount_usd), 0, 'لا معادل دولار');
    await confirmSalesInvoice(client, company, user, sale.id);

    const gl = await q(`SELECT jl.currency_code, SUM(jl.debit) d, SUM(jl.credit) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.source_type='SALES_INVOICE' AND je.source_id=$1 GROUP BY jl.currency_code`, [sale.id]);
    const byC = Object.fromEntries(gl.map((g) => [g.currency_code, g]));
    assert.equal(Number(byC.EGP.d), 1000, 'الذمم/الإيراد بالجنيه');
    assert.equal(Number(byC.EGP.c), 1000);
    // تكلفة المخزون (10 م × 5$) تبقى بعملة تقييم المخزون ومتوازنة بذاتها — لا معادل دولار للمبيعات
    assert.equal(Number(byC.USD.d), 50);
    assert.equal(Number(byC.USD.c), 50);
    assert.equal(gl.length, 2);

    // سند قبض بلا سعر صرف (جنيه) يُرحَّل بالجنيه
    const vd = await insertDraftVoucher(client, {
      companyId: company, userId: user, voucherType: 'RECEIPT', voucherDate: '2026-11-11', cashboxId: box,
      partyType: 'CUSTOMER', partyId: cust, partyName: 'عميل', amount: 400, currencyCode: 'EGP',
      exchangeRateToUsd: 1, amountUsd: 0, usdConverted: false, description: null, notes: null,
    });
    await applyVoucherConfirmation(client, {
      companyId: company, voucherId: vd.id, voucherNo: vd.voucherNo, voucherDate: '2026-11-11', voucherType: 'RECEIPT',
      amount: 400, currencyCode: 'EGP', exchangeRateToUsd: 1, amountUsd: 0, usdConverted: false, cashboxId: box,
      partyType: 'CUSTOMER', partyId: cust, partyName: 'عميل', description: null, userId: user,
    });
    await q("UPDATE vouchers SET status='CONFIRMED' WHERE id=$1", [vd.id]);
    const vgl = await q(`SELECT jl.currency_code, SUM(jl.debit) d, SUM(jl.credit) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.source_type='VOUCHER' AND je.source_id=$1 GROUP BY jl.currency_code`, [vd.id]);
    assert.equal(vgl.length, 1);
    assert.equal(vgl[0].currency_code, 'EGP');
    assert.equal(Number(vgl[0].d), 400);

    // فاتورة شراء بالجنيه بلا سعر صرف
    const pur = await createPurchaseInvoice(client, company, user, {
      invoiceNo: 'x', invoiceDate: '2026-11-12', supplierId: sup, currencyCode: 'EGP', convertToUsd: false,
      subtotal: 500, discountTotal: 0, taxTotal: 0, totalAmount: 500, paidAmount: 0, remainingAmount: 500,
      lines: [{ ...line, quantity: 5, unitPrice: 100, lineTotal: 500 }], confirm: false,
    } as never);
    await confirmPurchaseInvoice(client, company, user, pur.id);
    const pgl = await q(`SELECT jl.currency_code, SUM(jl.debit) d FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.source_type='PURCHASE_INVOICE' AND je.source_id=$1 GROUP BY jl.currency_code`, [pur.id]);
    assert.equal(pgl.length, 1);
    assert.equal(pgl[0].currency_code, 'EGP');
    assert.equal(Number(pgl[0].d), 500);

    // كشف العميل بالجنيه: 1000 - 400 = 600، ولا دولار
    const st = await stm.getCustomerStatement(company, cust, { currency: 'EGP' });
    assert.equal(st.totals.closingBalance, 600);
    const byCcy = await stm.getCustomerStatementByCurrency(company, cust, {});
    assert.deepEqual(byCcy.byCurrency.map((x) => x.currency), ['EGP']);

    // ───── المصاريف وحسم العملاء والمرتجع: نفس القاعدة (عملة المستند، بلا تحويل) ─────
    // المجمع يُلفّ بعميل المعاملة: BEGIN/COMMIT/ROLLBACK تصير نقاط حفظ ولا شيء يُثبَّت.
    let sp = 0;
    const fakeClient = {
      query: (sql: string, params?: unknown[]) => {
        const t = String(sql).trim().toUpperCase();
        if (t === 'BEGIN') return db.query(`SAVEPOINT sp${++sp}`);
        if (t === 'COMMIT') return db.query(`RELEASE SAVEPOINT sp${sp--}`);
        if (t === 'ROLLBACK') return db.query(`ROLLBACK TO SAVEPOINT sp${sp--}`);
        return db.query(sql, params);
      },
      release: () => undefined,
    };
    const fakePool = { connect: async () => fakeClient, query: (sql: string, params?: unknown[]) => db.query(sql, params) };
    const { setPoolOverrideForTests } = await import('../db/pool.js');
    setPoolOverrideForTests(fakePool);
    try {
      const { ensureCompanyOperatingExpenseCoa } = await import('./glCoaService.js');
      await ensureCompanyOperatingExpenseCoa(client, company);
      const cat = (await q('SELECT id FROM expense_categories WHERE company_id=$1 AND is_active LIMIT 1', [company]))[0];
      const { createOperatingExpense } = await import('./operatingExpenseService.js');
      const exp = await createOperatingExpense(company, user, {
        expenseDate: '2026-11-13', categoryId: cat.id, cashboxId: box, amount: 250, currencyCode: 'EGP',
        convertToUsd: false, description: 'إيجار',
      });
      assert.equal(Number(exp.amount_usd), 0, 'لا معادل دولار');
      const egl = await q(`SELECT jl.currency_code, SUM(jl.debit) d, SUM(jl.credit) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.source_type='OPERATING_EXPENSE' AND je.source_id=$1 GROUP BY 1`, [exp.id]);
      assert.deepEqual(egl.map((r) => [r.currency_code, Number(r.d), Number(r.c)]), [['EGP', 250, 250]]);

      const { createCustomerDiscount } = await import('./customerDiscountService.js');
      await assert.rejects(() => createCustomerDiscount(company, cust, user, { discountDate: '2026-11-14', amount: 700, currencyCode: 'EGP', convertToUsd: false }), /أكبر من رصيد العميل/);
      const disc = await createCustomerDiscount(company, cust, user, { discountDate: '2026-11-14', amount: 100, currencyCode: 'EGP', convertToUsd: false });
      assert.equal(Number(disc.amount_usd), 0);
      const dgl = await q(`SELECT jl.currency_code, SUM(jl.debit) d FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.source_type='CUSTOMER_DISCOUNT' AND je.source_id=$1 GROUP BY 1`, [disc.id]);
      assert.deepEqual(dgl.map((r) => [r.currency_code, Number(r.d)]), [['EGP', 100]]);
      const afterDisc = await stm.getCustomerStatement(company, cust, { currency: 'EGP' });
      assert.equal(afterDisc.totals.closingBalance, 500, '1000 - 400 - 100');

      // مرتجع غير مرتبط: يبقى بعملته؛ والمرتبط يرث قاعدة فاتورته
      const { validateAndBuildReturnDraft } = await import('./returnInvoiceDraftValidation.js');
      const { postReturnInvoiceToGl } = await import('./glPostingService.js');
      const v = await validateAndBuildReturnDraft(client, company, {
        returnType: 'SALES_RETURN', customerId: cust, currencyCode: 'EGP', convertToUsd: false, settlementType: 'CREDIT_BALANCE',
        discountTotal: 0, taxTotal: 0, lines: [{ description: 'مرتجع حر', quantity: 2, unitPrice: 50 }],
      } as never, { excludeReturnId: null });
      assert.equal(v.usdConverted, false);
      assert.equal(v.totalAmount, 100);
      const rid = randomUUID();
      await postReturnInvoiceToGl(client, {
        companyId: company, returnInvoiceId: rid, returnNo: 'RTN-T', returnDate: '2026-11-15', returnType: 'SALES_RETURN',
        totalAmountUsd: v.totalAmount, currencyCode: 'EGP', ledgerCurrency: 'EGP', customerId: cust, supplierId: null, userId: user, settlementType: 'CREDIT_BALANCE',
      });
      const rgl = await q(`SELECT jl.currency_code, SUM(jl.debit) d, SUM(jl.credit) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.source_type='RETURN_INVOICE' AND je.source_id=$1 GROUP BY 1`, [rid]);
      assert.deepEqual(rgl.map((r) => [r.currency_code, Number(r.d), Number(r.c)]), [['EGP', 100, 100]]);

      // دليل الحسابات: الدولار في عموده، وكل عملة أخرى لحالها (لا جمع)
      const { getGlChartOfAccounts } = await import('./glReportService.js');
      const chart = await getGlChartOfAccounts(company);
      const nonZero = chart.filter((a) => Math.abs(a.balance) > 0.004 || Object.values(a.byCurrency).some((v) => Math.abs(v) > 0.004));
      console.log('CHART', JSON.stringify(nonZero.map((a) => ({ code: a.code, name: a.name, usd: a.balance, other: a.byCurrency }))));
      const ar = chart.find((a) => a.isPosting && Math.abs(a.byCurrency.EGP ?? 0) > 0 && a.name.includes('ذمم') && a.type === 'asset');
      assert.ok(ar, 'حساب الذمم يحمل رصيداً بالجنيه');
      assert.equal(Math.round((ar!.byCurrency.EGP ?? 0) * 100) / 100, 400, 'الذمم: 1000 − 400 قبض − 100 حسم − 100 مرتجع');
      assert.equal(ar!.balance, 0, 'لا دولار في الذمم');
    } finally {
      setPoolOverrideForTests(null);
    }

    // الدفتر لا يجمع الجنيه مع الدولار
    const { getGlChartOfAccounts } = await import('./glReportService.js');
    void getGlChartOfAccounts;
    const usdOnly = await q(`SELECT COALESCE(SUM(debit),0) d FROM journal_lines WHERE currency_code='USD' AND company_id=$1`, [company]);
    assert.equal(Number(usdOnly[0].d), 50, 'الدولار الوحيد هو تكلفة المخزون');
  } finally {
    stm.__setStatementDbForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
