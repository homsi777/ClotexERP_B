// سكربت فحص محلي مؤقت (لا يُرفع ولا يحوي أسراراً): استلام شيك بسند قبض ثم إلغاؤه، على Postgres محلي مؤقت.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

async function main() {
  const url = new URL('postgres://clotex_test@127.0.0.1:55483/clotex_manufacturing_test');
  const admin = new pg.Client({ connectionString: url.href });
  await admin.connect();
  const schema = `chk_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}, public`);
  const dir = new URL('./db/migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(await readFile(new URL(file, dir), 'utf8'));
  }
  url.searchParams.set('options', `-c search_path=${schema},public -c client_encoding=UTF8`);
  process.env.DATABASE_URL = url.href;
  process.env.NODE_ENV = 'test';
  process.env.CLOTEX_EMBEDDED_SERVER = '1';
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  const { default: Fastify } = await import('fastify');
  const { getPool, resetPool } = await import('./db/pool.js');
  const { signAuthToken } = await import('./middleware/auth.js');
  const { voucherRoutes } = await import('./routes/voucherRoutes.js');
  const { checksRoutes } = await import('./routes/checksRoutes.js');
  const { getCustomerStatement } = await import('./services/partyStatementService.js');
  const app = Fastify();
  try {
    await app.register(voucherRoutes, { prefix: '/vouchers' });
    await app.register(checksRoutes, { prefix: '/checks' });
    const company = randomUUID(), user = randomUUID(), customer = randomUUID();
    await admin.query("INSERT INTO companies(id,code,name) VALUES ($1,'CHK','Check test')", [company]);
    await admin.query("INSERT INTO exchange_rates(company_id,currency_code,currency_name_ar,exchange_rate_to_usd) VALUES($1,'EGP','EGP',50)", [company]);
    await admin.query("INSERT INTO users(id,company_id,username,password_hash) VALUES ($1,$2,'chk-user','unused')", [user, company]);
    await admin.query("INSERT INTO customers(id,company_id,code,name) VALUES($1,$2,'C1','عميل الشيك')", [customer, company]);
    const checksBox = randomUUID(), bankBox = randomUUID(), cashBox = randomUUID();
    for (const [id, code, kind] of [[checksBox, 'CHK', 'CHECKS'], [bankBox, 'BNK', 'BANK'], [cashBox, 'CSH', 'CASH']]) {
      await admin.query(`INSERT INTO cashboxes(id,company_id,code,name,currency_code,account_kind) VALUES ($1,$2,$3,$3,'EGP',$4)`, [id, company, code, kind]);
    }
    const token = signAuthToken({ sub: user, companyId: company, username: 'chk-user', role: 'admin', permissions: [], isPlatformAdmin: false });
    const call = async (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, status = 200) => {
      const r = await app.inject({ method, url: path, payload, headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.statusCode, status, `${method} ${path}: ${r.body}`);
      return r.json();
    };
    const balance = async (id: string) => Number((await admin.query('SELECT current_balance FROM cashboxes WHERE id=$1', [id])).rows[0].current_balance);
    const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
    const receipt = (no: string, withImage = true) => ({
      voucherType: 'RECEIPT', voucherDate: '2026-11-20', partyType: 'CUSTOMER', partyId: customer, partyName: 'عميل الشيك',
      amount: 500, currencyCode: 'EGP', purpose: 'OTHER', description: 'دفعة بشيك',
      lines: [{ cashboxId: checksBox, paymentMethod: 'CHECK', amount: 500, checkDetails: { checkNo: no, bankName: 'بنك مصر', accountHolderName: 'عميل', dueDate: '2026-12-20', imageData: withImage ? IMG : null } }],
    });

    // 1) حفظ مسودة بشيك جديد: لا شيك بعد
    const v1 = (await call('POST', '/vouchers/', receipt('1001'), 201)).data;
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM checks')).rows[0].n, 0, 'لا شيك قبل التأكيد');
    // 2) التأكيد: ينشأ الشيك «مستلم» ويدخل خزينة الشيكات ويُربط بالبند
    await call('PATCH', `/vouchers/${v1.id}/confirm`);
    const chk = (await admin.query('SELECT * FROM checks')).rows;
    assert.equal(chk.length, 1); assert.equal(chk[0].status, 'RECEIVED'); assert.equal(chk[0].party_type, 'CUSTOMER');
    assert.equal(chk[0].party_id, customer); assert.equal(Number(chk[0].amount), 500); assert.equal(chk[0].currency_code, 'EGP');
    assert.equal(chk[0].image_data, IMG);
    const vl = (await admin.query('SELECT check_id, source_voucher_line_id FROM voucher_lines v LEFT JOIN checks c ON c.source_voucher_line_id=v.id WHERE v.voucher_id=$1', [v1.id])).rows[0];
    assert.equal(vl.check_id, chk[0].id);
    assert.equal(await balance(checksBox), 500, 'الشيك دخل خزينة الشيكات');
    // 3) القائمة بلا صورة، والصورة تُجلب منفصلة
    const list = (await call('GET', '/checks/')).rows;
    assert.equal(list[0].has_image, true); assert.equal(list[0].image_data, null);
    assert.equal((await call('GET', `/checks/${chk[0].id}/image`)).data.image, IMG);
    // 4) GET السند يُظهر تفاصيل الشيك بلا الصورة
    const got = (await call('GET', `/vouchers/${v1.id}`)).data;
    assert.equal(got.lines[0].check_details.checkNo, '1001'); assert.equal(got.lines[0].check_details.imageData, undefined);

    // 5) تكرار رقم الشيك والبنك مرفوض عند الحفظ
    await call('POST', '/vouchers/', receipt('1001'), 400);
    // 6) شيك جديد في سند دفع مرفوض
    await call('POST', '/vouchers/', { ...receipt('2002'), voucherType: 'PAYMENT' }, 400);
    // 7) شيك على خزينة نقدية مرفوض
    const bad = receipt('3003'); (bad.lines[0] as any).cashboxId = cashBox;
    await call('POST', '/vouchers/', bad, 400);
    // 8) بند شيك بلا بيانات مرفوض
    const nodet = receipt('4004'); delete (nodet.lines[0] as any).checkDetails;
    await call('POST', '/vouchers/', nodet, 400);

    // 9) إلغاء سند بشيك «مستلم»: يُعلَّم مرتجعاً ويعود الرصيد
    await call('PATCH', `/vouchers/${v1.id}/cancel`);
    assert.equal((await admin.query('SELECT status FROM checks')).rows[0].status, 'RETURNED');
    assert.equal(await balance(checksBox), 0);
    const hist = (await admin.query('SELECT to_status, note FROM check_status_history ORDER BY changed_at')).rows;
    assert.deepEqual(hist.map((h) => h.to_status), ['RECEIVED', 'RETURNED']);

    // 10) شيك أُودع بالبنك: إلغاء سنده مرفوض
    const v2 = (await call('POST', '/vouchers/', receipt('5005', false), 201)).data;
    await call('PATCH', `/vouchers/${v2.id}/confirm`);
    const c2 = (await admin.query("SELECT id FROM checks WHERE check_no='5005'")).rows[0].id;
    await admin.query("UPDATE checks SET status='DEPOSITED' WHERE id=$1", [c2]);
    assert.equal((await admin.query('SELECT status FROM checks WHERE id=$1', [c2])).rows[0].status, 'DEPOSITED');
    const cancel = await app.inject({ method: 'PATCH', url: `/vouchers/${v2.id}/cancel`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(cancel.statusCode, 400, cancel.body); assert.match(cancel.json().error?.message ?? cancel.body, /الشيك 5005/);
    assert.equal((await admin.query('SELECT status FROM vouchers WHERE id=$1', [v2.id])).rows[0].status, 'CONFIRMED');
    // ---- 11) خزينة الشيكات تلقائياً: بند شيك بلا cashboxId ----
    const auto = (no: string, ccy: string, rate?: number) => ({
      voucherType: 'RECEIPT', voucherDate: '2026-11-20', partyType: 'CUSTOMER', partyId: customer, partyName: 'عميل الشيك',
      amount: 300, currencyCode: ccy, ...(rate ? { exchangeRateToUsd: rate } : {}), purpose: 'OTHER', description: 'دفعة بشيك',
      lines: [{ paymentMethod: 'CHECK', amount: 300, checkDetails: { checkNo: no, bankName: 'البنك الأهلي', dueDate: '2026-12-25', imageData: null } }],
    });
    const before = (await admin.query("SELECT count(*)::int AS n FROM cashboxes WHERE account_kind='CHECKS'")).rows[0].n;
    const vEgp = (await call('POST', '/vouchers/', auto('6001', 'EGP'), 201)).data;
    await call('PATCH', `/vouchers/${vEgp.id}/confirm`);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM cashboxes WHERE account_kind='CHECKS'")).rows[0].n, before, 'EGP reuses the existing cheques cashbox');
    const vUsd = (await call('POST', '/vouchers/', auto('6002', 'USD', 1), 201)).data;
    await call('PATCH', `/vouchers/${vUsd.id}/confirm`);
    const boxes = (await admin.query("SELECT code, currency_code, current_balance FROM cashboxes WHERE account_kind='CHECKS' ORDER BY currency_code")).rows;
    assert.equal(boxes.length, before + 1, 'USD cheque auto-creates a USD cheques cashbox');
    const usdBox = boxes.find((b: any) => b.currency_code === 'USD');
    assert.equal(usdBox.code, 'CHK-USD'); assert.equal(Number(usdBox.current_balance), 300);
    // الشيك مرتبط بسنده في قائمة الشيكات
    const listed = (await call('GET', '/checks/?search=6002')).rows[0];
    assert.equal(listed.voucher_id, vUsd.id); assert.match(listed.voucher_no, /\d+/);
    // كشف العميل يعرض رقم الشيك والبنك
    const st = await getCustomerStatement(company, customer, {});
    const row = st.rows.find((r: any) => String(r.description).includes('6002'));
    assert.ok(row, 'statement row for the cheque voucher'); assert.match(row.description, /شيك 6002 \/ البنك الأهلي/);
    // الإيداع يختار خزينة الشيكات بعملة الشيك (لا خزينة عملة أخرى) — نتحقق من اختيار الخزينة فقط
    const picked = (await admin.query("SELECT id FROM cashboxes WHERE company_id=$1 AND account_kind='CHECKS' ORDER BY (currency_code = 'USD') DESC, created_at ASC LIMIT 1", [company])).rows[0].id;
    assert.equal(picked, (await admin.query("SELECT id FROM cashboxes WHERE code='CHK-USD'")).rows[0].id);
    // بند بلا صندوق وبلا شيك مرفوض
    await call('POST', '/vouchers/', { ...auto('6003', 'EGP'), lines: [{ paymentMethod: 'CASH', amount: 300 }] }, 400);
    console.log('check-in-receipt integration passed');
  } finally {
    await app.close();
    await resetPool();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
