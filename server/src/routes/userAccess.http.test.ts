import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import pg from 'pg';

test('users: block/unblock/delete/restore, login refusal, session log with duration, logout, branch isolation', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { setPoolOverrideForTests } = await import('../db/pool.js');
  try {
    await db.query('BEGIN');
    const schema = 'usr_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
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
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const a = randomUUID(), b = randomUUID(), adminA = randomUUID(), adminB = randomUUID(), emp = randomUUID(), acc = randomUUID();
    await q("INSERT INTO companies(id,code,name,is_active) VALUES ($1,'A','فرع أ',true),($2,'B','فرع ب',true)", [a, b]);
    const hash = await bcrypt.hash('Pw-123456', 4);
    const mk = (id: string, co: string, name: string, role: string) => q('INSERT INTO users(id,company_id,username,password_hash,role,is_active) VALUES ($1,$2,$3,$4,$5,true)', [id, co, name, hash, role]);
    await mk(adminA, a, 'adminA', 'admin'); await mk(adminB, b, 'adminB', 'admin'); await mk(emp, a, 'emp', 'inventory'); await mk(acc, a, 'acc', 'accountant');
    const { setCompanyActivationStatus } = await import('../services/activationService.js');
    for (const c of [a, b]) await setCompanyActivationStatus(fakeClient as never, c, { planCode: 'T', activatedAt: new Date().toISOString(), keySuffix: 'T' } as never);
    const { signAuthToken } = await import('../middleware/auth.js');
    const tok = (id: string, co: string, name: string, role: string) => signAuthToken({ sub: id, companyId: co, username: name, role, permissions: [] });
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    const call = (method: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, token?: string, payload?: unknown) => app.inject({ method, url: path, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as never });
    const tA = tok(adminA, a, 'adminA', 'admin'), tB = tok(adminB, b, 'adminB', 'admin'), tEmp = tok(emp, a, 'emp', 'inventory'), tAcc = tok(acc, a, 'acc', 'accountant');
    const login = (username: string) => call('POST', '/api/auth/login', undefined, { username, password: 'Pw-123456' });
    const flush = async () => { for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 25)); } };

    // الموظف يعمل فتُسجَّل جلسته
    assert.equal((await call('GET', '/api/auth/me', tEmp)).statusCode, 200);
    await flush();
    type Row = { username: string; live: boolean; durationSec: number; endReason: string | null };
    const empLog = async () => (await call('GET', `/api/system/session-log?userId=${emp}`, tA)).json().data as Row[];
    let log = await empLog();
    assert.equal(log.length, 1); assert.equal(log[0].username, 'emp'); assert.equal(log[0].live, true); assert.equal(log[0].endReason, null);
    assert.equal((await call('GET', '/api/system/session-log', tEmp)).statusCode, 403, 'الموظف لا يرى السجل');
    const pres = (await call('GET', '/api/system/users-presence', tA)).json().data as Array<{ username: string; online: boolean; sessionsInPeriod: number }>;
    assert.equal(pres.find((p) => p.username === 'emp')!.online, true); assert.equal(pres.find((p) => p.username === 'acc')!.online, false);
    assert.equal(pres.length, 3, 'كل المستخدمين: متصل وغير متصل');

    // الحظر: الصلاحية والحماية
    assert.equal((await call('POST', `/api/system/users/${emp}/block`, tAcc, {})).statusCode, 403, 'المحاسب لا يحظر');
    assert.equal((await call('POST', `/api/system/users/${adminA}/block`, tA, {})).statusCode, 400, 'لا حظر للنفس');
    assert.equal((await call('POST', `/api/system/users/${emp}/block`, tB, {})).statusCode, 404, 'مدير فرع آخر لا يصل لمستخدمي هذا الفرع');
    assert.equal((await call('POST', `/api/system/users/${emp}/block`, tA, { reason: 'تجاوز' })).statusCode, 200);
    // الجلسة والتوكن والدخول كلها تُرفض
    const blockedReq = await call('GET', '/api/auth/me', tEmp);
    assert.equal(blockedReq.statusCode, 401); assert.equal(blockedReq.json().code, 'USER_BLOCKED');
    const blockedLogin = await login('emp');
    assert.equal(blockedLogin.statusCode, 401); assert.equal(blockedLogin.json().code, 'USER_BLOCKED');
    assert.equal((await call('POST', '/api/auth/login', undefined, { username: 'emp', password: 'wrong' })).json().code, 'AUTH', 'كلمة خاطئة لا تكشف الحظر');
    log = await empLog();
    assert.equal(log[0].endReason, 'BLOCKED'); assert.equal(log[0].live, false);
    const list = (await call('GET', '/api/system/users', tA)).json().data as Array<{ username: string; blocked: boolean; block_reason: string | null }>;
    assert.deepEqual([list.find((u) => u.username === 'emp')!.blocked, list.find((u) => u.username === 'emp')!.block_reason], [true, 'تجاوز'], 'يظهر المحظور بسببه');

    // إلغاء الحظر يعيد الدخول
    assert.equal((await call('POST', `/api/system/users/${emp}/unblock`, tA)).statusCode, 200);
    assert.equal((await login('emp')).statusCode, 200);
    const empToken = (await login('emp')).json().token as string;

    // الخروج: يسجَّل وقته ويُبطل التوكن
    assert.equal((await call('GET', '/api/auth/me', empToken)).statusCode, 200);
    assert.equal((await call('POST', '/api/auth/logout', empToken)).statusCode, 200);
    await flush();
    assert.equal((await call('GET', '/api/auth/me', empToken)).statusCode, 401, 'التوكن بعد الخروج مرفوض');
    log = await empLog();
    assert.ok(log.some((r) => r.endReason === 'LOGOUT'), 'سبب الخروج اليدوي');
    // المدة = من الدخول للخروج
    await q("UPDATE user_session_log SET connected_at = now() - interval '2 hours', ended_at = now() - interval '1 hour', end_reason='LOGOUT' WHERE user_id=$1 AND end_reason='LOGOUT'", [emp]);
    log = await empLog();
    assert.ok(log.some((r) => r.durationSec >= 3590 && r.durationSec <= 3610), 'ساعة بين الدخول والخروج');
    // جلسة تُركت بلا خروج: تنتهي بالخمول وتُحسب حتى آخر نشاط
    await q("INSERT INTO user_session_log(company_id,user_id,session_key,connected_at,last_seen_at) VALUES ($1,$2,'idle',now() - interval '3 hours', now() - interval '2 hours')", [a, acc]);
    const idle = ((await call('GET', `/api/system/session-log?userId=${acc}`, tA)).json().data as Array<{ endReason: string | null; durationSec: number; live: boolean }>).find((r) => !r.live)!;
    assert.deepEqual([idle.endReason, idle.live, idle.durationSec], ['TIMEOUT', false, 3600]);
    const presA = (await call('GET', '/api/system/users-presence', tA)).json().data as Array<{ username: string; secondsInPeriod: number }>;
    assert.ok(presA.find((p) => p.username === 'acc')!.secondsInPeriod >= 3590, 'إجمالي وقت الاستخدام');

    // الحذف المنطقي والاستعادة
    assert.equal((await call('DELETE', `/api/system/users/${emp}`, tAcc)).statusCode, 403);
    assert.equal((await call('DELETE', `/api/system/users/${adminA}`, tA)).statusCode, 400, 'لا حذف للنفس');
    assert.equal((await call('DELETE', `/api/system/users/${emp}`, tA)).statusCode, 200);
    assert.equal((await call('GET', '/api/auth/me', tEmp)).statusCode, 401, 'المحذوف مرفوض');
    assert.equal((await login('emp')).statusCode, 401, 'المحذوف لا يدخل');
    assert.ok(!((await call('GET', '/api/system/users', tA)).json().data as Array<{ username: string }>).some((u) => u.username === 'emp'), 'المحذوف مخفي افتراضياً');
    assert.ok(((await call('GET', '/api/system/users?includeDeleted=1', tA)).json().data as Array<{ username: string; deleted: boolean }>).some((u) => u.username === 'emp' && u.deleted), 'يظهر عند الطلب');
    assert.equal((await q('SELECT 1 FROM users WHERE id=$1', [emp])).length, 1, 'السجل محفوظ (حذف منطقي)');
    // اسم المحذوف يمكن إعادة استخدامه، ويمنع الاستعادة عند التعارض
    assert.equal((await call('POST', '/api/system/users', tA, { username: 'emp', fullName: 'جديد', password: 'Pw-123456', role: 'inventory', isActive: true })).statusCode, 201);
    assert.equal((await call('POST', `/api/system/users/${emp}/restore`, tA)).statusCode, 409);
    await q("UPDATE users SET username='emp-old' WHERE id=$1", [emp]);
    assert.equal((await call('POST', `/api/system/users/${emp}/restore`, tA)).statusCode, 200);
    assert.equal((await login('emp-old')).statusCode, 200);
    await app.close();
  } finally {
    setPoolOverrideForTests(null);
    await db.query('ROLLBACK');
    await db.end();
  }
});
