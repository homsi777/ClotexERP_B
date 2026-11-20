import type { PoolClient } from 'pg';

export type ExternalOrderJobSummary = {
  id:string;job_no:string;stage:string;fabricStage:string|null;previousJobId:string|null;
  sent:number;received:number;accepted:number;pending:number;shortage:number;excess:number;
  qualityPending:number;rejected:number;rework:number;traceabilityOnly:boolean;
};

/** Physical outstanding and inspection quantities are separate, non-overlapping buckets.
 * Do not sum sent quantities across processing stages as new order production.
 */
export async function externalOrderLineSummaries(db:Pick<PoolClient,'query'>,company:string,orderId:string) {
  const rows=(await db.query(`SELECT l.customer_order_line_id AS order_line_id,j.id,j.job_no,
    COALESCE(p.name,j.process_description,j.fabric_stage,'EXTERNAL') AS stage,j.fabric_stage,j.previous_job_id,j.traceability_only,
    SUM(COALESCE(l.sent_length_m,0)) AS sent,
    SUM(CASE WHEN q.received IS NOT NULL THEN q.received WHEN l.line_status='RECEIVED' THEN COALESCE(l.new_length_m,l.sent_length_m,0) ELSE 0 END) AS received,
    SUM(COALESCE(q.accepted,CASE WHEN l.line_status='RECEIVED' THEN COALESCE(l.new_length_m,l.sent_length_m,0) ELSE 0 END)) AS accepted,
    SUM(CASE WHEN l.line_status='SENT' THEN GREATEST(0,COALESCE(l.sent_length_m,0)+COALESCE(s.excess,0)-COALESCE(q.received,0)-COALESCE(s.shortage,0)) ELSE 0 END) AS pending,
    SUM(COALESCE(s.shortage,0)) AS shortage,SUM(COALESCE(s.excess,0)) AS excess,
    SUM(COALESCE(q.quality_pending,0)) AS quality_pending,SUM(COALESCE(q.rejected,0)) AS rejected,SUM(COALESCE(q.rework,0)) AS rework
    FROM external_job_lines l JOIN external_jobs j ON j.company_id=l.company_id AND j.id=l.job_id
    LEFT JOIN external_job_preparation_types p ON p.company_id=j.company_id AND p.id=j.preparation_type_id
    LEFT JOIN LATERAL (SELECT SUM(r.length_m) AS received,
      COALESCE(SUM(r.length_m) FILTER(WHERE NOT r.defective OR r.resolution='ACCEPT'),0) AS accepted,
      COALESCE(SUM(r.length_m) FILTER(WHERE r.defective AND r.resolution IS NULL),0) AS quality_pending,
      COALESCE(SUM(r.length_m) FILTER(WHERE r.defective AND r.resolution='WRITE_OFF'),0) AS rejected,
      COALESCE(SUM(r.length_m) FILTER(WHERE r.defective AND r.resolution='REWORK'),0) AS rework
      FROM external_job_return_lines r WHERE r.company_id=l.company_id AND r.source_line_id=l.id) q ON true
    LEFT JOIN LATERAL (SELECT SUM(amount_m) FILTER(WHERE kind='SHORTAGE') AS shortage,
      SUM(amount_m) FILTER(WHERE kind='EXCESS') AS excess FROM external_job_settlements
      WHERE company_id=l.company_id AND source_line_id=l.id) s ON true
    WHERE l.company_id=$1 AND l.customer_order_id=$2 AND l.customer_order_line_id IS NOT NULL
      AND l.line_status<>'CANCELLED' AND j.document_status='CONFIRMED'
    GROUP BY l.customer_order_line_id,j.id,j.job_no,p.name,j.process_description,j.fabric_stage,j.previous_job_id,j.traceability_only
    ORDER BY j.job_no,j.id`,[company,orderId])).rows;
  const byLine=new Map<string,ExternalOrderJobSummary[]>();
  const n=(v:unknown)=>Math.round(Number(v??0)*1000)/1000;
  for(const r of rows) {
    const entry:ExternalOrderJobSummary={id:r.id,job_no:r.job_no,stage:r.stage,fabricStage:r.fabric_stage,previousJobId:r.previous_job_id,
      sent:n(r.sent),received:n(r.received),accepted:n(r.accepted),pending:n(r.pending),shortage:n(r.shortage),excess:n(r.excess),
      qualityPending:n(r.quality_pending),rejected:n(r.rejected),rework:n(r.rework),traceabilityOnly:r.traceability_only};
    byLine.set(r.order_line_id,[...(byLine.get(r.order_line_id)??[]),entry]);
  }
  return byLine;
}
