import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { canGrantPermissions, deletePermissionTemplate, listPermissionTemplates, savePermissionTemplate } from './userPermissionService.js';
import { permissionCode } from './permissionCatalog.js';

test('named permission templates: save/replace/list/delete, company-scoped; only admin/manager/accountant may grant', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  assert.ok(canGrantPermissions({ role: 'admin' }) && canGrantPermissions({ role: 'manager' }) && canGrantPermissions({ role: 'accountant' }));
  assert.ok(!canGrantPermissions({ role: 'viewer' }) && !canGrantPermissions({ role: 'warehouse' }) && !canGrantPermissions(null));

  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'tpl_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const c1 = randomUUID(), c2 = randomUUID(), u = randomUUID();
    await db.query("INSERT INTO companies(id,code,name) VALUES ($1,'T1','a'),($2,'T2','b')", [c1, c2]);
    await db.query("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$2,'acc','x','accountant')", [u, c1]);

    const a = await savePermissionTemplate(db, { companyId: c1, userId: u, name: ' أمين مخزن ', codes: [permissionCode('customers', 'view'), 'bogus'] });
    assert.equal(a.name, 'أمين مخزن');
    assert.deepEqual(a.codes, [permissionCode('customers', 'view')], 'الأكواد غير الصالحة تُسقَط');
    const b = await savePermissionTemplate(db, { companyId: c1, userId: u, name: 'أمين مخزن', codes: [] });
    assert.equal(b.id, a.id, 'نفس الاسم يستبدل القالب');
    await savePermissionTemplate(db, { companyId: c2, userId: u, name: 'آخر', codes: [] });
    assert.equal((await listPermissionTemplates(db, c1)).length, 1, 'معزول حسب الفرع');
    await assert.rejects(() => savePermissionTemplate(db, { companyId: c1, userId: u, name: '  ', codes: [] }), /اسم القالب/);
    assert.equal(await deletePermissionTemplate(db, c2, a.id), false, 'لا يُحذف قالب فرع آخر');
    assert.equal(await deletePermissionTemplate(db, c1, a.id), true);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
