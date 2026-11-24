import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('party balances equal the statement for every party/currency; cheques, aging, limits, follow-up and isolation', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const stm = await import('./partyStatementService.js');
  try {
    await db.query('BEGIN');
    const schema = 'bal_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    stm.__setStatementDbForTests(db as never);
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
    const { getPartyBalances, savePartyProfile, addPartyNote, listPartyNotes } = await import('./partyBalancesService.js');
    const { ensureCompanyGlCoa } = await import('./glCoaService.js');

    const c1 = randomUUID(), c2 = randomUUID(), user = randomUUID(), cust = randomUUID(), cust2 = randomUUID(), sup = randomUUID(), other = randomUUID(), box = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'A','a'),($2,'B','b')", [c1, c2]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$2,'u','x','admin')", [user, c1]);
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$3,'C1','عميل ١'),($2,$3,'C2','عميل ٢'),($4,$5,'X','عميل فرع آخر')", [cust, cust2, c1, other, c2]);
    await q("INSERT INTO suppliers(id,company_id,code,name) VALUES ($1,$2,'S1','مورد')", [sup, c1]);
    await q("INSERT INTO cashboxes(id,company_id,code,name,currency_code) VALUES ($1,$2,'B','ص','EGP')", [box, c1]);

    const invoice = (party: string, no: string, date: string, ccy: string, total: number, remaining: number) => q(
      `INSERT INTO sales_invoices(company_id,invoice_no,customer_id,invoice_date,document_status,currency_code,subtotal,total_amount,remaining_amount)
       VALUES ($1,$2,$3,$4,'CONFIRMED',$5,$6,$6,$7)`, [c1, no, party, date, ccy, total, remaining]);
    const today = new Date();
    const ago = (days: number) => new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
    await invoice(cust, 'S1', ago(10), 'EGP', 1000, 600);   // مدفوع منها 400 بسند مرتبط
    await invoice(cust, 'S2', ago(45), 'EGP', 500, 500);
    await invoice(cust, 'S3', ago(120), 'EGP', 300, 300);
    await invoice(cust, 'S4', ago(5), 'USD', 50, 50);
    await invoice(cust2, 'S5', ago(2), 'EGP', 100, 0);       // عميل آخر مسدد بالكامل بسند
    await q(`INSERT INTO purchase_invoices(company_id,invoice_no,supplier_id,invoice_date,document_status,currency_code,subtotal,total_amount,remaining_amount)
             VALUES ($1,'P1',$2,$3,'CONFIRMED','EGP',800,800,500)`, [c1, sup, ago(20)]);

    async function voucher(no: string, type: 'RECEIPT' | 'PAYMENT', partyType: 'CUSTOMER' | 'SUPPLIER', party: string, amount: number, date: string, checkAmount = 0, checkStatus?: string) {
      const v = randomUUID();
      await q(`INSERT INTO vouchers(id,company_id,voucher_no,voucher_type,voucher_date,party_type,party_id,party_name,amount,currency_code,status,amount_usd,exchange_rate_to_usd)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'x',$8,'EGP','CONFIRMED',$8,1)`, [v, c1, no, type, date, partyType, party, amount]);
      if (amount - checkAmount > 0) await q(`INSERT INTO voucher_lines(company_id,voucher_id,cashbox_id,payment_method,amount,currency_code) VALUES ($1,$2,$3,'CASH',$4,'EGP')`, [c1, v, box, amount - checkAmount]);
      if (checkAmount > 0) {
        const chk = randomUUID();
        await q(`INSERT INTO checks(id,company_id,check_no,bank_name,amount,currency_code,due_date,status) VALUES ($1,$2,$3,'بنك',$4,'EGP',current_date + 30,$5)`, [chk, c1, 'CH' + no, checkAmount, checkStatus]);
        await q(`INSERT INTO voucher_lines(company_id,voucher_id,cashbox_id,payment_method,amount,currency_code,check_id) VALUES ($1,$2,$3,'CHECK',$4,'EGP',$5)`, [c1, v, box, checkAmount, chk]);
        if (checkStatus === 'CLEARED') await q(`INSERT INTO check_status_history(check_id,from_status,to_status) VALUES ($1,'DEPOSITED','CLEARED')`, [chk]);
      }
    }
    await voucher('R1', 'RECEIPT', 'CUSTOMER', cust, 400, ago(8));                 // نقد مرتبط بالفاتورة S1
    await voucher('R2', 'RECEIPT', 'CUSTOMER', cust, 300, ago(7), 300, 'RECEIVED');   // شيك معلّق
    await voucher('R3', 'RECEIPT', 'CUSTOMER', cust, 100, ago(6), 100, 'CLEARED');    // شيك محصّل
    await voucher('R4', 'RECEIPT', 'CUSTOMER', cust, 50, ago(6), 50, 'RETURNED');     // شيك مرتد
    await voucher('R5', 'RECEIPT', 'CUSTOMER', cust2, 100, ago(1));
    await voucher('PV1', 'PAYMENT', 'CUSTOMER', cust, 20, ago(4));                   // رد للعميل
    await voucher('PV2', 'PAYMENT', 'SUPPLIER', sup, 300, ago(3));
    await voucher('RS1', 'RECEIPT', 'SUPPLIER', sup, 20, ago(2));
    await q(`INSERT INTO return_invoices(company_id,return_no,return_type,customer_id,return_date,currency_code,subtotal,total_amount,status)
             VALUES ($1,'RT1','SALES_RETURN',$2,$3,'EGP',70,70,'CONFIRMED')`, [c1, cust, ago(3)]);
    await q(`INSERT INTO return_invoices(company_id,return_no,return_type,supplier_id,return_date,currency_code,subtotal,total_amount,status)
             VALUES ($1,'RT2','PURCHASE_RETURN',$2,$3,'EGP',100,100,'CONFIRMED')`, [c1, sup, ago(3)]);
    await q(`INSERT INTO customer_discounts(company_id,discount_no,discount_date,customer_id,amount,currency_code,exchange_rate_to_usd,amount_usd,status)
             VALUES ($1,'D1',$2,$3,30,'EGP',1,30,'CONFIRMED')`, [c1, ago(2), cust]);
    await ensureCompanyGlCoa(db as never, c1);
    const acct = (await q('SELECT id FROM gl_accounts WHERE company_id=$1 LIMIT 1', [c1]))[0].id;
    const je = randomUUID();
    await q(`INSERT INTO journal_entries(id,company_id,entry_no,entry_date,source_type,status) VALUES ($1,$2,'JE1',$3,'OPENING','POSTED')`, [je, c1, ago(200)]);
    await q(`INSERT INTO journal_lines(company_id,entry_id,line_no,gl_account_id,party_type,party_id,debit,credit,currency_code) VALUES ($1,$2,1,$3,'CUSTOMER',$4,200,0,'EGP')`, [c1, je, acct, cust]);

    // ───── المطابقة مع كشف الحساب (لكل عميل ولكل عملة) ─────
    const res = await getPartyBalances(db, c1, 'CUSTOMER', {});
    for (const id of [cust, cust2]) {
      const stmt = await stm.getCustomerStatementByCurrency(c1, id, {});
      const row = res.rows.find((r) => r.id === id)!;
      for (const s of stmt.byCurrency) {
        const mine = row.currencies.find((c) => c.currency === s.currency)!;
        assert.equal(Math.round(mine.balance * 100) / 100, Math.round(s.totals.closingBalance * 100) / 100, `${id} ${s.currency}`);
        assert.equal(Math.round(mine.expectedBalance * 100) / 100, Math.round((s.totals.expectedBalance ?? s.totals.closingBalance) * 100) / 100, `expected ${id} ${s.currency}`);
        assert.equal(Math.round(mine.pendingCheques * 100) / 100, Math.round((s.totals.pendingChecksTotal ?? 0) * 100) / 100, `pending ${id} ${s.currency}`);
      }
      assert.equal(row.currencies.length, stmt.byCurrency.length, 'نفس العملات');
    }
    const A = res.rows.find((r) => r.id === cust)!;
    const egp = A.currencies.find((c) => c.currency === 'EGP')!;
    // 1000+500+300+200(افتتاحي) − (400+100) نقد/محصّل − 70 مرتجع − 30 حسم + 20 رد = 1420 ... الشيك المعلّق والمرتد لا يُخصمان
    assert.equal(egp.balance, 1000 + 500 + 300 + 200 - 400 - 100 - 70 - 30 + 20);
    assert.equal(egp.pendingCheques, 300);
    assert.equal(egp.expectedBalance, egp.balance - 300);
    assert.equal(egp.side, 'OWES_US');
    assert.equal(A.currencies.find((c) => c.currency === 'USD')!.balance, 50, 'العملات منفصلة');
    assert.equal(egp.sales12m, 1000 + 500 + 300);
    // التقادم: المتبقي الفعلي لكل فاتورة بحسب عمرها، و«غير مخصص» يفسّر الباقي
    assert.deepEqual([egp.aging.d0_30, egp.aging.d31_60, egp.aging.d61_90, egp.aging.d90plus], [600, 500, 0, 300]);
    assert.equal(egp.aging.unallocated, egp.balance - 1400);
    assert.equal(egp.openInvoices, 3);
    assert.equal(egp.lastPaymentDate, ago(0), 'آخر دفعة: التحصيل الفعلي الأحدث (تاريخ تحصيل الشيك لا تاريخ السند)');
    assert.equal(res.dueDatesAvailable, false);

    // الإجماليات منفصلة لكل عملة (العميل الثاني مسدد بالكامل = صفر)
    const t = res.totals.find((x) => x.currency === 'EGP')!;
    assert.equal(t.owedToUs, egp.balance);
    assert.equal(t.weOwe, 0);

    // لا اختلاط بين الفروع
    assert.ok(!res.rows.some((r) => r.id === other));
    assert.equal((await getPartyBalances(db, c2, 'CUSTOMER', {})).rows.length, 1);

    // الموردون: نفس المبدأ (الرصيد = دائن − مدين)
    const sres = await getPartyBalances(db, c1, 'SUPPLIER', {});
    const sstmt = await stm.getSupplierStatementByCurrency(c1, sup, {});
    const srow = sres.rows.find((r) => r.id === sup)!.currencies.find((c) => c.currency === 'EGP')!;
    assert.equal(srow.balance, sstmt.byCurrency.find((x) => x.currency === 'EGP')!.totals.closingBalance);
    assert.equal(srow.balance, 800 - 300 - 100 + 20);
    assert.equal(srow.side, 'WE_OWE');
    assert.equal(srow.aging.d0_30, 500);

    // حد الائتمان + موعد التحصيل + الملاحظات (ملف المتابعة)
    await savePartyProfile(db, c1, user, 'CUSTOMER', cust, { ownerUserId: user, creditLimit: 1000, creditLimitCurrency: 'EGP', expectedCollectionDate: ago(2), promisedAmount: 500, promisedCurrency: 'EGP' });
    const after = (await getPartyBalances(db, c1, 'CUSTOMER', {})).rows.find((r) => r.id === cust)!;
    assert.equal(after.alerts.limitExceeded, true);
    assert.equal(after.alerts.promiseOverdue, true, 'تجاوز موعد التحصيل مع رصيد قائم');
    assert.equal(after.profile!.ownerName, 'u');
    assert.equal((await getPartyBalances(db, c1, 'CUSTOMER', { onlyAlerts: true })).rows.length, 1);
    await assert.rejects(() => savePartyProfile(db, c1, user, 'CUSTOMER', cust, { creditLimit: 100 }), /حد الائتمان/);
    await assert.rejects(() => savePartyProfile(db, c1, user, 'CUSTOMER', other, {}), /غير موجود/, 'لا حفظ لطرف فرع آخر');
    await addPartyNote(db, c1, user, 'CUSTOMER', cust, 'وعد بالدفع الأسبوع القادم');
    assert.equal((await listPartyNotes(db, c1, 'CUSTOMER', cust))[0].note, 'وعد بالدفع الأسبوع القادم');

    // التصفية والفرز
    assert.deepEqual((await getPartyBalances(db, c1, 'CUSTOMER', { search: 'C2' })).rows.map((r) => r.id), [cust2]);
    assert.deepEqual((await getPartyBalances(db, c1, 'CUSTOMER', { onlyWithBalance: true })).rows.map((r) => r.id), [cust]);
    assert.equal((await getPartyBalances(db, c1, 'CUSTOMER', { currency: 'USD' })).rows.length, 1);
  } finally {
    stm.__setStatementDbForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
