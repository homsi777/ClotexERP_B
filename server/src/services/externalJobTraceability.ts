import type { PoolClient } from 'pg';
import { z } from 'zod';

export const externalLineReferenceSchema = z.object({
  rollId: z.string().uuid(),
  customerOrderId: z.string().uuid().nullable().optional(),
  customerOrderLineId: z.string().uuid().nullable().optional(),
}).refine(v => !v.customerOrderLineId || !!v.customerOrderId, 'يلزم تحديد الأوردر مع سطر اللون');

type Db = Pick<PoolClient, 'query'>;
export async function validateExternalReferences(db: Db, company: string, rollIds: string[], raw: unknown) {
  const refs = z.array(externalLineReferenceSchema).parse(raw);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!rollIds.includes(ref.rollId) || seen.has(ref.rollId)) {
      throw Object.assign(new Error('مرجع مكرر أو رول خارج المهمة'), { code: 'VALIDATION' });
    }
    seen.add(ref.rollId);
    if (!ref.customerOrderId) continue;
    // Same lock order as order editing: header first, then its line.
    const order = await db.query(`SELECT id FROM customer_orders WHERE company_id=$1 AND id=$2
      AND status NOT IN ('draft','cancelled','completed') FOR SHARE`, [company, ref.customerOrderId]);
    if (!order.rows.length) throw Object.assign(new Error('الأوردر غير متاح للتشغيل أو خارج الشركة'), { code: 'VALIDATION' });
    if (ref.customerOrderLineId) {
      const line = await db.query(`SELECT id FROM customer_order_lines WHERE company_id=$1 AND order_id=$2 AND id=$3 FOR SHARE`,
        [company, ref.customerOrderId, ref.customerOrderLineId]);
      if (!line.rows.length) throw Object.assign(new Error('سطر اللون لا يتبع أوردر الشركة'), { code: 'VALIDATION' });
    }
  }
  return refs;
}

export async function saveExternalReferences(db: Db, company: string, jobId: string,
  refs: z.infer<typeof externalLineReferenceSchema>[]) {
  for (const ref of refs) {
    if (ref.customerOrderId === undefined && ref.customerOrderLineId === undefined) continue;
    await db.query(`UPDATE external_job_lines SET customer_order_id=$4,customer_order_line_id=$5
    WHERE company_id=$1 AND job_id=$2 AND roll_id=$3`,
  [company, jobId, ref.rollId, ref.customerOrderId ?? null, ref.customerOrderLineId ?? null]);
  }
}
