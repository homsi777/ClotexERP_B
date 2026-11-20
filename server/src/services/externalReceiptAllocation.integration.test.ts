import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

// Explicit opt-in, loopback only (same guard as the other manufacturing integration tests).
test('external receipt by total quantity: automatic allocation, split rolls, auto settlement, sheet fields, close', {
  skip: process.env.CLOTEX_MANUFACTURING_LOCAL_TESTS !== '1',
}, async () => {
  const url = new URL(process.env.CLOTEX_MANUFACTURING_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55483');
  assert.equal(url.pathname, '/clotex_manufacturing_test');
  assert.equal(url.search, '');
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
  await db.connect();
  try {
    await db.query('BEGIN');
    const schema = 'ext_alloc_' + randomUUID().replaceAll('-', '');
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      try { await db.query(await readFile(new URL(file, dir), 'utf8')); }
      catch (error) { throw new Error(`Migration ${file} failed`, { cause: error }); }
    }
    const { createProcessingExternalJob } = await import('./externalJobService.js');
    const { receiveManufacturingBatch, settleManufacturingShortage, closeManufacturingJob, manufacturingOverview, completeManufacturingInventory, reopenManufacturingInventory } = await import('./externalManufacturingLifecycle.js');
    const client = db as unknown as import('pg').PoolClient;
    const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;

    const company = randomUUID(), user = randomUUID(), supplier = randomUUID(), prep = randomUUID(), wh = randomUUID(), whOut = randomUUID();
    const itemA = randomUUID(), itemB = randomUUID();
    await q("INSERT INTO companies(id,code,name) VALUES ($1,'ALLOC','alloc test')", [company]);
    await q("INSERT INTO users(id,company_id,username,password_hash) VALUES ($1,$2,'alloc-user','unused')", [user, company]);
    await q("INSERT INTO suppliers(id,company_id,code,name,is_processing_party) VALUES ($1,$2,'DYE','Dye house',true)", [supplier, company]);
    await q("INSERT INTO external_job_preparation_types(id,company_id,name) VALUES ($1,$2,'Dyeing')", [prep, company]);
    await q("INSERT INTO warehouses(id,company_id,code,name,fabric_stage) VALUES ($1,$2,'RAW','Raw','RAW'),($3,$2,'OUT','Out',NULL)", [wh, company, whOut]);
    await q("INSERT INTO fabric_items(id,company_id,internal_code,name) VALUES ($1,$3,'ITEM-A','A'),($2,$3,'ITEM-B','B')", [itemA, itemB, company]);
    await q("INSERT INTO currencies(code,name,symbol,is_active) VALUES ('USD','USD','$',true) ON CONFLICT (code) DO NOTHING");
    const roll = async (barcode: string, item: string, len: number, cost: number) => (await q(
      `INSERT INTO fabric_rolls(company_id,barcode,item_id,warehouse_id,length_m,unit_cost,currency_code,status)
       VALUES ($1,$2,$3,$4,$5,$6,'USD','AVAILABLE') RETURNING id`, [company, barcode, item, wh, len, cost]))[0].id as string;
    const rolls = [await roll('S1', itemA, 100, 5), await roll('S2', itemA, 100, 5), await roll('S3', itemA, 100, 7)];

    // 1) إنشاء المهمة مع حقول الورقة (العرض/الوزن خام ومحضّر)
    const job = await createProcessingExternalJob(client, company, user, {
      supplierId: supplier, fabricStage: 'RAW', preparationTypeId: prep, sourceWarehouseId: wh, rollIds: rolls,
      rawWidthCm: 170, finishedWidthCm: 160, rawGsm: 120, finishedGsm: 130,
    });
    const jobRow = (await q('SELECT raw_width_cm,finished_width_cm,raw_gsm,finished_gsm FROM external_jobs WHERE id=$1', [job.id]))[0];
    assert.deepEqual([jobRow.raw_width_cm, jobRow.finished_width_cm, jobRow.raw_gsm, jobRow.finished_gsm].map(Number), [170, 160, 120, 130]);

    // 2) استلام دفعة بلا اختيار بكرة: أربعة رولات 74م (ثلاثة تتسع في بند، والرابع يُقسَّم على الثلاثة)
    const rcv = (lines: object[], paper = 'DP-1', requestId = randomUUID()) =>
      receiveManufacturingBatch(client, company, user, job.id, {
        requestId, dyePaperNo: paper, destinationWarehouseId: whOut, completedServiceIds: [], attachments: [],
        lines,
      });
    await rcv([{ lengthM: 74 }, { lengthM: 74 }, { lengthM: 74 }, { lengthM: 74 }]);
    const ov = await manufacturingOverview(client, company, job.id);
    const byBarcode = new Map(ov.lines.map((l: { sent_barcode: string; returned_m: string }) => [l.sent_barcode, Number(l.returned_m)]));
    assert.deepEqual([byBarcode.get('S1'), byBarcode.get('S2'), byBarcode.get('S3')], [100, 100, 96], 'allocation fills lines in order, first-fit then split');
    assert.equal((await q('SELECT count(*)::int n FROM external_job_return_lines WHERE job_id=$1', [job.id]))[0].n, 4, 'one return line (one physical roll) per returned roll');
    assert.equal((await q('SELECT count(*)::int n FROM external_job_return_allocations WHERE job_id=$1', [job.id]))[0].n, 6, 'three whole + one roll split across three lines');
    assert.equal((await q('SELECT count(*)::int n FROM external_job_return_sources WHERE job_id=$1', [job.id]))[0].n, 6, 'genealogy view exposes every contributing source');
    // الرول الراجع الأول يرث العرض/الوزن المحضّر من الورقة
    const first = (await q(`SELECT r.width_cm,r.gsm,r.status FROM external_job_return_lines q JOIN fabric_rolls r ON r.id=q.result_roll_id
      WHERE q.job_id=$1 ORDER BY r.created_at,r.id LIMIT 1`, [job.id]))[0];
    assert.deepEqual([Number(first.width_cm), Number(first.gsm), first.status], [160, 130, 'AVAILABLE']);
    // تكلفة الرول المقسوم = متوسط مرجّح بالأمتار (26×5 + 26×5 + 22×7)/74
    const splitCost = (await q(`SELECT r.unit_cost FROM external_job_return_lines q JOIN fabric_rolls r ON r.id=q.result_roll_id
      JOIN external_job_return_allocations a ON a.return_line_id=q.id WHERE q.job_id=$1 GROUP BY r.id,r.unit_cost HAVING count(*)=3`, [job.id]))[0];
    assert.equal(Number(splitCost.unit_cost), Math.round(((26 * 5 + 26 * 5 + 22 * 7) / 74) * 10000) / 10000);
    // أرصدة الرولات الأصلية بالخارج تتبع الكمية المتبقية (S3 فقط بقي 4م)
    const left = new Map((await q('SELECT barcode,length_m FROM fabric_rolls WHERE id = ANY($1::uuid[])', [rolls])).map((r) => [r.barcode, Number(r.length_m)]));
    assert.deepEqual([left.get('S1'), left.get('S2'), left.get('S3')], [0, 0, 4]);

    // 3) تجاوز الكمية الإجمالية المتبقية مرفوض (المتبقي 4م)
    await assert.rejects(() => rcv([{ lengthM: 5 }], 'DP-2'), /الكمية تتجاوز المتبقي/);

    // المحاسب لا يسوّي قبل أن ينهي المخزن الاستلام؛ وبعد الإنهاء لا تُقبل دفعات جديدة إلا بإعادة الفتح
    await assert.rejects(() => settleManufacturingShortage(client, company, user, job.id, { amountM: 4, reason: 'early' }), /أنهِ الاستلام المخزوني/);
    await completeManufacturingInventory(client, company, user, job.id);
    await assert.rejects(() => rcv([{ lengthM: 1 }], 'DP-3'), /انتهى الاستلام المخزوني/);
    await reopenManufacturingInventory(client, company, user, job.id);
    await completeManufacturingInventory(client, company, user, job.id);

    // 4) تسوية نقص بلا اختيار بند: تُوزَّع تلقائياً على الفرق غير المحسوم، ثم الإغلاق
    await assert.rejects(() => settleManufacturingShortage(client, company, user, job.id, { amountM: 4.001, reason: 'too much' }), /النقص يتجاوز الفرق/);
    await settleManufacturingShortage(client, company, user, job.id, { amountM: 4, reason: 'Approved process shrinkage', reasonCategory: 'WASTE' });
    // التسوية مرتبطة بشاشة «تسوية إرساليات المصنعية»: اعتماد نقص مسجَّل ومتطابق على سطر المهمة
    const linked = await q(`SELECT m.match_type,m.matched_length_m,l.matched_length_m AS line_matched,l.sent_barcode FROM external_job_line_matches m
      JOIN external_job_lines l ON l.id=m.external_job_line_id WHERE l.job_id=$1`, [job.id]);
    assert.deepEqual(linked.map((r) => [r.match_type, Number(r.matched_length_m), Number(r.line_matched), r.sent_barcode]), [['LIFECYCLE_SETTLEMENT', 4, 4, 'S3']]);
    assert.equal((await q('SELECT reason_category FROM external_job_settlements WHERE job_id=$1', [job.id]))[0].reason_category, 'WASTE');
    // إرسالية مخزون بالمستلم (4 رولات) تظهر في إرساليات المخزون والشراء
    const slip = await q(`SELECT s.slip_type,s.intake_operation_id,(SELECT count(*)::int FROM intake_dispatch_slip_lines l WHERE l.slip_id=s.id) AS n
      FROM intake_dispatch_slips s WHERE s.external_job_id=$1`, [job.id]);
    assert.deepEqual(slip.map((r) => [r.slip_type, r.intake_operation_id, r.n]), [['STOCK', null, 4]]);
    const settled = await q('SELECT s.amount_m,l.sent_barcode FROM external_job_settlements s JOIN external_job_lines l ON l.id=s.source_line_id WHERE s.job_id=$1', [job.id]);
    assert.deepEqual(settled.map((r) => [r.sent_barcode, Number(r.amount_m)]), [['S3', 4]]);
    await closeManufacturingJob(client, company, job.id);
    assert.ok((await q('SELECT lifecycle_closed_at FROM external_jobs WHERE id=$1', [job.id]))[0].lifecycle_closed_at);
    assert.equal((await q("SELECT count(*)::int n FROM fabric_rolls WHERE id = ANY($1::uuid[]) AND status='INACTIVE'", [rolls]))[0].n, 3);

    // 5) مهمة بخامتين: بلا تحديد الخامة يُرفض (لا دمج خامتين)، ومع itemId ينجح
    const rb = [await roll('B1', itemA, 50, 5), await roll('B2', itemB, 50, 5)];
    const job2 = await createProcessingExternalJob(client, company, user, {
      supplierId: supplier, fabricStage: 'RAW', preparationTypeId: prep, sourceWarehouseId: wh, rollIds: rb,
    });
    const rcv2 = (lines: object[]) => receiveManufacturingBatch(client, company, user, job2.id, {
      requestId: randomUUID(), dyePaperNo: 'DP-9', destinationWarehouseId: whOut, completedServiceIds: [], attachments: [], lines,
    });
    await assert.rejects(() => rcv2([{ lengthM: 40 }]), /حدد الخامة/);
    await rcv2([{ lengthM: 40, itemId: itemB }]);
    const b2 = (await q(`SELECT l.sent_barcode FROM external_job_return_allocations a JOIN external_job_lines l ON l.id=a.source_line_id WHERE a.job_id=$1`, [job2.id]));
    assert.deepEqual(b2.map((r) => r.sent_barcode), ['B2']);
    // الفرض الصريح لبند بعينه ما زال مدعوماً (توافق مع الاستدعاءات القديمة)
    const line1 = (await q("SELECT id FROM external_job_lines WHERE job_id=$1 AND sent_barcode='B1'", [job2.id]))[0].id;
    await rcv2([{ lengthM: 10, sourceLineId: line1 }]);
    const done = new Map((await manufacturingOverview(client, company, job2.id)).lines.map((l: { sent_barcode: string; returned_m: string }) => [l.sent_barcode, Number(l.returned_m)]));
    assert.deepEqual([done.get('B1'), done.get('B2')], [10, 40]);
    // الخامة الراجعة من شجرة التصنيف قد تختلف عن المرسلة (بوبلين ← شامريه)
    await rcv2([{ lengthM: 5, sourceLineId: line1, resultItemId: itemB }]);
    const diff = (await q(`SELECT r.item_id FROM external_job_return_lines q JOIN fabric_rolls r ON r.id=q.result_roll_id
      WHERE q.job_id=$1 AND q.length_m=5`, [job2.id]));
    assert.deepEqual(diff.map((r) => r.item_id), [itemB]);
    await assert.rejects(() => rcv2([{ lengthM: 1, sourceLineId: line1, resultItemId: randomUUID() }]), /الخامة غير صالحة/);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
