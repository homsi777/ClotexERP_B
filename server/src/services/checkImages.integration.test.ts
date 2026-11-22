import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

const PX = (n: number) => `data:image/png;base64,iVBORw0KGgo${'A'.repeat(20 + n)}`;

test('صور الشيكات: أصل محفوظ، تعديل بجانبه، وجه وظهر، تدقيق، ولا تأثير مالي', {
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
    const schema = 'chk_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const svc = await import('./checkImagesService.js');
    const { createCheck } = await import('./checksService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const company = randomUUID(), other = randomUUID(), user = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'CK','one'),($2,'CK2','two')", [company, other]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$2,'u','x','accountant')", [user, company]);

    // إنشاء شيك بصورة (مسار السند) ← تُنسخ كأصل
    const chk = await createCheck(client, { companyId: company, userId: user, checkNo: '1001', bankName: 'بنك', amount: 500, dueDate: '2026-12-20', imageData: PX(1) } as never);
    let metas = await svc.listCheckImages(client, company, chk.id);
    assert.equal(metas.length, 1);
    assert.equal(metas[0].side, 'FRONT');
    assert.equal(metas[0].hasEdit, false);
    const before = (await q('SELECT status, amount::float a, image_data FROM checks WHERE id=$1', [chk.id]))[0];
    assert.equal(before.image_data, PX(1));

    // إضافة الظهر
    const back = await svc.addCheckImage(client, { companyId: company, userId: user, checkId: chk.id, side: 'BACK', data: PX(2) });
    assert.equal(back.sortOrder, 1);

    // تعديل الأمام: النسخة المعدَّلة بجانب الأصل، والأصل سليم
    const frontId = metas[0].id;
    const edited = await svc.saveCheckImageEdit(client, { companyId: company, userId: user, imageId: frontId, editedData: PX(3), editParams: { rotation: 90, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } } });
    assert.equal(edited.hasEdit, true);
    assert.deepEqual((edited.editParams as { rotation: number }).rotation, 90);
    assert.equal((await svc.getCheckImageData(client, company, frontId, 'original')).data, PX(1), 'الأصل لم يتغيّر');
    assert.equal((await svc.getCheckImageData(client, company, frontId, 'effective')).data, PX(3));
    assert.equal((await q('SELECT image_data FROM checks WHERE id=$1', [chk.id]))[0].image_data, PX(3), 'الأساسية = الفعّالة');

    // إعادة التعديل ثم العودة للأصل
    await svc.saveCheckImageEdit(client, { companyId: company, userId: user, imageId: frontId, editedData: PX(4), editParams: { rotation: 180 } });
    assert.equal((await svc.getCheckImageData(client, company, frontId, 'original')).data, PX(1));
    const reset = await svc.resetCheckImageEdit(client, { companyId: company, userId: user, imageId: frontId });
    assert.equal(reset.hasEdit, false);
    assert.equal((await q('SELECT image_data FROM checks WHERE id=$1', [chk.id]))[0].image_data, PX(1));

    // بيانات الطباعة: صورتان بالترتيب
    const pd = await svc.getPrintData(client, company, [chk.id]);
    assert.deepEqual(pd[0].images.map((i) => i.side), ['FRONT', 'BACK']);
    assert.equal(pd[0].deliveredAt, null);

    // التحقق
    await assert.rejects(() => svc.addCheckImage(client, { companyId: company, userId: user, checkId: chk.id, side: 'OTHER', data: 'not-an-image' }), /صيغة|مطلوبة/);
    await assert.rejects(() => svc.addCheckImage(client, { companyId: company, userId: user, checkId: chk.id, side: 'OTHER', data: 'data:image/png;base64,' + 'A'.repeat(3_000_001) }), /كبير/);
    await assert.rejects(() => svc.addCheckImage(client, { companyId: other, userId: null, checkId: chk.id, side: 'OTHER', data: PX(5) }), /غير موجود/, 'عزل الفروع');
    await assert.rejects(() => svc.getCheckImageData(client, other, frontId, 'original'), /غير موجودة/);
    for (let i = 0; i < 4; i++) await svc.addCheckImage(client, { companyId: company, userId: user, checkId: chk.id, side: 'OTHER', data: PX(10 + i) });
    await assert.rejects(() => svc.addCheckImage(client, { companyId: company, userId: user, checkId: chk.id, side: 'OTHER', data: PX(99) }), /الحد الأقصى/);

    // حذف صورة الأمام ← الأساسية تصير الصورة التالية
    await svc.deleteCheckImage(client, { companyId: company, userId: user, imageId: frontId });
    assert.equal((await q('SELECT image_data FROM checks WHERE id=$1', [chk.id]))[0].image_data, PX(2));

    // لا تأثير مالي/محاسبي، والتدقيق مسجَّل
    const after = (await q('SELECT status, amount::float a FROM checks WHERE id=$1', [chk.id]))[0];
    assert.equal(after.status, before.status);
    assert.equal(after.a, before.a);
    assert.equal((await q('SELECT count(*)::int n FROM check_status_history WHERE check_id=$1', [chk.id]))[0].n, 1);
    const actions = (await q("SELECT action FROM audit_logs WHERE company_id=$1 AND action LIKE 'CHECK_IMAGE_%' ORDER BY id", [company])).map((r) => r.action);
    for (const a of ['CHECK_IMAGE_ADDED', 'CHECK_IMAGE_EDITED', 'CHECK_IMAGE_RESET', 'CHECK_IMAGE_DELETED']) assert.ok(actions.includes(a), a);
    // سجل التدقيق لا يحمل محتوى الصور
    const det = JSON.stringify(await q("SELECT details FROM audit_logs WHERE action LIKE 'CHECK_IMAGE_%'"));
    assert.ok(!det.includes('iVBOR'));
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
