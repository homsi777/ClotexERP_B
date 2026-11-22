import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('إرسالية إنشاء مادة جديدة + أنواع الإرساليات (هجرة 192)', {
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
    const schema = 'slp_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const { createItemCreationSlip, listDispatchSlips, getDispatchSlipWithLines } = await import('./intakeDispatchSlipService.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const c1 = randomUUID(), c2 = randomUUID(), wh = randomUUID(), item = randomUUID(), color = randomUUID(), user = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'A','a'),($2,'B','b')", [c1, c2]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$2,'u','x','admin')", [user, c1]);
    await q("INSERT INTO warehouses(id,company_id,code,name) VALUES ($1,$2,'W','المخزن')", [wh, c1]);
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'I1','قماش')", [item, c1]);
    await q("INSERT INTO fabric_colors(id,name_ar,color_code) VALUES ($1,'أبيض','V1')", [color]);
    const rolls: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const id = randomUUID();
      rolls.push(id);
      await q("INSERT INTO fabric_rolls(id,company_id,barcode,item_id,color_id,warehouse_id,length_m) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, c1, `B${i}`, item, color, wh, 100 + i]);
    }

    const slip = await createItemCreationSlip(client, { companyId: c1, userId: user, rollIds: rolls });
    assert.equal(slip.lineCount, 3);
    assert.match(slip.slipNo, /^DS/);
    const row = (await q('SELECT slip_type, supplier_id, intake_operation_id, external_job_id FROM intake_dispatch_slips WHERE id=$1', [slip.id]))[0];
    assert.equal(row.slip_type, 'ITEM_CREATION');
    assert.equal(row.supplier_id, null);
    assert.equal(row.intake_operation_id, null);

    // تظهر بالقائمة (بلا مورد) وبتفاصيلها وأتوابها
    const list = await listDispatchSlips(client as never, c1);
    const found = list.find((s) => s.id === slip.id)!;
    assert.equal(found.order_no, 'إنشاء مادة');
    assert.equal(Number(found.line_count), 3);
    assert.equal(found.supplier_name, null);
    const detail = await getDispatchSlipWithLines(client as never, c1, slip.id);
    assert.deepEqual(detail!.lines.map((l) => l.barcode), ['B1', 'B2', 'B3']);
    assert.equal((await listDispatchSlips(client as never, c2)).length, 0, 'عزل الفروع');

    // حماية: أتواب فرع آخر / فارغ مرفوض
    await assert.rejects(() => createItemCreationSlip(client, { companyId: c2, userId: null, rollIds: rolls }), /غير موجودة/);
    await assert.rejects(() => createItemCreationSlip(client, { companyId: c1, userId: user, rollIds: [] }), /لا أتواب/);

    // قيد النوع: أنواع غير معروفة مرفوضة، وبلا مصدر لا يُقبل إلا ITEM_CREATION
    for (const [no, type] of [['X1', 'BOGUS'], ['X2', 'STOCK']] as const) {
      await q('SAVEPOINT sp');
      await assert.rejects(() => q(`INSERT INTO intake_dispatch_slips(company_id,slip_no,slip_type,warehouse_id) VALUES ($1,$2,$3,$4)`, [c1, no, type, wh]));
      await q('ROLLBACK TO SAVEPOINT sp');
    }
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
