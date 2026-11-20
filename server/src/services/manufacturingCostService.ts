import {payrollCostBasis,payrollAllocationSnapshot} from './manufacturingFinancialSourcesService.js';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
type Db = Pick<PoolClient, 'query'>;
const uuid = z.string().uuid();
const quantity = z.number().finite().positive().max(99999999).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001, 'الدقة القصوى ثلاثة منازل');
const notes = z.string().trim().min(1).max(2000);
const fail = (message: string, code = 'VALIDATION'): never => { throw Object.assign(new Error(message), { code }); };
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const money = (n: number) => Math.round(n * 10000) / 10000;
export async function lockCostOrder(db: Db, company: string, order: string) {
    uuid.parse(order);
    const row = (await db.query(`SELECT w.*,EXISTS(SELECT 1 FROM manufacturing_cost_closures c WHERE c.company_id=w.company_id AND c.work_order_id=w.id) cost_closed FROM manufacturing_work_orders w WHERE w.company_id=$1 AND w.id=$2 FOR UPDATE OF w`, [company, order])).rows[0];
    if (!row)
        fail('أمر الإنتاج غير موجود', 'NOT_FOUND');
    if (row.cost_closed || row.status === 'CANCELLED')
        fail('أمر الإنتاج مغلق تكاليفياً أو ملغى', 'INVALID_STATE');
    return row;
}
// Never invent a conversion rate for an unconfigured foreign currency.
export async function costRate(db: Db, company: string, currency: string): Promise<number | null> {
    if (currency === 'USD')
        return 1;
    const row = (await db.query(`SELECT exchange_rate_to_usd FROM exchange_rates WHERE company_id=$1 AND currency_code=$2 AND is_active`, [company, currency])).rows[0];
    return row && Number(row.exchange_rate_to_usd) > 0 ? Number(row.exchange_rate_to_usd) : null;
}
export async function postManufacturingMaterial(db: Db, company: string, user: string, order: string, raw: unknown) {
    const input = z.object({ requestId: uuid, stage: z.enum(['WEAVING', 'SIZING']), stageId: uuid, kind: z.enum(['ISSUE', 'RETURN']),
        consumptionBasis: z.enum(['LEGACY_NET_ISSUE', 'RECORDED']).optional(), lotId: uuid, sourceEntryId: uuid.optional(), weightKg: quantity, wasteKg: z.number().finite().min(0).default(0), notes }).strict().parse(raw);
    if (input.wasteKg > input.weightKg || Math.abs(input.wasteKg * 1000 - Math.round(input.wasteKg * 1000)) > 0.00001)
        fail('وزن الهالك غير صالح');
    if (input.kind === 'ISSUE' && input.consumptionBasis === 'RECORDED' && input.wasteKg) fail('سجّل الهالك في بيان الاستهلاك الفعلي');
    const fingerprint = hash(input);
    const locked = await lockCostOrder(db, company, order);
    const prior = (await db.query('SELECT id,request_hash,work_order_id FROM manufacturing_material_entries WHERE company_id=$1 AND request_id=$2', [company, input.requestId])).rows[0];
    if (prior) {
        if (prior.request_hash !== fingerprint || prior.work_order_id !== order)
            fail('معرف الطلب مستخدم بمحتوى مختلف', 'DUPLICATE');
        return { id: prior.id, duplicate: true };
    }
    if (locked.status !== 'IN_PROGRESS')
        fail('تسجيل الاستهلاك متاح أثناء تشغيل أمر الإنتاج', 'INVALID_STATE');
    const stage = input.stage === 'WEAVING'
        ? (await db.query('SELECT status,work_order_id FROM manufacturing_weaving_runs WHERE company_id=$1 AND id=$2 FOR UPDATE', [company, input.stageId])).rows[0]
        : (await db.query(`SELECT s.status,w.work_order_id FROM manufacturing_sizing_orders s JOIN manufacturing_warp_beams b ON b.id=s.input_beam_id AND b.company_id=s.company_id JOIN manufacturing_warping_orders w ON w.id=b.warping_order_id AND w.company_id=b.company_id WHERE s.company_id=$1 AND s.id=$2 FOR UPDATE OF s`, [company, input.stageId])).rows[0];
    if (!stage || stage.work_order_id !== order || !['DRAFT', 'IN_PROGRESS', 'PAUSED'].includes(stage.status))
        fail('مرحلة الاستهلاك غير صالحة أو مغلقة', 'INVALID_STATE');
    const lot = (await db.query('SELECT y.*,f.weight_material_kind FROM yarn_lots y JOIN fabric_items f ON f.id=y.item_id AND f.company_id=y.company_id WHERE y.company_id=$1 AND y.id=$2 FOR UPDATE OF y', [company, input.lotId])).rows[0];
    if (!lot)
        fail('لوط المادة غير موجود', 'NOT_FOUND');
    if(input.kind==='ISSUE' && ((input.stage==='SIZING' && lot.weight_material_kind==='YARN') || (input.stage==='WEAVING' && lot.weight_material_kind==='CONSUMABLE'))) fail('تصنيف المادة لا يطابق مرحلة الإنتاج');
    let unitCost = lot.unit_cost, currency = lot.currency_code, rate = await costRate(db, company, currency);
    if (input.kind === 'ISSUE') {
        if (input.sourceEntryId || lot.status !== 'AVAILABLE' || Number(lot.weight_kg) < input.weightKg)
            fail('الرصيد غير كاف أو غير متاح', 'INVALID_STOCK');
    }
    else {
        if (!input.sourceEntryId || input.wasteKg)
            fail('يجب ربط المرتجع بالصرف الأصلي دون هالك');
        const source = (await db.query(`SELECT e.*,COALESCE((SELECT SUM(r.weight_kg) FROM manufacturing_material_entries r WHERE r.company_id=e.company_id AND r.source_entry_id=e.id),0) returned FROM manufacturing_material_entries e WHERE company_id=$1 AND id=$2 FOR UPDATE`, [company, input.sourceEntryId])).rows[0];
        if (!source || source.kind !== 'ISSUE' || source.work_order_id !== order || source.yarn_lot_id !== input.lotId || (source.weaving_run_id ?? source.sizing_order_id) !== input.stageId || (input.stage === 'WEAVING') !== (source.weaving_run_id != null))
            fail('مرجع المرتجع لا يطابق الصرف');
        const used = source.consumption_basis === 'RECORDED' ? Number((await db.query('SELECT COALESCE(SUM(consumed_kg+waste_kg),0) used FROM manufacturing_material_consumptions WHERE company_id=$1 AND source_entry_id=$2', [company, source.id])).rows[0].used) : Number(source.waste_kg);
        if (Math.round((Number(source.returned) + input.weightKg + used) * 1000) > Math.round(Number(source.weight_kg) * 1000))
            fail('المرتجع يتجاوز الكمية المتاحة بعد الهالك');
        unitCost = source.unit_cost;
        currency = source.currency_code;
        rate = source.exchange_rate;
        if (!['AVAILABLE', 'INACTIVE'].includes(lot.status))
            fail('لا يمكن إعادة المادة إلى لوط محجوز أو تالف', 'INVALID_STOCK');
    }
    const delta = input.kind === 'ISSUE' ? -input.weightKg : input.weightKg;
    const entry = (await db.query(`INSERT INTO manufacturing_material_entries(company_id,work_order_id,weaving_run_id,sizing_order_id,yarn_lot_id,request_id,request_hash,kind,source_entry_id,weight_kg,waste_kg,unit_cost,currency_code,exchange_rate,notes,created_by_user_id,consumption_basis)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`, [company, order, input.stage === 'WEAVING' ? input.stageId : null, input.stage === 'SIZING' ? input.stageId : null, input.lotId, input.requestId, fingerprint, input.kind, input.sourceEntryId ?? null, input.weightKg, input.wasteKg, unitCost, currency, rate, input.notes, user, input.consumptionBasis ?? 'LEGACY_NET_ISSUE'])).rows[0];
    await db.query(`UPDATE yarn_lots SET weight_kg=weight_kg+$3,status=CASE WHEN weight_kg+$3=0 THEN 'INACTIVE' ELSE 'AVAILABLE' END,updated_at=now() WHERE company_id=$1 AND id=$2`, [company, input.lotId, delta]);
    await db.query(`INSERT INTO yarn_lot_movements(company_id,yarn_lot_id,movement_type,weight_delta_kg,from_warehouse_id,to_warehouse_id,reference_type,reference_id,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'MANUFACTURING_MATERIAL',$7,$8,$9)`, [company, input.lotId, input.kind === 'ISSUE' ? 'MANUFACTURING_CONSUMPTION' : 'MANUFACTURING_RETURN', delta, input.kind === 'ISSUE' ? lot.warehouse_id : null, input.kind === 'RETURN' ? lot.warehouse_id : null, entry.id, input.notes, user]);
    return { id: entry.id, duplicate: false };
}
export async function addManufacturingCharge(db: Db, company: string, user: string, order: string, raw: unknown) {
    const input = z.object({ requestId: uuid, kind: z.enum(['LABOR', 'ENERGY', 'OVERHEAD', 'ADJUSTMENT']), amount: z.number().finite().min(-999999999).max(999999999).refine(n => n !== 0 && Math.abs(n * 10000 - Math.round(n * 10000)) < 0.00001, 'الدقة القصوى أربع منازل'), payrollBasis: payrollCostBasis.optional(), payrollEligibleAmount: z.number().finite().positive().max(999999999).optional(), payrollLineId: uuid.optional(), internalRateId: uuid.optional(), allocationQuantity: quantity.optional(), sourceReference: z.string().trim().min(1).max(200).optional(), currencyCode: z.string().trim().length(3).transform(s => s.toUpperCase()), notes }).strict().parse(raw);
    if (input.kind === 'LABOR' && (!input.payrollLineId || !input.payrollBasis)) fail('حدد سطر الرواتب وأساس تحميل الأجر صراحةً لمنع التكرار');
    if (input.kind !== 'ADJUSTMENT' && input.amount < 0)
        fail('التكلفة السالبة متاحة للتسويات فقط');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[company+input.requestId]);
    const fingerprint = hash(input), prior = (await db.query('SELECT id,request_hash,work_order_id FROM manufacturing_cost_charges WHERE company_id=$1 AND request_id=$2', [company, input.requestId])).rows[0];
    if (prior) {
        if (prior.request_hash !== fingerprint || prior.work_order_id !== order)
            fail('معرف الطلب مستخدم بمحتوى مختلف', 'DUPLICATE');
        return { id: prior.id, duplicate: true };
    }
    await lockCostOrder(db, company, order);
    if (input.payrollLineId && input.internalRateId) fail('اختر مصدر تكلفة واحداً');
    let amount = input.amount, currency = input.currencyCode, rate: number | null;
    let payrollSnapshot: ReturnType<typeof payrollAllocationSnapshot> | null=null;
    if(!input.payrollLineId && (input.payrollBasis || input.payrollEligibleAmount!==undefined)) fail('أساس الأجر يحتاج سطر رواتب');
    if (input.payrollLineId) {
        if (input.kind !== 'LABOR') fail('مصدر الرواتب متاح للأجور فقط');
        // Lock the authoritative run before its line: cancellation uses the same run lock.
        const run = (await db.query(`SELECT r.* FROM payroll_runs r JOIN payroll_run_lines l ON l.payroll_run_id=r.id AND l.company_id=r.company_id WHERE l.company_id=$1 AND l.id=$2 FOR UPDATE OF r`, [company,input.payrollLineId])).rows[0];
        const line = (await db.query('SELECT * FROM payroll_run_lines WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,input.payrollLineId])).rows[0];
        if (!run || !line || !['CONFIRMED','PAID'].includes(run.status)) fail('يجب اختيار سطر موظف من مسير معتمد');
        payrollSnapshot=payrollAllocationSnapshot(line,run,input.payrollBasis!,input.payrollEligibleAmount);
        const used = (await db.query(`SELECT COALESCE(SUM(amount),0) used,COUNT(*) count,
          MIN(payroll_cost_basis) basis,MIN((payroll_source_snapshot->>'eligibleAmount')::numeric) eligible_amount
          FROM manufacturing_cost_charges WHERE company_id=$1 AND payroll_line_id=$2`,[company,line.id])).rows[0];
        // One source pool per employee line across all work orders, including pending allocations.
        if(Number(used.count)>0 && (used.basis!==input.payrollBasis || Number(used.eligible_amount)!==payrollSnapshot.eligibleAmount)) fail('يوجد تحميل لهذا السطر بأساس أو سقف أهلية مختلف؛ لا يمكن خلط الأسس');
        validatePayrollAllocation(payrollSnapshot.eligibleAmount, Number(used.used), amount);
        currency=run.currency_code; rate=Number(run.exchange_rate_to_usd);
        if (input.currencyCode !== currency) fail('عملة التوزيع يجب أن تطابق المسير');
    } else if (input.internalRateId) {
        const r=(await db.query('SELECT * FROM manufacturing_internal_rates WHERE company_id=$1 AND id=$2 FOR SHARE',[company,input.internalRateId])).rows[0];
        if (!r || r.status!=='APPROVED' || r.kind!==input.kind || !input.allocationQuantity) fail('تعريف السعر غير معتمد أو كمية التحميل غير صالحة');
        amount=money(Number(r.amount)*input.allocationQuantity!); currency=r.currency_code;
        if (amount!==input.amount || currency!==input.currencyCode) fail('المبلغ يجب أن يطابق السعر المعتمد والكمية');
        rate=await costRate(db,company,currency);
    } else {
        if(input.allocationQuantity) fail('الكمية تحتاج تعريف سعر');
        rate=await costRate(db,company,currency);
    }
    if (!rate || !Number.isFinite(rate) || rate<=0) fail('سعر الصرف غير صالح');
    const row = (await db.query(`INSERT INTO manufacturing_cost_charges(company_id,work_order_id,request_id,request_hash,kind,amount,currency_code,exchange_rate,notes,created_by_user_id,source_reference,payroll_line_id,internal_rate_id,allocation_quantity,payroll_cost_basis,payroll_source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) RETURNING id`, [company,order,input.requestId,fingerprint,input.kind,amount,currency,rate,input.notes,user,input.sourceReference??null,input.payrollLineId??null,input.internalRateId??null,input.allocationQuantity??null,input.payrollBasis??null,payrollSnapshot?JSON.stringify(payrollSnapshot):null])).rows[0];
    return { id: row.id, duplicate: false };
}
export const manufacturingGenealogy = `WITH RECURSIVE lineage(id) AS (
 SELECT o.result_fabric_roll_id FROM manufacturing_raw_roll_outputs o JOIN manufacturing_weaving_runs r ON r.id=o.weaving_run_id AND r.company_id=o.company_id WHERE r.company_id=$1 AND r.work_order_id=$2 AND o.result_fabric_roll_id IS NOT NULL
 UNION SELECT q.result_roll_id FROM external_job_return_lines q JOIN lineage p ON p.id=q.source_roll_id WHERE q.company_id=$1
)`;
export async function manufacturingDispatchOrder(db: Db, company: string, rollIds: string[]): Promise<string | null> {
    const orders = (await db.query(`WITH RECURSIVE ancestors(id) AS (
    SELECT unnest($2::uuid[]) UNION SELECT q.source_roll_id FROM external_job_return_lines q JOIN ancestors a ON a.id=q.result_roll_id WHERE q.company_id=$1
   ) SELECT DISTINCT r.work_order_id FROM ancestors a JOIN manufacturing_raw_roll_outputs o ON o.result_fabric_roll_id=a.id AND o.company_id=$1
   JOIN manufacturing_weaving_runs r ON r.id=o.weaving_run_id AND r.company_id=o.company_id`, [company, rollIds])).rows;
    if (orders.length > 1)
        fail('افصل رولات أوامر الإنتاج المختلفة في مهام مصنعية مستقلة لضمان توزيع التكلفة');
    if (!orders.length)
        return null;
    await lockCostOrder(db, company, orders[0].work_order_id);
    return orders[0].work_order_id;
}
export async function linkManufacturingExternal(db: Db, company: string, user: string, order: string, jobId: string) {
    uuid.parse(jobId);
    await lockCostOrder(db, company, order);
    const job = (await db.query(`SELECT id FROM external_jobs WHERE company_id=$1 AND id=$2 AND job_kind='PROCESSING' AND document_status='CONFIRMED' FOR UPDATE`, [company, jobId])).rows[0];
    if (!job)
        fail('يلزم مهمة مصنعية خارجية مؤكدة لنفس الشركة');
    const invalid = await db.query(`${manufacturingGenealogy} SELECT l.id FROM external_job_lines l WHERE l.company_id=$1 AND l.job_id=$3 AND l.line_status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM lineage p WHERE p.id=l.roll_id)`, [company, order, jobId]);
    const count = await db.query("SELECT 1 FROM external_job_lines WHERE company_id=$1 AND job_id=$2 AND line_status<>'CANCELLED'", [company, jobId]);
    if (invalid.rows.length || !count.rows.length)
        fail('جميع رولات المصنعية يجب أن تنتمي إلى إنتاج هذا الأمر');
    const prior = (await db.query('SELECT work_order_id FROM manufacturing_external_links WHERE company_id=$1 AND job_id=$2', [company, jobId])).rows[0];
    if (prior && prior.work_order_id !== order)
        fail('المصنعية مرتبطة بأمر آخر', 'DUPLICATE');
    await db.query('INSERT INTO manufacturing_external_links(company_id,work_order_id,job_id,created_by_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [company, order, jobId, user]);
    return { jobId };
}
export async function manufacturingCostReport(db: Db, company: string, order: string) {
    const work = (await db.query('SELECT id,work_order_no,status,target_length_m FROM manufacturing_work_orders WHERE company_id=$1 AND id=$2', [company, order])).rows[0];
    if (!work)
        fail('أمر الإنتاج غير موجود', 'NOT_FOUND');
    const warp = (await db.query(`SELECT l.*,i.status issue_status FROM manufacturing_warping_yarn_issue_lines l JOIN manufacturing_warping_yarn_issues i ON i.id=l.issue_id AND i.company_id=l.company_id JOIN manufacturing_warping_orders w ON w.id=i.warping_order_id AND w.company_id=i.company_id WHERE w.company_id=$1 AND w.work_order_id=$2 AND i.status IN ('ISSUED','CLOSED')`, [company, order])).rows;
    const materials = (await db.query('SELECT * FROM manufacturing_material_entries WHERE company_id=$1 AND work_order_id=$2 ORDER BY created_at', [company, order])).rows;
    const consumptions = (await db.query('SELECT * FROM manufacturing_material_consumptions WHERE company_id=$1 AND work_order_id=$2 ORDER BY created_at,id', [company, order])).rows;
    const charges = (await db.query('SELECT * FROM manufacturing_cost_charges WHERE company_id=$1 AND work_order_id=$2 ORDER BY created_at', [company, order])).rows;
    const external = (await db.query(`SELECT j.id,j.job_no,j.document_status,j.lifecycle_closed_at,j.fee_amount,j.fee_currency_code,j.fee_exchange_rate_to_usd,a.id AS share_id,a.allocated_usd,
    (SELECT count(*) FROM external_job_services s WHERE s.company_id=j.company_id AND s.job_id=j.id) service_count,
    (SELECT count(*) FROM external_job_services s WHERE s.company_id=j.company_id AND s.job_id=j.id AND s.total_usd IS NULL) unrated,
    (SELECT SUM(s.total_usd) FROM external_job_services s WHERE s.company_id=j.company_id AND s.job_id=j.id) service_total
    FROM external_jobs j LEFT JOIN manufacturing_external_cost_shares a ON a.company_id=j.company_id AND a.job_id=j.id AND a.work_order_id=$2
    WHERE j.company_id=$1 AND (a.id IS NOT NULL OR EXISTS(SELECT 1 FROM manufacturing_external_links l WHERE l.company_id=j.company_id AND l.job_id=j.id AND l.work_order_id=$2))`, [company, order])).rows;
    let unrated = 0, warpUsd = 0, materialUsd = 0, chargeUsd = 0, externalUsd = 0;
    for (const l of warp) {
        const kg = Number(l.issued_weight_kg) - Number(l.returned_weight_kg);
        if (!kg)
            continue;
        if (l.issued_unit_cost == null || !Number(l.issued_exchange_rate)) {
            unrated++;
            continue;
        }
        warpUsd += kg * Number(l.issued_unit_cost) / Number(l.issued_exchange_rate);
    }
    const returnedWeights = new Map<string, number>();
    for (const r of materials)
        if (r.source_entry_id)
            returnedWeights.set(r.source_entry_id, (returnedWeights.get(r.source_entry_id) ?? 0) + Number(r.weight_kg));
    for (const m of materials.filter(e => e.kind === 'ISSUE')) {
        const balance = materialBalance(m, returnedWeights.get(m.id) ?? 0, consumptions.filter(c => c.source_entry_id === m.id));
        const net = balance.costedKg;
        if (net <= 0)
            continue;
        if (m.unit_cost == null || !Number(m.exchange_rate)) {
            unrated++;
            continue;
        }
        materialUsd += net * Number(m.unit_cost) / Number(m.exchange_rate);
    }
    const unapprovedCharges = charges.filter(c => c.approval_status !== 'APPROVED').length;
    for (const c of charges) {
        if(c.approval_status === 'APPROVED') chargeUsd += Number(c.amount) / Number(c.exchange_rate);
    }
    for (const j of external) {
        if (j.document_status === 'VOIDED')
            continue;
        if(j.share_id){if(j.allocated_usd==null)unrated++;else externalUsd+=Number(j.allocated_usd);continue;}
        if (Number(j.service_count)) {
            unrated += Number(j.unrated);
            externalUsd += Number(j.service_total ?? 0);
        }
        else if (j.fee_amount == null || !Number(j.fee_exchange_rate_to_usd)) {
            unrated++;
        }
        else
            externalUsd += Number(j.fee_amount) / Number(j.fee_exchange_rate_to_usd);
    }
    const rolls = (await db.query(`${manufacturingGenealogy} SELECT r.id,r.roll_no,r.barcode,r.length_m,r.status FROM lineage p JOIN fabric_rolls r ON r.id=p.id AND r.company_id=$1 WHERE r.length_m>0 AND r.cut_from_roll_id IS NULL AND r.status IN ('AVAILABLE','RESERVED','SOLD')
    AND NOT EXISTS(SELECT 1 FROM external_job_return_lines q WHERE q.company_id=$1 AND q.result_roll_id=r.id AND q.defective AND (q.resolution IS NULL OR q.resolution='WRITE_OFF'))
    AND NOT EXISTS(SELECT 1 FROM external_job_lines l JOIN external_jobs j ON j.id=l.job_id AND j.company_id=l.company_id WHERE l.roll_id=r.id AND l.company_id=$1 AND j.document_status='CONFIRMED' AND l.line_status<>'CANCELLED')`, [company, order])).rows;
    const acceptedLengthM = rolls.reduce((s, r) => s + Number(r.length_m), 0), totalUsd = money(warpUsd + materialUsd + chargeUsd + externalUsd);
    const closure = (await db.query('SELECT * FROM manufacturing_cost_closures WHERE company_id=$1 AND work_order_id=$2', [company, order])).rows[0] ?? null;
    const materialBalances = materials.filter(m => m.kind === 'ISSUE').map(m => ({ id: m.id, basis: m.consumption_basis, ...materialBalance(m, returnedWeights.get(m.id) ?? 0, consumptions.filter(c => c.source_entry_id === m.id)) }));
    return { costStatus: closure ? 'APPROVED' : 'UNAPPROVED', unapprovedCharges, accountingPosted: false, materialBalances, consumptions, work, warp, materials, charges, external, rolls, closure, unrated, acceptedLengthM: closure ? Number(closure.accepted_length_m) : acceptedLengthM, totalUsd: closure ? Number(closure.total_usd) : totalUsd, unitCostUsd: closure ? Number(closure.unit_cost_usd) : acceptedLengthM > 0 ? totalUsd / acceptedLengthM : null,
        breakdown: { warpUsd: money(warpUsd), materialUsd: money(materialUsd), chargeUsd: money(chargeUsd), externalUsd: money(externalUsd) } };
}
export async function finalizeManufacturingCost(db: Db, company: string, user: string, order: string) {
    await db.query('SELECT id FROM manufacturing_work_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,order]);
    const existing = (await db.query('SELECT * FROM manufacturing_cost_closures WHERE company_id=$1 AND work_order_id=$2', [company, order])).rows[0];
    if (existing)
        return existing;
    const w = await lockCostOrder(db, company, order);
    if (w.status !== 'COMPLETED')
        fail('أغلق أمر الإنتاج تشغيلياً قبل اعتماد تكلفته');
    await db.query(`SELECT j.id FROM external_jobs j WHERE j.company_id=$1 AND (EXISTS(SELECT 1 FROM manufacturing_external_links l WHERE l.company_id=j.company_id AND l.job_id=j.id AND l.work_order_id=$2) OR EXISTS(SELECT 1 FROM manufacturing_external_cost_shares a WHERE a.company_id=j.company_id AND a.job_id=j.id AND a.work_order_id=$2)) ORDER BY j.id FOR UPDATE OF j`, [company, order]);
    const report = await manufacturingCostReport(db, company, order);
    if (report.materialBalances.some(b => b.basis === 'RECORDED' && (b.custodyKg??0) > 0)) fail('توجد مواد بعهدة الإنتاج لم تسجل كمستهلك أو مرتجع أو هالك');
    if (report.unapprovedCharges) fail('توجد تحميلات تكلفة غير معتمدة');
    if (report.unrated || report.external.some(j => j.document_status !== 'VOIDED' && !j.lifecycle_closed_at))
        fail('توجد مواد غير مسعرة أو مصنعية خارجية غير مغلقة');
    if (!report.acceptedLengthM || report.totalUsd < 0)
        fail('كمية الناتج أو إجمالي التكلفة غير صالح');
    const locked = await db.query('SELECT id,status FROM fabric_rolls WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [company, report.rolls.map(r => r.id)]);
    if (locked.rows.some(r => r.status !== 'AVAILABLE'))
        fail('يجب اعتماد التكلفة قبل حجز أو بيع الناتج');
    // Freeze original breakdown and allocate the entire amount, including waste, exactly once.
    await db.query(`INSERT INTO manufacturing_cost_closures(company_id,work_order_id,total_usd,accepted_length_m,unit_cost_usd,breakdown,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [company, order, report.totalUsd, report.acceptedLengthM, report.unitCostUsd, JSON.stringify(report.breakdown), user]);
    let allocated = 0;
    for (const [i, roll] of report.rolls.entries()) {
        const amount = i === report.rolls.length - 1 ? money(report.totalUsd - allocated) : money(report.totalUsd * Number(roll.length_m) / report.acceptedLengthM);
        allocated = money(allocated + amount);
        await db.query('INSERT INTO manufacturing_cost_allocations(company_id,work_order_id,roll_id,length_m,allocated_usd) VALUES($1,$2,$3,$4,$5)', [company, order, roll.id, roll.length_m, amount]);
        await db.query("UPDATE fabric_rolls SET unit_cost=$3,currency_code='USD',updated_at=now() WHERE company_id=$1 AND id=$2", [company, roll.id, amount / Number(roll.length_m)]);
    }
    return { totalUsd: report.totalUsd, acceptedLengthM: report.acceptedLengthM, unitCostUsd: report.unitCostUsd };
}

// All values are expressed in stock kilograms; no new inventory movement on consumption.
export function materialBalance(entry: { weight_kg: string | number; waste_kg: string | number; consumption_basis?: string }, returnedKg: number, records: Array<{consumed_kg: string | number; waste_kg: string | number}>) {
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const issuedKg = Number(entry.weight_kg), net = round(issuedKg - returnedKg);
    const recorded = entry.consumption_basis === 'RECORDED';
    const wasteKg = recorded ? round(records.reduce((s,c) => s + Number(c.waste_kg),0)) : Number(entry.waste_kg);
    const consumedKg = recorded ? round(records.reduce((s,c) => s + Number(c.consumed_kg),0)) : null;
    return { issuedKg, returnedKg, consumedKg, wasteKg, custodyKg: recorded ? round(net - wasteKg - consumedKg!) : null,
        costedKg: recorded ? round(consumedKg! + wasteKg) : net };
}
export async function recordManufacturingConsumption(db: Db, company: string, user: string, order: string, raw: unknown) {
    const q = z.number().finite().min(0).max(99999999).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < .00001);
    const input = z.object({requestId: uuid, sourceEntryId: uuid, consumedKg: q, wasteKg: q, notes}).strict().parse(raw);
    if (input.consumedKg + input.wasteKg <= 0) fail('أدخل كمية استهلاك أو هالك موجبة');
    await lockCostOrder(db, company, order);
    const fingerprint = hash(input);
    const prior = (await db.query('SELECT * FROM manufacturing_material_consumptions WHERE company_id=$1 AND request_id=$2', [company,input.requestId])).rows[0];
    if (prior) {
        if (prior.request_hash !== fingerprint || prior.work_order_id !== order) fail('معرف الطلب مستخدم بمحتوى مختلف','DUPLICATE');
        return {id: prior.id, duplicate: true};
    }
    const entry = (await db.query("SELECT * FROM manufacturing_material_entries WHERE company_id=$1 AND work_order_id=$2 AND id=$3 AND kind='ISSUE' FOR UPDATE",[company,order,input.sourceEntryId])).rows[0];
    if (!entry || entry.consumption_basis !== 'RECORDED') fail('اختر سند صرف يعتمد تسجيل الاستهلاك الفعلي');
    const records = (await db.query('SELECT * FROM manufacturing_material_consumptions WHERE company_id=$1 AND source_entry_id=$2',[company,entry.id])).rows;
    const returned = Number((await db.query('SELECT COALESCE(SUM(weight_kg),0) kg FROM manufacturing_material_entries WHERE company_id=$1 AND source_entry_id=$2',[company,entry.id])).rows[0].kg);
    if (Math.round((input.consumedKg + input.wasteKg)*1000) > Math.round(materialBalance(entry,returned,records).custodyKg! * 1000)) fail('الاستهلاك والهالك يتجاوزان الكمية المتبقية بالعهدة');
    const row = (await db.query('INSERT INTO manufacturing_material_consumptions(company_id,work_order_id,source_entry_id,request_id,request_hash,consumed_kg,waste_kg,notes,approved_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[company,order,entry.id,input.requestId,fingerprint,input.consumedKg,input.wasteKg,input.notes,user])).rows[0];
    return {id:row.id,duplicate:false};
}

export function validatePayrollAllocation(source: number, used: number, amount: number) {
    if (![source,used,amount].every(Number.isFinite) || amount<=0 || Math.round((used+amount)*10000)>Math.round(source*10000)) fail('توزيع الأجور يتجاوز سقف مصدر الأجر المختار');
}
export async function approveManufacturingCharge(db: Db, company: string, user: string, order: string, raw: unknown) {
    const {chargeId}=z.object({chargeId:uuid}).strict().parse(raw);
    const w=(await db.query('SELECT id FROM manufacturing_work_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,order])).rows[0];
    if(!w) fail('أمر الإنتاج غير موجود','NOT_FOUND');
    const c=(await db.query('SELECT * FROM manufacturing_cost_charges WHERE company_id=$1 AND work_order_id=$2 AND id=$3 FOR UPDATE',[company,order,chargeId])).rows[0];
    if(!c) fail('تحميل التكلفة غير موجود','NOT_FOUND');
    if(c.approval_status==='APPROVED') return c;
    if(c.kind==='LABOR' && !c.payroll_line_id) fail('تحميل أجور قديم دون سطر رواتب موثق؛ يلزم تصحيحه قبل الاعتماد');
    await lockCostOrder(db,company,order);
    return (await db.query("UPDATE manufacturing_cost_charges SET approval_status='APPROVED',approved_by_user_id=$4,approved_at=now() WHERE company_id=$1 AND work_order_id=$2 AND id=$3 RETURNING *",[company,order,chargeId,user])).rows[0];
}
export async function manageManufacturingRate(db: Db, company: string, user: string, raw: unknown) {
    const input=z.discriminatedUnion('action',[
      z.object({action:z.literal('CREATE'),requestId:uuid,machineId:uuid,unit:z.enum(['HOUR','METER','KG','UNIT']),kind:z.enum(['ENERGY','OVERHEAD']),amount:z.number().finite().positive().max(999999999).refine(n=>Math.abs(n*10000-Math.round(n*10000))<0.00001),currencyCode:z.string().regex(/^[A-Z]{3}$/),assetReference:z.string().trim().min(1).max(200).optional(),notes}).strict(),
      z.object({action:z.literal('APPROVE'),rateId:uuid}).strict()
    ]).parse(raw);
    if(input.action==='APPROVE') {
      const r=(await db.query('SELECT * FROM manufacturing_internal_rates WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,input.rateId])).rows[0];
      if(!r) fail('تعريف السعر غير موجود','NOT_FOUND');
      if(r.status==='APPROVED') return r;
      return (await db.query("UPDATE manufacturing_internal_rates SET status='APPROVED',approved_by_user_id=$3,approved_at=now() WHERE company_id=$1 AND id=$2 RETURNING *",[company,input.rateId,user])).rows[0];
    }
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[company+input.requestId]);
    const prior=(await db.query('SELECT * FROM manufacturing_internal_rates WHERE company_id=$1 AND request_id=$2',[company,input.requestId])).rows[0];
    if(prior) {if(prior.request_hash!==hash(input)) fail('معرف الطلب متعارض','DUPLICATE');return prior;}
    const machine=(await db.query('SELECT id FROM manufacturing_machines WHERE company_id=$1 AND id=$2 AND is_active FOR SHARE',[company,input.machineId])).rows[0];
    if(!machine) fail('الماكينة غير موجودة','NOT_FOUND');
    return (await db.query(`INSERT INTO manufacturing_internal_rates(company_id,request_id,request_hash,machine_id,unit,kind,amount,currency_code,asset_reference,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[company,input.requestId,hash(input),input.machineId,input.unit,input.kind,input.amount,input.currencyCode,input.assetReference??null,input.notes,user])).rows[0];
}
