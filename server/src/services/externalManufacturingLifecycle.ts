import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { generateBarcode, calcWeight } from '../utils/rollHelpers.js';
import { findOrCreateColor } from './purchaseInvoiceService.js';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';

type Db = Pick<PoolClient, 'query'>;
const fail = (message: string, code = 'VALIDATION'): never => { throw Object.assign(new Error(message), { code }); };
const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(2000);
const amount = z.coerce.number().finite().positive().max(999999999).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.0001, 'الدقة القصوى ثلاثة منازل');
const optionalAmount = amount.nullable().optional();
const milli = (n: unknown) => Math.round(Number(n || 0) * 1000);
const serviceInput = z.object({ name: text, quantity: amount, basis: z.enum(['METER', 'KG', 'FIXED']) }).strict();

// Keep only the outstanding physical quantity on the non-available source roll;
// immutable sent_* snapshots retain its original dispatch identity and quantities.
async function syncManufacturingSourceBalances(db: Db, companyId: string, userId: string, jobId: string) {
  const lines = (await db.query(`SELECT l.*,r.length_m,r.actual_weight_kg,r.width_cm,r.gsm,
    COALESCE((SELECT SUM(q.length_m) FROM external_job_return_lines q WHERE q.source_line_id=l.id AND q.company_id=l.company_id),0) AS returned,
    COALESCE((SELECT SUM(s.amount_m) FROM external_job_settlements s WHERE s.source_line_id=l.id AND s.company_id=l.company_id AND s.kind='SHORTAGE'),0) AS shortage
    FROM external_job_lines l JOIN fabric_rolls r ON r.id=l.roll_id AND r.company_id=l.company_id
    WHERE l.job_id=$1 AND l.company_id=$2 AND l.line_status='SENT' AND r.status='AT_EXTERNAL_JOB' ORDER BY r.id FOR UPDATE OF r`, [jobId, companyId])).rows;
  for (const l of lines) {
    const length = Math.max(0, milli(l.sent_length_m) - milli(l.returned) - milli(l.shortage)) / 1000;
    const delta = (milli(length) - milli(l.length_m)) / 1000;
    if (!delta) continue;
    const weight = l.actual_weight_kg == null ? null : Number(l.length_m) > 0
      ? Math.round(Number(l.actual_weight_kg) * length / Number(l.length_m) * 1000) / 1000 : 0;
    await db.query(`UPDATE fabric_rolls SET length_m=$3,actual_weight_kg=$4,calculated_weight_kg=$5,updated_at=now() WHERE id=$1 AND company_id=$2`,
      [l.roll_id, companyId, length, weight, calcWeight(length, l.width_cm == null ? null : Number(l.width_cm), l.gsm == null ? null : Number(l.gsm))]);
    await db.query(`INSERT INTO inventory_movements(company_id,roll_id,movement_type,old_status,new_status,length_delta_m,reference_type,reference_id,notes,created_by_user_id)
      VALUES($1,$2,'ADJUSTMENT','AT_EXTERNAL_JOB','AT_EXTERNAL_JOB',$3,'EXTERNAL_JOB_RETURN_BALANCE',$4,'تحديث المتبقي خارجياً بعد الاستلام أو التسوية',$5)`,
      [companyId, l.roll_id, delta, jobId, userId]);
  }
}

export async function lockManufacturingJob(db: Db, companyId: string, jobId: string) {
  uuid.parse(jobId);
  const r = await db.query('SELECT * FROM external_jobs WHERE company_id=$1 AND id=$2 FOR UPDATE', [companyId, jobId]);
  const job = r.rows[0];
  if (!job) fail('المهمة غير موجودة', 'NOT_FOUND');
  if (job.job_kind !== 'PROCESSING' || job.document_status !== 'CONFIRMED') fail('يلزم مهمة مصنعية مؤكدة');
  return job;
}

export async function assertNoLifecycleReturns(db: Db, companyId: string, jobId: string) {
  const r = await db.query(`SELECT 1 FROM external_job_return_batches WHERE company_id=$1 AND job_id=$2
    UNION ALL SELECT 1 FROM external_job_settlements WHERE company_id=$1 AND job_id=$2 LIMIT 1`, [companyId, jobId]);
  if (r.rows.length) fail('بدأ استلام هذه المهمة على دفعات؛ استخدم مسار استلام المصنعية', 'INVALID_STATE');
}

export async function assertLegacyReceiptAllowed(db: Db, companyId: string, jobId: string) {
  await assertNoLifecycleReturns(db, companyId, jobId);
  if ((await db.query('SELECT 1 FROM external_job_services WHERE company_id=$1 AND job_id=$2 LIMIT 1', [companyId, jobId])).rows.length) fail('استخدم استلام المصنعية على دفعات لهذه المهمة', 'INVALID_STATE');
}

async function assertNewReceiptMode(db: Db, companyId: string, jobId: string) {
  const old = await db.query(`SELECT 1 FROM external_job_receipts WHERE company_id=$1 AND job_id=$2
    UNION ALL SELECT 1 FROM external_job_lines WHERE company_id=$1 AND job_id=$2 AND line_status='RECEIVED' LIMIT 1`, [companyId, jobId]);
  if (old.rows.length) fail('لهذه المهمة استلام بالنظام السابق؛ يلزم مراجعته وترحيله يدوياً قبل استخدام الدفعات', 'INVALID_STATE');
}

async function captureManufacturingSnapshots(db: Db, companyId: string, jobId: string) {
  await db.query(`UPDATE external_job_lines l SET sent_weight_kg=COALESCE(l.sent_weight_kg,r.actual_weight_kg,r.calculated_weight_kg),
    sent_unit_cost=COALESCE(l.sent_unit_cost,r.unit_cost), sent_currency_code=COALESCE(l.sent_currency_code,r.currency_code),
    sent_warehouse_id=COALESCE(l.sent_warehouse_id,r.warehouse_id),sent_item_id=COALESCE(l.sent_item_id,r.item_id),
    sent_width_cm=COALESCE(l.sent_width_cm,r.width_cm),sent_gsm=COALESCE(l.sent_gsm,r.gsm),sent_roll_no=COALESCE(l.sent_roll_no,r.roll_no)
    FROM fabric_rolls r WHERE l.job_id=$1 AND l.company_id=$2 AND r.id=l.roll_id AND r.company_id=l.company_id
    AND NOT EXISTS(SELECT 1 FROM external_job_return_batches b WHERE b.job_id=l.job_id AND b.company_id=l.company_id)
    AND NOT EXISTS(SELECT 1 FROM external_job_settlements s WHERE s.job_id=l.job_id AND s.company_id=l.company_id)`, [jobId, companyId]);
}

export async function initializeManufacturing(db: Db, companyId: string, jobId: string, raw: unknown) {
  const input = z.object({ services: z.array(serviceInput).max(30).optional(), previousJobId: uuid.nullable().optional() }).parse(raw);
  if (input.previousJobId) {
    const p = await db.query(`SELECT 1 FROM external_jobs WHERE id=$1 AND company_id=$2 AND job_kind='PROCESSING' AND document_status='CONFIRMED'`, [input.previousJobId, companyId]);
    if (!p.rows.length || input.previousJobId === jobId) fail('المهمة السابقة غير صالحة');
    const linked = await db.query(`SELECT 1 FROM external_job_lines l JOIN external_job_return_lines r ON r.result_roll_id=l.roll_id AND r.company_id=l.company_id
      WHERE l.job_id=$1 AND l.company_id=$2 AND r.job_id=$3 LIMIT 1`, [jobId, companyId, input.previousJobId]);
    if (!linked.rows.length) fail('يجب أن تتضمن المرحلة التالية رولة راجعة من المهمة السابقة');
    await db.query('UPDATE external_jobs SET previous_job_id=$3 WHERE id=$1 AND company_id=$2', [jobId, companyId, input.previousJobId]);
  }
  await captureManufacturingSnapshots(db, companyId, jobId);
  const services = input.services?.length ? input.services : (await db.query(`SELECT COALESCE(p.name,'مصنعية') AS name,
    (SELECT SUM(sent_length_m) FROM external_job_lines WHERE job_id=j.id AND company_id=j.company_id) AS quantity
    FROM external_jobs j LEFT JOIN external_job_preparation_types p ON p.id=j.preparation_type_id AND p.company_id=j.company_id
    WHERE j.id=$1 AND j.company_id=$2`, [jobId, companyId])).rows.map(s => ({ name: s.name, quantity: Number(s.quantity), basis: 'METER' }));
  for (const s of services) await db.query(`INSERT INTO external_job_services(company_id,job_id,name,quantity,basis) VALUES($1,$2,$3,$4,$5)`, [companyId, jobId, s.name, s.quantity, s.basis]);
}

export async function replaceManufacturingServices(db: Db, companyId: string, jobId: string, raw: unknown) {
  const input = z.object({ services: z.array(serviceInput).min(1).max(30) }).strict().parse(raw);
  const job = await lockManufacturingJob(db, companyId, jobId);
  if (job.fee_amount !== null || job.fee_posted_at || job.lifecycle_closed_at) fail('لا يمكن تغيير الخدمات بعد التسعير أو الإغلاق');
  await assertNoLifecycleReturns(db, companyId, jobId);
  await assertNewReceiptMode(db, companyId, jobId);
  await db.query('DELETE FROM external_job_services WHERE job_id=$1 AND company_id=$2', [jobId, companyId]);
  for (const s of input.services) await db.query('INSERT INTO external_job_services(company_id,job_id,name,quantity,basis) VALUES($1,$2,$3,$4,$5)', [companyId, jobId, s.name, s.quantity, s.basis]);
}

export async function assertLegacyPricing(db: Db, companyId: string, jobId: string) {
  await db.query('SELECT id FROM external_jobs WHERE company_id=$1 AND id=$2 FOR UPDATE', [companyId, jobId]);
  if ((await db.query('SELECT 1 FROM external_job_services WHERE company_id=$1 AND job_id=$2 LIMIT 1', [companyId, jobId])).rows.length) fail('استخدم تبويب تسعير خدمات المصنعية؛ الأجرة المتفق عليها مرتبطة به', 'INVALID_STATE');
}

export async function manufacturingOverview(db: Db, companyId: string, jobId: string) {
  uuid.parse(jobId);
  const job = (await db.query(`SELECT j.*,s.name AS supplier_name,p.name AS preparation_type_name FROM external_jobs j
    JOIN suppliers s ON s.id=j.supplier_id AND s.company_id=j.company_id
    LEFT JOIN external_job_preparation_types p ON p.id=j.preparation_type_id AND p.company_id=j.company_id
    WHERE j.id=$1 AND j.company_id=$2 AND j.job_kind='PROCESSING'`, [jobId, companyId])).rows[0];
  if (!job) fail('المهمة غير موجودة', 'NOT_FOUND');
  const lines = (await db.query(`SELECT l.*,r.barcode,COALESCE(l.sent_roll_no,r.roll_no) AS roll_no,r.item_id,r.color_id,
    COALESCE(l.sent_width_cm,r.width_cm) AS width_cm,COALESCE(l.sent_gsm,r.gsm) AS gsm,
    COALESCE(l.sent_weight_kg,r.actual_weight_kg,r.calculated_weight_kg) AS sent_weight_display,
    i.name AS item_name,i.internal_code,c.name_ar AS color_name,
    COALESCE((SELECT SUM(x.length_m) FROM external_job_return_lines x WHERE x.source_line_id=l.id AND x.company_id=l.company_id),0) AS returned_m,
    COALESCE((SELECT SUM(x.amount_m) FROM external_job_settlements x WHERE x.source_line_id=l.id AND x.company_id=l.company_id AND x.kind='SHORTAGE'),0) AS shortage_m,
    COALESCE((SELECT SUM(x.amount_m) FROM external_job_settlements x WHERE x.source_line_id=l.id AND x.company_id=l.company_id AND x.kind='EXCESS'),0) AS excess_m
    FROM external_job_lines l JOIN fabric_rolls r ON r.id=l.roll_id AND r.company_id=l.company_id
    JOIN fabric_items i ON i.id=COALESCE(l.sent_item_id,r.item_id) AND i.company_id=l.company_id
    LEFT JOIN fabric_colors c ON c.id=l.sent_color_id AND c.company_id=l.company_id
    WHERE l.job_id=$1 AND l.company_id=$2 AND l.line_status<>'CANCELLED' ORDER BY l.id`, [jobId, companyId])).rows;
  const services = (await db.query('SELECT * FROM external_job_services WHERE job_id=$1 AND company_id=$2 ORDER BY id', [jobId, companyId])).rows;
  const batches = (await db.query(`SELECT b.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'source_line_id',q.source_line_id,
    'original_barcode',q.original_barcode,'barcode',r.barcode,'length_m',q.length_m,'weight_kg',q.weight_kg,'defective',q.defective,
    'defect_reason',q.defect_reason,'responsible_party',q.responsible_party,'notes',q.notes,'resolution',q.resolution,
    'resolution_notes',q.resolution_notes,'resolved_at',q.resolved_at,'status',r.status))
    FROM external_job_return_lines q JOIN fabric_rolls r ON r.id=q.result_roll_id AND r.company_id=q.company_id
    WHERE q.batch_id=b.id AND q.company_id=b.company_id),'[]') AS lines,
    ARRAY(SELECT service_id FROM external_job_return_services WHERE batch_id=b.id) AS service_ids
    FROM external_job_return_batches b WHERE b.job_id=$1 AND b.company_id=$2 ORDER BY received_at`, [jobId, companyId])).rows;
  const settlements = (await db.query('SELECT * FROM external_job_settlements WHERE job_id=$1 AND company_id=$2 ORDER BY approved_at', [jobId, companyId])).rows;
  const legacy = (await db.query(`SELECT q.*,r.barcode AS result_roll_barcode,w.name AS destination_warehouse_name
    FROM external_job_receipts q LEFT JOIN fabric_rolls r ON r.id=q.result_roll_id AND r.company_id=q.company_id
    LEFT JOIN warehouses w ON w.id=q.destination_warehouse_id AND w.company_id=q.company_id
    WHERE q.job_id=$1 AND q.company_id=$2`, [jobId, companyId])).rows;
  const legacyMode = !!legacy.length || (!batches.length && !settlements.length && lines.some(l => l.line_status === 'RECEIVED'));
  // Read-only projection: never allocate a historic aggregate receipt to individual rolls.
  const displayLines = legacyMode && !legacy.length ? lines.map(l => ({ ...l,
    returned_m: l.line_status === 'RECEIVED' ? l.new_length_m ?? l.sent_length_m ?? '0' : '0',
  })) : lines;
  return { job, lines: displayLines, services, batches, settlements, legacy, legacyMode };
}

const returnSchema = z.object({
  requestId: uuid, dyePaperNo: text, notes: text.optional(),
  attachments: z.array(z.string().max(1000).refine(v => /^https:\/\//i.test(v) || /^\/uploads\//.test(v), 'رابط مرفق غير صالح')).max(10).default([]),
  destinationWarehouseId: uuid, destinationLocationId: uuid.nullable().optional(),
  completedServiceIds: z.array(uuid).max(30).default([]),
  lines: z.array(z.object({ sourceLineId: uuid, lengthM: amount, weightKg: optionalAmount,
    barcode: z.string().trim().min(1).max(200).optional(), colorId: uuid.nullable().optional(),
    colorName: z.string().trim().max(200).optional(), colorCode: z.string().trim().max(100).optional(),
    widthCm: optionalAmount, gsm: optionalAmount,
    defective: z.boolean().default(false), defectReason: z.enum(['DYE_HOUSE', 'INTERNAL_KNITTING', 'OTHER']).optional(),
    responsibleParty: text.optional(), notes: text.optional(),
  }).strict()).min(1).max(500),
}).strict();

export async function receiveManufacturingBatch(db: Db, companyId: string, userId: string, jobId: string, raw: unknown) {
  const input = returnSchema.parse(raw);
  if (new Set(input.completedServiceIds).size !== input.completedServiceIds.length) fail('تكرار الخدمة');
  const hash = createHash('sha256').update(JSON.stringify({ jobId, ...input })).digest('hex');
  // Serializes same-company request keys across jobs as well as same-job returns.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [companyId + ':' + input.requestId]);
  const job = await lockManufacturingJob(db, companyId, jobId);
  const prior = (await db.query('SELECT id,request_hash FROM external_job_return_batches WHERE company_id=$1 AND request_id=$2', [companyId, input.requestId])).rows[0];
  if (prior) { if (prior.request_hash !== hash) fail('رقم الطلب مستخدم بمحتوى مختلف', 'DUPLICATE'); return { id: prior.id, duplicate: true }; }
  if (job.lifecycle_closed_at) fail('المهمة مغلقة');
  await assertNewReceiptMode(db, companyId, jobId);
  await captureManufacturingSnapshots(db, companyId, jobId);
  const wh = await db.query('SELECT 1 FROM warehouses WHERE id=$1 AND company_id=$2 AND is_active=true FOR SHARE', [input.destinationWarehouseId, companyId]);
  if (!wh.rows.length) fail('المستودع غير صالح');
  if (input.destinationLocationId && !(await db.query('SELECT 1 FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3 AND is_active=true', [input.destinationLocationId, input.destinationWarehouseId, companyId])).rows.length) fail('موقع التخزين غير صالح');
  for (const id of input.completedServiceIds) if (!(await db.query('SELECT 1 FROM external_job_services WHERE id=$1 AND job_id=$2 AND company_id=$3', [id, jobId, companyId])).rows.length) fail('الخدمة ليست تابعة للمهمة');
  const sourceLines = (await db.query(`SELECT l.*,r.item_id,r.unit_cost,r.currency_code,r.width_cm,r.gsm,r.status AS roll_status
    FROM external_job_lines l JOIN fabric_rolls r ON r.id=l.roll_id AND r.company_id=l.company_id
    WHERE l.job_id=$1 AND l.company_id=$2 ORDER BY r.id FOR UPDATE OF l,r`, [jobId, companyId])).rows;
  const requested = new Map<string, number>();
  for (const l of input.lines) requested.set(l.sourceLineId, (requested.get(l.sourceLineId) || 0) + milli(l.lengthM));
  for (const [lineId, qty] of requested) {
    const line = sourceLines.find(l => l.id === lineId);
    if (!line || line.line_status !== 'SENT' || line.roll_status !== 'AT_EXTERNAL_JOB') fail('البند غير متاح للاستلام');
    const totals = (await db.query(`SELECT
      COALESCE((SELECT SUM(length_m) FROM external_job_return_lines WHERE company_id=$1 AND source_line_id=$2),0) AS received,
      COALESCE((SELECT SUM(CASE WHEN kind='SHORTAGE' THEN amount_m ELSE -amount_m END) FROM external_job_settlements WHERE company_id=$1 AND source_line_id=$2),0) AS settled`, [companyId, lineId])).rows[0];
    if (qty > milli(line.sent_length_m) - milli(totals.received) - milli(totals.settled)) fail('الكمية تتجاوز المتبقي؛ راجع التسويات المعتمدة');
  }
  const batch = (await db.query(`INSERT INTO external_job_return_batches(company_id,job_id,request_id,request_hash,dye_paper_no,notes,attachments,received_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [companyId, jobId, input.requestId, hash, input.dyePaperNo, input.notes || null, JSON.stringify(input.attachments), userId])).rows[0];
  for (const l of input.lines) {
    const source = sourceLines.find(s => s.id === l.sourceLineId)!;
    if (l.defective && (!l.defectReason || !l.responsibleParty)) fail('سبب العيب والجهة المسؤولة مطلوبان');
    if (l.colorId && !(await db.query('SELECT 1 FROM fabric_colors WHERE company_id=$1 AND id=$2', [companyId, l.colorId])).rows.length) fail('اللون غير صالح');
    const barcode = l.barcode || await generateBarcode(db as PoolClient, companyId);
    if ((await db.query('SELECT 1 FROM fabric_rolls WHERE company_id=$1 AND barcode=$2', [companyId, barcode])).rows.length) fail('الباركود مستخدم؛ اختر باركوداً جديداً مع الاحتفاظ بارتباطه بالأصلي', 'DUPLICATE');
    const status = l.defective ? 'RESERVED' : 'AVAILABLE';
    const colorId = l.colorName || l.colorCode ? await findOrCreateColor(db as PoolClient, companyId, l.colorName || '', l.colorCode || '') : l.colorId ?? source.sent_color_id;
    const width = l.widthCm ?? source.sent_width_cm ?? source.width_cm;
    const gsm = l.gsm ?? source.sent_gsm ?? source.gsm;
    const calculatedWeight = calcWeight(l.lengthM, width == null ? null : Number(width), gsm == null ? null : Number(gsm));
    const roll = (await db.query(`INSERT INTO fabric_rolls(company_id,item_id,color_id,supplier_id,warehouse_id,location_id,barcode,
      length_m,actual_weight_kg,width_cm,gsm,unit_cost,currency_code,status,notes,created_by_user_id,calculated_weight_kg)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`, [companyId, source.sent_item_id ?? source.item_id,
      colorId, job.supplier_id, input.destinationWarehouseId, input.destinationLocationId || null, barcode,
      l.lengthM, l.weightKg ?? null, width, gsm,
      source.sent_unit_cost ?? source.unit_cost, source.sent_currency_code ?? source.currency_code, status, l.notes || null, userId, calculatedWeight])).rows[0];
    await db.query(`INSERT INTO inventory_movements(company_id,roll_id,movement_type,to_warehouse_id,to_location_id,new_status,length_delta_m,weight_delta_kg,reference_type,reference_id,reference_no,created_by_user_id)
      VALUES($1,$2,'EXTERNAL_JOB_RETURNED',$3,$4,$5,$6,$7,'EXTERNAL_JOB_RETURN',$8,$9,$10)`, [companyId, roll.id, input.destinationWarehouseId, input.destinationLocationId || null, status, l.lengthM, l.weightKg ?? null, batch.id, job.job_no, userId]);
    await db.query(`INSERT INTO external_job_return_lines(company_id,job_id,batch_id,source_line_id,source_roll_id,original_barcode,result_roll_id,
      length_m,weight_kg,defective,defect_reason,responsible_party,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [companyId, jobId, batch.id, l.sourceLineId, source.roll_id, source.sent_barcode, roll.id, l.lengthM, l.weightKg ?? null, l.defective, l.defectReason || null, l.responsibleParty || null, l.notes || null]);
  }
  for (const serviceId of input.completedServiceIds) await db.query('INSERT INTO external_job_return_services(batch_id,service_id) VALUES($1,$2)', [batch.id, serviceId]);
  await syncManufacturingSourceBalances(db, companyId, userId, jobId);
  return { id: batch.id, duplicate: false };
}

export async function settleManufacturingShortage(db: Db, companyId: string, userId: string, jobId: string, raw: unknown) {
  const input = z.object({ sourceLineId: uuid, amountM: amount, reason: text, kind: z.enum(['SHORTAGE','EXCESS']).default('SHORTAGE') }).strict().parse(raw);
  const job = await lockManufacturingJob(db, companyId, jobId);
  if (job.lifecycle_closed_at) fail('المهمة مغلقة');
  await assertNewReceiptMode(db, companyId, jobId);
  await captureManufacturingSnapshots(db, companyId, jobId);
  const overview = await manufacturingOverview(db, companyId, jobId);
  const line = overview.lines.find(l => l.id === input.sourceLineId);
  if (!line || (input.kind === 'SHORTAGE' && milli(input.amountM) > milli(line.sent_length_m) + milli(line.excess_m) - milli(line.returned_m) - milli(line.shortage_m))) fail('النقص يتجاوز الفرق غير المحسوم');
  await db.query(`INSERT INTO external_job_settlements(company_id,job_id,source_line_id,amount_m,reason,approved_by,kind) VALUES($1,$2,$3,$4,$5,$6,$7)`, [companyId, jobId, input.sourceLineId, input.amountM, input.reason, userId, input.kind]);
  await syncManufacturingSourceBalances(db, companyId, userId, jobId);
}

export async function resolveManufacturingDefect(db: Db, companyId: string, userId: string, jobId: string, raw: unknown) {
  const input = z.object({ returnLineId: uuid, decision: z.enum(['ACCEPT', 'REWORK', 'WRITE_OFF']), notes: text }).strict().parse(raw);
  await lockManufacturingJob(db, companyId, jobId);
  const hold = (await db.query(`SELECT q.*,r.status FROM external_job_return_lines q JOIN fabric_rolls r ON r.id=q.result_roll_id AND r.company_id=q.company_id
    WHERE q.id=$1 AND q.company_id=$2 AND q.job_id=$3 FOR UPDATE OF q,r`, [input.returnLineId, companyId, jobId])).rows[0];
  if (!hold || !hold.defective) fail('سجل العيب غير موجود');
  if (hold.resolution) fail('تم اعتماد قرار لهذا العيب مسبقاً');
  if (hold.status !== 'RESERVED') fail('حالة رولة الفحص تغيرت؛ يلزم مراجعة');
  await db.query(`UPDATE external_job_return_lines SET resolution=$3,resolved_by=$4,resolved_at=now(),resolution_notes=$5 WHERE id=$1 AND company_id=$2`, [hold.id, companyId, input.decision, userId, input.notes]);
  // REWORK remains DAMAGED until a linked, authorized processing dispatch claims it.
  const status = input.decision === 'ACCEPT' ? 'AVAILABLE' : input.decision === 'REWORK' ? 'DAMAGED' : 'INACTIVE';
  await db.query('UPDATE fabric_rolls SET status=$3,updated_at=now() WHERE id=$1 AND company_id=$2', [hold.result_roll_id, companyId, status]);
  await db.query(`INSERT INTO inventory_movements(company_id,roll_id,movement_type,old_status,new_status,reference_type,reference_id,notes,created_by_user_id)
    VALUES($1,$2,'STATUS_CHANGE','RESERVED',$3,'EXTERNAL_JOB',$4,$5,$6)`, [companyId, hold.result_roll_id, status, jobId, input.notes, userId]);
}

export async function priceManufacturingServices(db: Db, companyId: string, userId: string, jobId: string, raw: unknown) {
  const input = z.object({ lines: z.array(z.object({ serviceId: uuid, unitPrice: z.coerce.number().finite().nonnegative().max(99999999),
    currencyCode: z.string().trim().min(1).max(8), basis: z.enum(['METER', 'KG', 'FIXED']), approvedQuantity: amount })).min(1).max(30) }).strict().parse(raw);
  const job = await lockManufacturingJob(db, companyId, jobId);
  if (job.fee_posted_at) fail('تم ترحيل الفاتورة؛ لا يمكن تعديل الأسعار');
  const services = (await db.query('SELECT id FROM external_job_services WHERE job_id=$1 AND company_id=$2 ORDER BY id FOR UPDATE', [jobId, companyId])).rows;
  if (input.lines.length !== services.length || new Set(input.lines.map(l => l.serviceId)).size !== services.length || input.lines.some(l => !services.some(s => s.id === l.serviceId))) fail('يجب تسعير جميع الخدمات مرة واحدة');
  let totalUsd = 0;
  for (const l of input.lines) {
    if (l.basis === 'FIXED' && l.approvedQuantity !== 1) fail('كمية المبلغ المقطوع يجب أن تكون واحداً');
    const currency = l.currencyCode.toUpperCase();
    if (!(await db.query('SELECT 1 FROM currencies WHERE code=$1', [currency])).rows.length) fail('العملة غير موجودة');
    const rate = currency === 'USD' ? 1 : await getExchangeRateToUsdTx(db as PoolClient, companyId, currency);
    if (!rate || rate <= 0) fail('سعر الصرف غير صالح');
    const usd = Math.round(l.unitPrice * l.approvedQuantity / rate * 10000) / 10000;
    if (!Number.isFinite(usd) || usd > 9999999999.9999) fail('إجمالي الخدمة يتجاوز الحد المحاسبي المسموح');
    totalUsd += usd;
    await db.query(`UPDATE external_job_services SET unit_price=$3,currency_code=$4,basis=$5,approved_quantity=$6,total_usd=$7,priced_by=$8
      WHERE id=$1 AND company_id=$2`, [l.serviceId, companyId, l.unitPrice, currency, l.basis, l.approvedQuantity, usd, userId]);
  }
  if (totalUsd > 9999999999.99) fail('إجمالي أجرة المهمة يتجاوز الحد المحاسبي المسموح');
  // One pricing source: the existing fee header and existing GL posting consume this aggregate.
  await db.query(`UPDATE external_jobs SET fee_amount=$3,fee_currency_code='USD',fee_exchange_rate_to_usd=1,
    pricing_method=NULL,approved_quantity=NULL,unit_price=NULL,updated_at=now() WHERE id=$1 AND company_id=$2`, [jobId, companyId, Math.round(totalUsd * 100) / 100]);
}

export async function closeManufacturingJob(db: Db, companyId: string, jobId: string) {
  const job = await lockManufacturingJob(db, companyId, jobId);
  if (job.lifecycle_closed_at) return;
  await assertNewReceiptMode(db, companyId, jobId);
  const overview = await manufacturingOverview(db, companyId, jobId);
  if (!overview.lines.length || overview.lines.some(l => milli(l.sent_length_m) + milli(l.excess_m) !== milli(l.returned_m) + milli(l.shortage_m))) fail('لا يمكن الإغلاق مع وجود فرق غير محسوم');
  if (overview.batches.some(b => b.lines.some((l: { defective: boolean; resolution: string | null }) => l.defective && !l.resolution))) fail('توجد عيوب تنتظر قراراً');
  await db.query(`UPDATE external_job_lines SET line_status='RECEIVED',received_at=now() WHERE job_id=$1 AND company_id=$2 AND line_status='SENT'`, [jobId, companyId]);
  await db.query(`INSERT INTO inventory_movements(company_id,roll_id,movement_type,old_status,new_status,reference_type,reference_id,reference_no,notes)
    SELECT r.company_id,r.id,'STATUS_CHANGE','AT_EXTERNAL_JOB','INACTIVE','EXTERNAL_JOB',l.job_id,$3,'إغلاق السجل الأصلي بعد استلام الدفعات وحسم الفروقات'
    FROM external_job_lines l JOIN fabric_rolls r ON r.id=l.roll_id AND r.company_id=l.company_id
    WHERE l.job_id=$1 AND l.company_id=$2 AND r.status='AT_EXTERNAL_JOB'`, [jobId, companyId, job.job_no]);
  await db.query(`UPDATE fabric_rolls r SET status='INACTIVE',updated_at=now() FROM external_job_lines l
    WHERE l.job_id=$1 AND l.company_id=$2 AND r.id=l.roll_id AND r.company_id=l.company_id AND r.status='AT_EXTERNAL_JOB'`, [jobId, companyId]);
  await db.query('UPDATE external_jobs SET lifecycle_closed_at=now(),updated_at=now() WHERE id=$1 AND company_id=$2', [jobId, companyId]);
}

export async function assertNoQualityHold(db: Db, companyId: string, rollId: string) {
  if ((await db.query(`SELECT 1 FROM external_job_return_lines WHERE company_id=$1 AND result_roll_id=$2 AND defective AND resolution IS NULL`, [companyId, rollId])).rows.length) fail('البضاعة محجوزة للفحص؛ البيع والصرف والنقل ممنوع', 'INVALID_STOCK');
}
