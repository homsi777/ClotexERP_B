import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import * as XLSX from 'xlsx';
import { archiveSpecCard, createSpecCard, getSpecCard, listSpecCards, parseSpecCardWorkbook, updateSpecCard } from './specCardService.js';

test('spec cards library: optional link, list/search/sort, edit, workbook parse keeps numbers, archive, branch isolation, no stock effect', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.port, '55483');
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'spc_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) await db.query(await readFile(new URL(file, dir), 'utf8'));
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
    const c1 = randomUUID(), c2 = randomUUID(), u = randomUUID(), item = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'A','a'),($2,'B','b')", [c1, c2]);
    await q("INSERT INTO users(id,company_id,username,password_hash,role) VALUES ($1,$2,'u','x','admin')", [u, c1]);
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$2,'POP-1','POPLIN مطبوع')", [item, c1]);
    const movBefore = (await q('SELECT count(*)::int n FROM inventory_movements'))[0].n;

    // بطاقة بلا ربط
    const a = await createSpecCard(db, c1, u, { materialName: 'بوبلين', materialCode: '5114' });
    assert.equal(a.fabric_item_id, null);
    // بطاقة مرتبطة
    const b = await createSpecCard(db, c1, u, { materialName: 'ساده', materialCode: '4001', fabricItemId: item, notes: 'ملاحظة' });
    assert.equal(b.fabric_item_name, 'POPLIN مطبوع');
    // ربط بخامة غير موجودة / من فرع آخر
    await assert.rejects(() => createSpecCard(db, c1, u, { materialName: 'x', materialCode: 'y', fabricItemId: randomUUID() }), /غير موجودة في دليل الخامات/);
    await assert.rejects(() => createSpecCard(db, c1, u, { materialName: '  ', materialCode: 'y' }), /اسم الخامة/);

    // بحث وفرز
    assert.equal((await listSpecCards(db, c1, {})).length, 2);
    assert.deepEqual((await listSpecCards(db, c1, { search: '4001' })).map((r) => r.material_code), ['4001']);
    assert.deepEqual((await listSpecCards(db, c1, { search: 'POP-1' })).map((r) => r.material_code), ['4001'], 'البحث يشمل كود الخامة المرتبطة');
    assert.deepEqual((await listSpecCards(db, c1, { sort: 'material_code', dir: 'desc' })).map((r) => r.material_code), ['5114', '4001']);
    assert.equal((await listSpecCards(db, c2, {})).length, 0, 'معزول حسب الفرع');
    assert.equal(await getSpecCard(db, c2, a.id), null);

    // ملف Excel: الأرقام كما هي (0.59) والدمج يُحفظ
    const ws: XLSX.WorkSheet = { A1: { t: 's', v: 'التركيب' }, B2: { t: 'n', v: 0.59 }, '!ref': 'A1:B2', '!merges': [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ورقة1');
    const b64 = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })).toString('base64');
    const parsed = parseSpecCardWorkbook(b64);
    assert.equal(parsed.sheets.length, 1);
    assert.equal(parsed.sheets[0].cells.find((c) => c.address === 'B2')?.value, 0.59);
    assert.equal(parsed.sheets[0].merges.length, 1);
    assert.throws(() => parseSpecCardWorkbook('not base64 !!'), /ملف غير صالح/);

    // تعديل المحتوى والربط (إزالة ثم إعادة)
    const upd = await updateSpecCard(db, c1, u, a.id, { materialCode: '5115', fabricItemId: item, sheets: parsed.sheets, sourceFileName: 'spec.xlsx' });
    assert.equal(upd.material_code, '5115');
    assert.equal(upd.sheets[0].cells.find((c: { address: string }) => c.address === 'B2').value, 0.59);
    const unlinked = await updateSpecCard(db, c1, u, a.id, { fabricItemId: null });
    assert.equal(unlinked.fabric_item_id, null);
    assert.equal(unlinked.material_name, 'بوبلين', 'التعديل الجزئي لا يمسّ الباقي');
    await assert.rejects(() => updateSpecCard(db, c2, u, a.id, { materialName: 'اختراق' }), /غير موجودة/);

    // إخفاء
    assert.equal(await archiveSpecCard(db, c1, u, b.id), true);
    assert.equal((await listSpecCards(db, c1, {})).length, 1);
    assert.equal(await archiveSpecCard(db, c1, u, b.id), false);

    // لا حركات مخزون
    assert.equal((await q('SELECT count(*)::int n FROM inventory_movements'))[0].n, movBefore);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
