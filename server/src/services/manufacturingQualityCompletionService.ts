import type { PoolClient } from 'pg';
import { z } from 'zod';
import { resolveManufacturingDefect } from './externalManufacturingLifecycle.js';
type Db = Pick<PoolClient, 'query'>;
const fail = (message: string, code = 'INVALID_STATE'): never => { throw Object.assign(new Error(message), { code }); };
export const qualityChecklistSchema = z.array(z.object({
  key: z.enum(['VISUAL', 'DIMENSIONS', 'QUANTITY', 'TRACEABILITY']),
  result: z.enum(['PASS', 'FAIL', 'NA']), notes: z.string().trim().max(1000).default(''),
}).strict()).max(4).refine(rows => new Set(rows.map(r => r.key)).size === rows.length, 'Duplicate checklist item');
export const qualityImageSchema = z.string().max(1000).refine(value => {
  if (/^\/uploads\/[A-Za-z0-9_./%-]+$/.test(value)) return !value.includes('..') && !/%2e|%2f|%5c/i.test(value);
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;} catch {return false;}
}, 'رابط الصورة غير صالح');
export const qualityEvidenceSchema = z.object({
  checklist: qualityChecklistSchema,
  images: z.array(qualityImageSchema).max(10).default([]),
  notes: z.string().trim().max(2000).nullable().optional(),
  defects: z.array(z.object({ defectId: z.string().uuid(), positionM: z.number().finite().min(0).nullable().optional(), imageUrls: z.array(qualityImageSchema).max(5).default([]), quantity: z.number().int().positive(),
    severity: z.enum(['MINOR','MAJOR','CRITICAL']), notes: z.string().trim().max(1000).default(''),
  }).strict()).max(300).default([]),
}).strict();
export async function listQualityInbox(db: Db, company: string, raw: boolean, external: boolean) {
  const rows: Record<string, unknown>[] = [];
  if (raw) rows.push(...(await db.query(`SELECT 'RAW' AS kind,b.id,b.batch_no AS source_no,b.status,
    b.produced_length_m AS length_m,b.created_at,r.work_order_id,w.work_order_no,
    b.inspected_by_user_id,b.approved_by_user_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('customer_order_id',a.customer_order_id,'customer_order_line_id',a.customer_order_line_id))
      FROM manufacturing_work_order_allocations a WHERE a.company_id=b.company_id AND a.work_order_id=r.work_order_id AND a.is_active),'[]') AS order_refs
    FROM manufacturing_production_batches b JOIN manufacturing_weaving_runs r ON r.id=b.weaving_run_id AND r.company_id=b.company_id
    JOIN manufacturing_work_orders w ON w.id=r.work_order_id AND w.company_id=r.company_id WHERE b.company_id=$1`,[company])).rows);
  if (external) rows.push(...(await db.query(`SELECT 'FINISHED' AS kind,q.id,q.job_id,j.job_no AS source_no,b.dye_paper_no,
    CASE WHEN q.resolution IS NOT NULL THEN q.resolution WHEN q.defective THEN 'QUALITY_HOLD' WHEN q.inspected_at IS NULL THEN 'PENDING_INSPECTION' ELSE 'INSPECTED_ACCEPTED' END AS status,
    q.length_m,b.received_at AS created_at,q.customer_order_id,q.customer_order_line_id,
    q.inspected_by_user_id,q.resolved_by AS approved_by_user_id,
    jsonb_build_array(jsonb_build_object('customer_order_id',q.customer_order_id,'customer_order_line_id',q.customer_order_line_id)) AS order_refs
    FROM external_job_return_lines q JOIN external_jobs j ON j.id=q.job_id AND j.company_id=q.company_id
    JOIN external_job_return_batches b ON b.id=q.batch_id AND b.company_id=q.company_id
    WHERE q.company_id=$1 AND j.job_kind='PROCESSING' AND j.document_status='CONFIRMED'`,[company])).rows);
  return rows.sort((a,b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime() || String(a.id).localeCompare(String(b.id)));
}
export async function externalQualityDetail(db: Db, company: string, id: string) {
  const row = (await db.query(`SELECT q.*,j.job_no,j.document_status,b.dye_paper_no,b.received_at,b.received_by,
    b.attachments,r.barcode,r.status AS roll_status,l.sent_barcode,o.order_no,ol.line_no,
    inspector.full_name AS inspector_name,approver.full_name AS approver_name,receiver.full_name AS receiver_name
    FROM external_job_return_lines q JOIN external_jobs j ON j.id=q.job_id AND j.company_id=q.company_id
    JOIN external_job_return_batches b ON b.id=q.batch_id AND b.company_id=q.company_id
    JOIN external_job_lines l ON l.id=q.source_line_id AND l.company_id=q.company_id
    JOIN fabric_rolls r ON r.id=q.result_roll_id AND r.company_id=q.company_id
    LEFT JOIN customer_orders o ON o.id=q.customer_order_id AND o.company_id=q.company_id
    LEFT JOIN customer_order_lines ol ON ol.id=q.customer_order_line_id AND ol.company_id=q.company_id
    LEFT JOIN users inspector ON inspector.id=q.inspected_by_user_id AND inspector.company_id=q.company_id
    LEFT JOIN users approver ON approver.id=q.resolved_by AND approver.company_id=q.company_id
    LEFT JOIN users receiver ON receiver.id=b.received_by AND receiver.company_id=q.company_id
    WHERE q.company_id=$1 AND q.id=$2 AND j.job_kind='PROCESSING'`,[company,id])).rows[0];
  if (!row) fail('سجل الجودة غير موجود','NOT_FOUND');
  row.quality_decision = row.defective ? row.resolution ?? 'PENDING_DECISION' : row.inspected_at ? 'ACCEPTED_BY_INSPECTION' : 'PENDING_INSPECTION';
  row.approval_required = row.defective && !row.resolution;
  return row;
}
export async function inspectExternalQuality(db: Db, company: string, user: string, id: string, raw: unknown) {
  const input = qualityEvidenceSchema.parse(raw);
  // Same lock order as the authoritative engine: job, then return line + roll.
  const detail = await externalQualityDetail(db,company,id);
  const job = (await db.query('SELECT document_status FROM external_jobs WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,detail.job_id])).rows[0];
  const row = (await db.query(`SELECT q.resolution,r.status FROM external_job_return_lines q
    JOIN fabric_rolls r ON r.id=q.result_roll_id AND r.company_id=q.company_id
    WHERE q.company_id=$1 AND q.id=$2 FOR UPDATE OF q,r`,[company,id])).rows[0];
  if (!row || row.resolution || !['RESERVED','AVAILABLE'].includes(row.status) || job?.document_status !== 'CONFIRMED') fail('لا يمكن تعديل فحص محسوم أو رولة تحركت من الفحص');
  if (input.defects.some(d=>d.positionM!=null&&d.positionM>Number(detail.length_m))) fail('موقع العيب يتجاوز طول الرول المستلم','VALIDATION');
  const valid = await db.query(`SELECT id FROM manufacturing_quality_defect_catalog WHERE company_id=$1
    AND id=ANY($2::uuid[]) AND is_active AND inspection_type IN('ALL','FINISHED_FABRIC')`,[company,input.defects.map(d=>d.defectId)]);
  if (input.defects.some(d=>!valid.rows.some(v=>v.id===d.defectId))) fail('عيب غير صالح لفحص الجاهز','VALIDATION');
  // Evidence cannot introduce an unheld physical defect; receive via existing defective receipt first.
  if (row.status === 'AVAILABLE' && (input.defects.length || input.checklist.some(c=>c.result==='FAIL'))) fail('سجل الرولة المعيبة عبر استلام المصنعية المحجوز للجودة أولاً','VALIDATION');
  await db.query(`UPDATE external_job_return_lines SET quality_checklist=$3,quality_defects=$4,quality_notes=$5,quality_images=$7,
    inspected_by_user_id=$6,inspected_at=now() WHERE company_id=$1 AND id=$2`,
    [company,id,JSON.stringify(input.checklist),JSON.stringify(input.defects),input.notes??null,user,JSON.stringify(input.images)]);
  return {id};
}
export async function decideExternalQuality(db: Db, company: string, user: string, id: string, raw: unknown) {
  const input = z.object({decision:z.enum(['ACCEPT','REWORK','WRITE_OFF']),notes:z.string().trim().min(1).max(2000)}).strict().parse(raw);
  const row = await externalQualityDetail(db,company,id);
  // No quantity/status SQL here: the lifecycle engine owns stock and audit movements.
  return resolveManufacturingDefect(db,company,user,row.job_id,{returnLineId:id,...input});
}
