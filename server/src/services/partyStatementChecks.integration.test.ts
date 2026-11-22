import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('customer statement: cheque is deducted only after clearing; pending shown with expected balance; returned has no effect', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await db.connect();
  const svc = await import('./partyStatementService.js');
  try {
    await db.query('BEGIN');
    const schema = 'stm_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    svc.__setStatementDbForTests(db as never);
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const company = randomUUID(), cust = randomUUID(), box = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'STM','stm test')", [company]);
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C1','عميل')", [cust, company]);
    await q("INSERT INTO cashboxes(id,company_id,code,name,currency_code) VALUES ($1,$2,'B1','صندوق','USD')", [box, company]);
    // فاتورة بيع 1000 (عبر قيد افتتاحي بسيط غير متاح) — نستخدم سند دفع للعميل كمدين: لكن الأبسط قيد فاتورة مؤكدة
    await q(`INSERT INTO sales_invoices(id,company_id,invoice_no,customer_id,invoice_date,document_status,currency_code,total_amount,total_amount_usd,exchange_rate_to_usd)
             VALUES ($1,$2,'SI1',$3,'2026-11-01','CONFIRMED','USD',1000,1000,1)`, [randomUUID(), company, cust]).catch(async () => {
      // الأعمدة الإلزامية قد تختلف: نفشل الاختبار بوضوح بدل التخمين
      throw new Error('تعذّر إنشاء فاتورة اختبار — حدّث بذر الاختبار حسب أعمدة sales_invoices');
    });

    async function receipt(no: string, amount: number, checkAmount: number, status?: string) {
      const v = randomUUID();
      await q(`INSERT INTO vouchers(id,company_id,voucher_no,voucher_type,voucher_date,party_type,party_id,party_name,amount,currency_code,status,amount_usd,exchange_rate_to_usd)
               VALUES ($1,$2,$3,'RECEIPT','2026-11-05','CUSTOMER',$4,'عميل',$5,'USD','CONFIRMED',$5,1)`, [v, company, no, cust, amount]);
      if (amount - checkAmount > 0) {
        await q(`INSERT INTO voucher_lines(company_id,voucher_id,cashbox_id,payment_method,amount,currency_code) VALUES ($1,$2,$3,'CASH',$4,'USD')`, [company, v, box, amount - checkAmount]);
      }
      if (checkAmount > 0) {
        const chk = randomUUID(), line = randomUUID();
        await q(`INSERT INTO checks(id,company_id,check_no,bank_name,amount,currency_code,due_date,status) VALUES ($1,$2,$3,'بنك',$4,'USD','2026-12-01',$5)`, [chk, company, 'CH' + no, checkAmount, status]);
        await q(`INSERT INTO voucher_lines(id,company_id,voucher_id,cashbox_id,payment_method,amount,currency_code,check_id) VALUES ($1,$2,$3,$4,'CHECK',$5,'USD',$6)`, [line, company, v, box, checkAmount, chk]);
        if (status === 'CLEARED') await q(`INSERT INTO check_status_history(check_id,from_status,to_status) VALUES ($1,'DEPOSITED','CLEARED')`, [chk]);
      }
    }

    await receipt('R1', 300, 0);                 // نقد 300
    await receipt('R2', 400, 400, 'RECEIVED');   // شيك قيد التحصيل
    await receipt('R3', 100, 100, 'CLEARED');    // شيك محصّل
    await receipt('R4', 50, 50, 'RETURNED');     // شيك مرتجع

    const st = await svc.getCustomerStatement(company, cust, { currency: 'USD' });
    // 1000 - 300 نقد - 100 شيك محصّل = 600 (الشيك قيد التحصيل 400 والمرتجع 50 لا يُخصمان)
    assert.equal(st.totals.closingBalance, 600);
    assert.equal(st.totals.pendingChecksTotal, 400);
    assert.equal(st.totals.expectedBalance, 200);
    assert.equal(st.pendingChecks.length, 1);
    assert.equal(st.pendingChecks[0].checkNo, 'CHR2');
    assert.ok(st.rows.some((r) => r.type === 'CHECK_COLLECTION' && r.credit === 100));

    // بعد تحصيل الشيك المعلّق يتحول إلى خصم فعلي
    await q(`UPDATE checks SET status='CLEARED' WHERE check_no='CHR2'`);
    await q(`INSERT INTO check_status_history(check_id,from_status,to_status) SELECT id,'DEPOSITED','CLEARED' FROM checks WHERE check_no='CHR2'`);
    const st2 = await svc.getCustomerStatement(company, cust, { currency: 'USD' });
    assert.equal(st2.totals.closingBalance, 200);
    assert.equal(st2.totals.pendingChecksTotal, 0);
  } finally {
    svc.__setStatementDbForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
