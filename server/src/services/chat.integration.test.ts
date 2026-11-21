import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('دردشة الفرع: غرفة الفرع + محادثات فردية، غير المقروء، وعزل الفروع', {
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
    const schema = 'chat_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const { listPeers, listMessages, sendMessage, markRead } = await import('./chatService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const c1 = randomUUID(), c2 = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'C1','one'),($2,'C2','two')", [c1, c2]);
    const [a, b, c, other, inactive] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await q(
      `INSERT INTO users(id,company_id,username,full_name,password_hash,role,is_active) VALUES
       ($1,$6,'a','أحمد','x','viewer',true),($2,$6,'b','بشير','x','viewer',true),($3,$6,'c',NULL,'x','viewer',true),
       ($4,$7,'o','غريب','x','viewer',true),($5,$6,'z','موقوف','x','viewer',false)`,
      [a, b, c, other, inactive, c1, c2],
    );

    // غرفة الفرع
    await sendMessage(client, c1, a, 'room', 'مرحباً بالجميع');
    // فردي أحمد → بشير
    await sendMessage(client, c1, a, b, 'سلام يا بشير');
    await sendMessage(client, c1, a, b, 'عندك فاتورة؟');

    // بشير: غير المقروء = 2 فردي + 1 غرفة
    let peers = await listPeers(client, c1, b);
    const byKey = Object.fromEntries(peers.map((p) => [p.key, p]));
    assert.equal(byKey.room.unread, 1);
    assert.equal(byKey[a].unread, 2);
    assert.equal(byKey[a].lastMessage, 'عندك فاتورة؟');
    assert.ok(!byKey[inactive], 'الموقوف لا يظهر');
    assert.ok(!byKey[other], 'مستخدم فرع آخر لا يظهر');
    assert.ok(!byKey[b], 'لا يظهر المستخدم لنفسه');
    assert.equal(byKey[c].name, 'c', 'بلا اسم كامل ← اسم المستخدم');
    assert.equal(byKey[c].unread, 0);

    // المحادثة الفردية لا يراها طرف ثالث
    const msgsB = await listMessages(client, c1, b, a);
    assert.deepEqual(msgsB.map((m) => m.body), ['سلام يا بشير', 'عندك فاتورة؟']);
    assert.equal((await listMessages(client, c1, c, a)).length, 0, 'ثالث لا يرى فردياً بين غيره');
    assert.equal(msgsB[0].senderName, 'أحمد');
    // استعلام تدرّجي
    assert.deepEqual((await listMessages(client, c1, b, a, { afterId: msgsB[0].id })).map((m) => m.body), ['عندك فاتورة؟']);

    // قراءة
    await markRead(client, c1, b, a);
    peers = await listPeers(client, c1, b);
    assert.equal(peers.find((p) => p.key === a)!.unread, 0);
    assert.equal(peers.find((p) => p.key === 'room')!.unread, 1, 'الغرفة لم تُقرأ بعد');
    await markRead(client, c1, b, 'room');
    assert.equal((await listPeers(client, c1, b)).find((p) => p.key === 'room')!.unread, 0);

    // رسالة جديدة بعد القراءة تظهر غير مقروءة؛ وما أرسلته لا يُحسب غير مقروء عندك
    await sendMessage(client, c1, a, 'room', 'رسالة ثانية');
    assert.equal((await listPeers(client, c1, b)).find((p) => p.key === 'room')!.unread, 1);
    assert.equal((await listPeers(client, c1, a)).find((p) => p.key === 'room')!.unread, 0);
    await sendMessage(client, c1, b, a, 'رد');
    assert.equal((await listPeers(client, c1, b)).find((p) => p.key === a)!.unread, 0);
    assert.equal((await listPeers(client, c1, a)).find((p) => p.key === b)!.unread, 1);

    // عزل الفروع والحماية
    await assert.rejects(() => sendMessage(client, c1, a, other, 'x'), /غير موجود/);
    await assert.rejects(() => sendMessage(client, c1, a, inactive, 'x'), /غير موجود/);
    await assert.rejects(() => sendMessage(client, c1, a, a, 'x'), /النفس/);
    await assert.rejects(() => sendMessage(client, c1, a, b, '   '), /فارغة/);
    await assert.rejects(() => sendMessage(client, c1, a, b, 'ط'.repeat(2001)), /2000/);
    // غرفة فرع آخر منفصلة
    await sendMessage(client, c2, other, 'room', 'فرع آخر');
    assert.equal((await listMessages(client, c1, a, 'room')).some((m) => m.body === 'فرع آخر'), false);
    assert.equal((await listMessages(client, c2, other, 'room')).length, 1);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
