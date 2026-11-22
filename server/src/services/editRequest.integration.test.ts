import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('طلب إذن التعديل: ربط بالمسؤول، رسالة دردشة، موافقة/رفض، إذن لمرة واحدة، وعزل الفروع', {
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
    const schema = 'edt_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const svc = await import('./editRequestService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const c1 = randomUUID(), c2 = randomUUID(), store = randomUUID(), boss = randomUUID(), other = randomUUID(), foreign = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'A','a'),($2,'B','b')", [c1, c2]);
    await q(`INSERT INTO users(id,company_id,username,full_name,password_hash,role) VALUES
      ($1,$5,'store','مخزن','x','inventory'),($2,$5,'boss','المدير','x','manager'),($3,$5,'other','آخر','x','accountant'),($4,$6,'f','غريب','x','manager')`,
    [store, boss, other, foreign, c1, c2]);
    const cust = randomUUID();
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C1','أحمد كوسا')", [cust, c1]);
    const customerInOther = randomUUID();
    await q("INSERT INTO customers(id,company_id,code,name) VALUES ($1,$2,'C9','عميل آخر')", [customerInOther, c2]);

    // ربط الموظف بمسؤوله
    await svc.setSupervisor(client, { companyId: c1, actorId: boss, userId: store, supervisorId: boss });
    assert.equal((await svc.listSupervisorAssignments(client, c1)).find((x) => x.userId === store)!.supervisorId, boss);
    await assert.rejects(() => svc.setSupervisor(client, { companyId: c1, actorId: boss, userId: store, supervisorId: store }), /نفسه/);
    await assert.rejects(() => svc.setSupervisor(client, { companyId: c1, actorId: boss, userId: store, supervisorId: foreign }), /غير موجود/);

    // الطلب: سبب مطلوب، عنصر الفرع الآخر مرفوض
    await assert.rejects(() => svc.createEditRequest(client, { companyId: c1, userId: store, entityType: 'CUSTOMER', entityId: cust, reason: 'x' }), /سبب/);
    await assert.rejects(() => svc.createEditRequest(client, { companyId: c1, userId: store, entityType: 'CUSTOMER', entityId: customerInOther, reason: 'تصحيح الهاتف' }), /غير موجود/);
    const req = await svc.createEditRequest(client, { companyId: c1, userId: store, entityType: 'CUSTOMER', entityId: cust, reason: 'تصحيح رقم الهاتف' });
    assert.equal(req.status, 'PENDING');
    assert.equal(req.supervisorId, boss);
    assert.equal(req.entityLabel, 'أحمد كوسا');
    // لا تكرار لطلب مفتوح
    assert.equal((await svc.createEditRequest(client, { companyId: c1, userId: store, entityType: 'CUSTOMER', entityId: cust, reason: 'مرة ثانية' })).id, req.id);

    // رسالة الدردشة للمسؤول مرتبطة بالعملية
    const chat = await q('SELECT sender_id, recipient_id, body FROM chat_messages WHERE company_id=$1', [c1]);
    assert.equal(chat.length, 1);
    assert.equal(chat[0].recipient_id, boss);
    assert.ok(chat[0].body.includes('أحمد كوسا') && chat[0].body.includes(`/customers?edit=${cust}`));

    // الظهور: المسؤول والمحاسب (يرى الكل) نعم؛ المخزن لا
    assert.equal((await svc.listPendingFor(client, c1, boss, false)).length, 1);
    assert.equal((await svc.listPendingFor(client, c1, other, true)).length, 1);
    assert.equal((await svc.listPendingFor(client, c1, other, false)).length, 0, 'مسؤول آخر غير شامل لا يرى طلب غيره');

    // لا إذن قبل الموافقة
    assert.equal(await svc.findApprovedGrant(client, c1, store, req.id, cust), false);
    // قرار: لا يوافق صاحب الطلب على نفسه، ولا مسؤول آخر غير شامل
    await assert.rejects(() => svc.decideEditRequest(client, { companyId: c1, approverId: store, approverSeesAll: true, requestId: req.id, approve: true }), /طلبك/);
    await assert.rejects(() => svc.decideEditRequest(client, { companyId: c1, approverId: other, approverSeesAll: false, requestId: req.id, approve: true }), /مسؤول آخر/);
    const done = await svc.decideEditRequest(client, { companyId: c1, approverId: boss, approverSeesAll: false, requestId: req.id, approve: true });
    assert.equal(done.status, 'APPROVED');
    await assert.rejects(() => svc.decideEditRequest(client, { companyId: c1, approverId: boss, approverSeesAll: true, requestId: req.id, approve: false }), /مسبقاً/);

    // رد المسؤول بالدردشة للموظف
    const reply = (await q('SELECT body FROM chat_messages WHERE recipient_id=$1', [store]))[0];
    assert.ok(reply.body.includes('تمت الموافقة'));

    // الإذن: لهذا العنصر وهذا الموظف فقط، ومرة واحدة
    assert.equal(await svc.findApprovedGrant(client, c1, store, req.id, cust), true);
    assert.equal(await svc.findApprovedGrant(client, c1, other, req.id, cust), false, 'ليس لموظف آخر');
    assert.equal(await svc.findApprovedGrant(client, c1, store, req.id, customerInOther), false, 'ليس لعنصر آخر');
    assert.equal(await svc.findApprovedGrant(client, c2, store, req.id, cust), false, 'ليس لفرع آخر');
    await svc.markGrantUsed(client, c1, req.id);
    assert.equal(await svc.findApprovedGrant(client, c1, store, req.id, cust), false, 'استُهلك');
    assert.equal((await svc.listMyRequests(client, c1, store, 'CUSTOMER', cust))[0].status, 'USED');

    // رفض + تدقيق
    const r2 = await svc.createEditRequest(client, { companyId: c1, userId: store, entityType: 'CUSTOMER', entityId: cust, reason: 'تعديل ثانٍ' });
    const rej = await svc.decideEditRequest(client, { companyId: c1, approverId: boss, approverSeesAll: false, requestId: r2.id, approve: false, note: 'غير مبرر' });
    assert.equal(rej.status, 'REJECTED');
    assert.equal(await svc.findApprovedGrant(client, c1, store, r2.id, cust), false);
    const actions = (await q("SELECT action FROM audit_logs WHERE company_id=$1 AND action LIKE 'EDIT_REQUEST_%' OR action='USER_SUPERVISOR_SET'", [c1])).map((a) => a.action);
    for (const a of ['EDIT_REQUEST_CREATED', 'EDIT_REQUEST_APPROVED', 'EDIT_REQUEST_REJECTED', 'USER_SUPERVISOR_SET']) assert.ok(actions.includes(a), a);

    // بلا مسؤول معيّن: يراه الشامل فقط
    await svc.setSupervisor(client, { companyId: c1, actorId: boss, userId: store, supervisorId: null });
    const inv = randomUUID();
    await q("INSERT INTO suppliers(id,company_id,code,name) VALUES ($1,$2,'S1','مورد')", [inv, c1]);
    const r3 = await svc.createEditRequest(client, { companyId: c1, userId: store, entityType: 'SUPPLIER', entityId: inv, reason: 'تعديل العنوان' });
    assert.equal(r3.supervisorId, null);
    assert.equal((await svc.listPendingFor(client, c1, other, true)).length, 1);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
