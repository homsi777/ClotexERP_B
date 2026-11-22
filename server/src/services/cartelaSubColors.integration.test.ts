import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('الألوان الأخرى لنفس الخامة تُضاف كألوان فرعية داخل الكارتيلة لا ككارتيلات منفردة', {
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
    const schema = 'sub_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const { listSiblingColors, cloneCartelaToSiblings } = await import('./cartelaSiblingService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const company = randomUUID(), item = randomUUID(), item2 = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'SUB','sub test')", [company]);
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name,design_code) VALUES ($1,$3,'I-1','SIMLI PARIS','5114'),($2,$3,'I-2','SIMLI PARIS B','5114')", [item, item2, company]);
    const colors = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await q(
      `INSERT INTO fabric_colors(id,name_ar,color_code) VALUES ($1,'لبني','V2'),($2,'بيج','V3'),($3,'اسود','bad code!'),($4,'خط ابيض','V2')`,
      colors,
    );
    const variants = colors.map(() => randomUUID());
    await q(
      `INSERT INTO fabric_item_variants(id,company_id,item_id,color_id,variant_code) VALUES
       ($1,$5,$6,$2,'VC-1'),($3,$5,$6,$4,'VC-2')`,
      [variants[0], colors[0], variants[1], colors[1], company, item],
    );
    await q(
      `INSERT INTO fabric_item_variants(id,company_id,item_id,color_id,variant_code) VALUES ($1,$3,$4,$2,'VC-3'),($5,$3,$4,$6,'VC-4')`,
      [variants[2], colors[2], company, item2, randomUUID(), colors[3]],
    );
    // الكارتيلة المصدر: مرتبطة بالخامة الأولى ولونها لبني (فاريانت 0)
    const cartela = randomUUID();
    await q(
      `INSERT INTO cartela_labels(id,company_id,title,art_code,serial_no,fabric_item_id,fabric_variant_id) VALUES ($1,$2,'SIMLI','5114','S100',$3,$4)`,
      [cartela, company, item, variants[0]],
    );
    const before = (await q('SELECT count(*)::int n FROM cartela_labels'))[0].n;

    const cands = await listSiblingColors(client, company, cartela);
    assert.equal(cands.linked, true);
    assert.deepEqual(cands.candidates.map((c) => c.colorName).sort(), ['اسود', 'بيج', 'خط ابيض'].sort());

    const picks = cands.candidates.map((c) => ({ itemId: c.itemId, colorId: c.colorId }));
    const out = await cloneCartelaToSiblings(client, company, null, cartela, picks);
    assert.equal(out.failed.length, 0, JSON.stringify(out.failed));
    assert.equal(out.created.length, 3);

    // لم تُنشأ كارتيلات جديدة، والألوان صارت فرعية بالكارتيلة نفسها
    assert.equal((await q('SELECT count(*)::int n FROM cartela_labels'))[0].n, before);
    const subs = await q('SELECT color_no, color_code, barcode_code, name_ar, fabric_color_id FROM cartela_label_colors WHERE cartela_label_id = $1 ORDER BY color_no', [cartela]);
    assert.equal(subs.length, 3);
    for (const s of subs) assert.equal(s.barcode_code, `S100-${s.color_code}`);
    const byName = Object.fromEntries(subs.map((s) => [s.name_ar, s]));
    assert.equal(byName['بيج'].color_code, 'V3', 'كود لون الخامة الصالح يُستعمل');
    assert.match(byName['اسود'].color_code, /^C-\d\d$/, 'كود غير صالح ← C-NN');
    assert.match(byName['خط ابيض'].color_code, /^V2$|^C-\d\d$/);
    assert.equal(new Set(subs.map((s) => s.color_code)).size, 3, 'لا تكرار لكود لون بالكارتيلة');

    // لا يظهر مرشحاً بعد الإضافة، وإعادة الإضافة تُرفض لا تُكرَّر
    assert.equal((await listSiblingColors(client, company, cartela)).candidates.length, 0);
    const again = await cloneCartelaToSiblings(client, company, null, cartela, picks);
    assert.equal(again.created.length, 0);
    assert.equal(again.failed.length, picks.length);
    assert.equal((await q('SELECT count(*)::int n FROM cartela_label_colors WHERE cartela_label_id = $1', [cartela]))[0].n, 3);

    // كارتيلة بلا رقم تسلسلي لا تقبل ألواناً
    const noSerial = randomUUID();
    await q(`INSERT INTO cartela_labels(id,company_id,title,art_code,serial_no,fabric_item_id) VALUES ($1,$2,'X','5114','',$3)`, [noSerial, company, item]);
    await assert.rejects(() => cloneCartelaToSiblings(client, company, null, noSerial, picks.slice(0, 1)), /رقم تسلسلي/);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
