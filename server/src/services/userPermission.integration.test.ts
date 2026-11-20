import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('user permission matrix: custom mode, implied views, legacy codes, audit, admin protected', {
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
    const schema = 'perm_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const { saveUserPermissions, effectivePermissionsForUser } = await import('./userPermissionService.js');
    const { permissionCode } = await import('./permissionCatalog.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const company = randomUUID(), boss = randomUUID(), staff = randomUUID(), adminUser = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'PERM','perm test')", [company]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$4,'boss','x','accountant'),($2,$4,'staff','x','viewer'),($3,$4,'adm','x','admin')", [boss, staff, adminUser, company]);

    // الافتراضي: ROLE
    assert.equal((await effectivePermissionsForUser(client, { id: staff, role: 'viewer', perm_mode: 'ROLE' })).mode, 'ROLE');

    // مخصّص: فواتير بيع (إضافة) فقط
    await saveUserPermissions(client, { companyId: company, targetUserId: staff, changedBy: boss, mode: 'CUSTOM', codes: [permissionCode('sales.invoices', 'create'), 'bogus.code'] });
    const eff = await effectivePermissionsForUser(client, { id: staff, role: 'viewer', perm_mode: 'CUSTOM' });
    assert.equal(eff.mode, 'CUSTOM');
    for (const c of ['sales.invoices.view', 'customers.view', 'inventory.rolls.view']) assert.ok(eff.matrix.includes(`p:${c}`), c);
    assert.ok(!eff.matrix.includes(permissionCode('sales.invoices', 'delete')));
    assert.ok(!eff.matrix.includes(permissionCode('treasury.vouchers', 'view')), 'no financial leakage');
    assert.ok(eff.permissions.includes('customers.view'), 'legacy code for existing route checks');
    assert.equal((await q("SELECT perm_mode FROM users WHERE id=$1", [staff]))[0].perm_mode, 'CUSTOM');

    // تعديل ثانٍ: يسجَّل المضاف والمُزال
    await saveUserPermissions(client, { companyId: company, targetUserId: staff, changedBy: boss, mode: 'CUSTOM', codes: [permissionCode('customers', 'view')] });
    const audit = await q('SELECT mode,added,removed FROM user_permission_audit WHERE user_id=$1 ORDER BY changed_at,id', [staff]);
    assert.equal(audit.length, 2);
    const second = audit.find((a) => a.removed.length > 0)!;
    assert.deepEqual(second.added, [permissionCode('customers', 'view')]);
    assert.ok(second.removed.includes(permissionCode('sales.invoices', 'create')));

    // العودة للدور تمسح المصفوفة
    await saveUserPermissions(client, { companyId: company, targetUserId: staff, changedBy: boss, mode: 'ROLE', codes: [] });
    assert.equal((await q('SELECT count(*)::int n FROM user_permission_grants WHERE user_id=$1', [staff]))[0].n, 0);

    // المدير لا يُقيَّد، والمستخدم من شركة أخرى غير موجود
    await assert.rejects(() => saveUserPermissions(client, { companyId: company, targetUserId: adminUser, changedBy: boss, mode: 'CUSTOM', codes: [] }), /لا يمكن تقييد/);
    await assert.rejects(() => saveUserPermissions(client, { companyId: randomUUID(), targetUserId: staff, changedBy: boss, mode: 'CUSTOM', codes: [] }), /غير موجود/);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
