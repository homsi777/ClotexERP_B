import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('استيراد السلف: مطابقة بالكود والاسم، إنشاء موظف مفقود، أقساط مدفوعة/معلقة، وإعادة الاستيراد آمنة', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'adv_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const { importAdvancesFromExcel } = await import('./advanceImportService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const company = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'ADV','adv test')", [company]);
    await q(
      `INSERT INTO payroll_employees(company_id,employee_code,full_name,fingerprint_code,base_salary,currency_code) VALUES
       ($1,'EMP-187','هويدا طه إبراهيم','187',9000,'EGP'),
       ($1,'EMP-232','سعيد احمد سعيد مصطفى','232',10500,'EGP'),
       ($1,'EMP-301','محمد احمد سعيد مصطفى سليم','301',6500,'EGP'),
       ($1,'EMP-103','أحمد ربيع عيد مصطفى','103',12000,'EGP'),
       ($1,'EMP-302','محمد علي حسن','302',7000,'EGP')`,
      [company],
    );

    const rows = [
      { rowKey: 'a', code: '103', name: 'أحمد ربيع عيد مصطفى', amount: 2000, advanceDate: '2026-10-31', installments: [] },
      { rowKey: 'b', name: 'هويدا', amount: 5000, advanceDate: '2026-02-11', installments: [
        { month: 2, year: 2026, amount: 1000 }, { month: 10, year: 2026, amount: 2000 }, { month: 11, year: 2026, amount: 2000 },
      ] },
      { rowKey: 'c', name: 'سعيد احمد سعيد', amount: 12000, advanceDate: '2026-02-01', installments: [{ month: 4, year: 2026, amount: 2000 }] },
      { rowKey: 'd', name: 'عطا شعبان', amount: 3000, advanceDate: '2026-03-01', installments: [{ month: 12, year: 2026, amount: 1000 }], createIfMissing: true },
      { rowKey: 'e', name: 'كفر حمزة', amount: 30000, advanceDate: '2026-10-31' },
      { rowKey: 'f', name: 'محمد', amount: 100, advanceDate: '2026-10-31' },
    ];
    const base = { companyId: company, userId: null, fileName: 't.xlsx', kind: 'SCHED' as const, currencyCode: 'EGP', paidThrough: { month: 10, year: 2026 } };

    // معاينة: لا تكتب شيئاً
    const dry = await importAdvancesFromExcel(client, { ...base, dryRun: true, rows });
    assert.equal(dry.advancesCreated, 4);
    assert.equal((await q('SELECT count(*)::int n FROM payroll_employee_advances'))[0].n, 0);
    assert.equal((await q('SELECT count(*)::int n FROM payroll_employees'))[0].n, 5, 'المعاينة لا تنشئ موظفين');

    const res = await importAdvancesFromExcel(client, { ...base, dryRun: false, rows });
    const by = Object.fromEntries(res.rows.map((r) => [r.rowKey, r]));
    assert.equal(by.a.matchedBy, 'CODE');
    assert.equal(by.b.matchedBy, 'NAME_PREFIX');
    assert.equal(by.b.employeeCode, 'EMP-187');
    assert.equal(by.c.employeeCode, 'EMP-232', 'لا يلتبس مع محمد احمد سعيد');
    assert.equal(by.d.createdEmployee, true);
    assert.equal(by.e.status, 'MISSING');
    assert.equal(by.f.status, 'AMBIGUOUS');
    assert.equal(res.advancesCreated, 4);
    assert.equal(res.employeesCreated, 1);

    // الأقساط: ≤ أكتوبر PAID، بعده PENDING
    const inst = await q(
      `SELECT ai.due_month, ai.due_year, ai.status, ai.paid_amount::float p, ai.amount::float a, ai.installment_no
       FROM advance_installments ai JOIN payroll_employee_advances a ON a.id=ai.advance_id
       WHERE a.advance_no LIKE '%187%' ORDER BY ai.installment_no`,
    );
    assert.deepEqual(inst.map((i) => [i.due_month, i.status, i.p]), [[2, 'PAID', 1000], [10, 'PAID', 2000], [11, 'PENDING', 0]]);
    const adv = (await q(`SELECT cashbox_id, voucher_id, source, installment_count, amount::float amt FROM payroll_employee_advances WHERE advance_no LIKE '%187%'`))[0];
    assert.equal(adv.cashbox_id, null);
    assert.equal(adv.voucher_id, null);
    assert.equal(adv.source, 'EXCEL_IMPORT');
    assert.equal(adv.installment_count, 3);
    assert.equal((await q('SELECT count(*)::int n FROM vouchers'))[0].n, 0, 'لا سندات صرف');
    assert.equal((await q('SELECT count(*)::int n FROM cashbox_movements'))[0].n, 0, 'لا حركة صندوق');

    const created = (await q(`SELECT employee_code, full_name, status FROM payroll_employees WHERE full_name='عطا شعبان'`))[0];
    assert.equal(created.status, 'ACTIVE');

    // إعادة الاستيراد: تخطٍّ بلا تكرار
    const again = await importAdvancesFromExcel(client, { ...base, dryRun: false, rows });
    assert.equal(again.advancesCreated, 0);
    assert.equal(again.rows.filter((r) => r.status === 'DUPLICATE').length, 4);
    assert.equal(again.employeesCreated, 0);
    assert.equal((await q('SELECT count(*)::int n FROM payroll_employee_advances'))[0].n, 4);
    assert.equal((await q("SELECT count(*)::int n FROM payroll_employees WHERE full_name='عطا شعبان'"))[0].n, 1);

    // سلفة يدوية بلا صندوق ممنوعة
    await assert.rejects(() =>
      db.query(`INSERT INTO payroll_employee_advances(company_id,employee_id,advance_no,amount,currency_code) SELECT $1,id,'X1',10,'EGP' FROM payroll_employees LIMIT 1`, [company]),
    );
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
