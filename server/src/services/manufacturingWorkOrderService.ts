import type { PoolClient } from 'pg';

export async function generateManufacturingWorkOrderNo(client: PoolClient, companyId: string): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext('MANUFACTURING_WORK_ORDER_NUM'))`, [companyId]);
  const result = await client.query<{ max_seq: string | null }>(
    `SELECT MAX((substring(work_order_no from 3))::int)::text AS max_seq
     FROM manufacturing_work_orders
     WHERE company_id=$1 AND work_order_no ~ '^WO[0-9]{7}$'`,
    [companyId],
  );
  const next = Number(result.rows[0]?.max_seq ?? 0) + 1;
  return `WO${String(next).padStart(7, '0')}`;
}
