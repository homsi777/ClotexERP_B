import type { Pool, PoolClient } from 'pg';
import { listActiveSessions } from './activeSessionsService.js';
import { listPricingQueue } from './pricingQueueService.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type CurrencyAmount = { currency: string; total: number; count?: number };

export interface BranchOverview {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  users: { active: number; onlineNow: number; custom: number };
  lastActivityAt: string | null;
  sales30d: CurrencyAmount[];
  purchases30d: CurrencyAmount[];
  receivables: CurrencyAmount[];
  payables: CurrencyAmount[];
  cash: CurrencyAmount[];
  inventory: { availableRolls: number; availableMeters: number };
  cheques: { pending: number; overdue: number; pendingByCurrency: CurrencyAmount[] };
  waiting: { salesDrafts: number; purchaseDrafts: number; pricingQueue: number; editRequests: number; wasteDrafts: number };
}

const money = (rows: Array<{ currency: string; total: string; n?: string }>): CurrencyAmount[] =>
  rows.map((r) => ({ currency: r.currency, total: Number(r.total), ...(r.n !== undefined ? { count: Number(r.n) } : {}) }));

/**
 * لوحة المالك: ملخص قراءة فقط لكل فرع. المبالغ تُعرض لكل عملة على حدة ولا تُحوَّل ولا تُجمع مع عملة أخرى.
 */
export async function getPlatformOverview(db: Db): Promise<{ generatedAt: string; branches: BranchOverview[]; recentActivity: Array<Record<string, unknown>> }> {
  const companies = await db.query<{ id: string; code: string; name: string; is_active: boolean }>(
    'SELECT id, code, name, is_active FROM companies ORDER BY code');
  const branches: BranchOverview[] = [];
  for (const c of companies.rows) {
    const q = async <T extends Record<string, unknown>>(sql: string) => (await db.query<T>(sql, [c.id])).rows;
    const one = async <T extends Record<string, unknown>>(sql: string) => (await q<T>(sql))[0];

    const users = await one<{ active: string; custom: string }>(
      `SELECT count(*) FILTER (WHERE is_active) AS active, count(*) FILTER (WHERE is_active AND perm_mode='CUSTOM') AS custom FROM users WHERE company_id=$1`);
    const last = await one<{ t: string | null }>('SELECT max(created_at)::text AS t FROM audit_logs WHERE company_id=$1');
    const sales30 = await q<{ currency: string; total: string; n: string }>(
      `SELECT currency_code AS currency, COALESCE(sum(total_amount),0)::text AS total, count(*)::text AS n FROM sales_invoices
        WHERE company_id=$1 AND document_status='CONFIRMED' AND invoice_date >= current_date - 30 GROUP BY 1 ORDER BY 1`);
    const purchases30 = await q<{ currency: string; total: string; n: string }>(
      `SELECT currency_code AS currency, COALESCE(sum(total_amount),0)::text AS total, count(*)::text AS n FROM purchase_invoices
        WHERE company_id=$1 AND document_status='CONFIRMED' AND invoice_date >= current_date - 30 GROUP BY 1 ORDER BY 1`);
    const receivables = await q<{ currency: string; total: string }>(
      `SELECT currency_code AS currency, COALESCE(sum(remaining_amount),0)::text AS total FROM sales_invoices
        WHERE company_id=$1 AND document_status='CONFIRMED' AND remaining_amount > 0 GROUP BY 1 ORDER BY 1`);
    const payables = await q<{ currency: string; total: string }>(
      `SELECT currency_code AS currency, COALESCE(sum(remaining_amount),0)::text AS total FROM purchase_invoices
        WHERE company_id=$1 AND document_status='CONFIRMED' AND remaining_amount > 0 GROUP BY 1 ORDER BY 1`);
    const cash = await q<{ currency: string; total: string }>(
      `SELECT currency_code AS currency, COALESCE(sum(current_balance),0)::text AS total FROM cashboxes
        WHERE company_id=$1 AND is_active AND account_kind <> 'CHECKS' GROUP BY 1 ORDER BY 1`);
    const inv = await one<{ n: string; m: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(length_m),0)::text AS m FROM fabric_rolls WHERE company_id=$1 AND status IN ('AVAILABLE','RESERVED')`);
    const chq = await one<{ pending: string; overdue: string }>(
      `SELECT count(*)::text AS pending, count(*) FILTER (WHERE due_date < current_date)::text AS overdue FROM checks
        WHERE company_id=$1 AND status IN ('RECEIVED','DEPOSITED') AND party_type='CUSTOMER'`);
    const chqBy = await q<{ currency: string; total: string }>(
      `SELECT currency_code AS currency, COALESCE(sum(amount),0)::text AS total FROM checks
        WHERE company_id=$1 AND status IN ('RECEIVED','DEPOSITED') AND party_type='CUSTOMER' GROUP BY 1 ORDER BY 1`);
    const drafts = await one<{ s: string; p: string; e: string; w: string }>(
      `SELECT (SELECT count(*) FROM sales_invoices WHERE company_id=$1 AND document_status='DRAFT')::text AS s,
              (SELECT count(*) FROM purchase_invoices WHERE company_id=$1 AND document_status='DRAFT')::text AS p,
              (SELECT count(*) FROM edit_requests WHERE company_id=$1 AND status='PENDING')::text AS e,
              (SELECT count(*) FROM inventory_waste_records WHERE company_id=$1 AND status='DRAFT')::text AS w`);
    const pricing = await listPricingQueue(db, c.id);

    branches.push({
      id: c.id, code: c.code, name: c.name, isActive: c.is_active,
      users: { active: Number(users.active), onlineNow: listActiveSessions(c.id).length, custom: Number(users.custom) },
      lastActivityAt: last.t,
      sales30d: money(sales30), purchases30d: money(purchases30), receivables: money(receivables), payables: money(payables), cash: money(cash),
      inventory: { availableRolls: Number(inv.n), availableMeters: Number(inv.m) },
      cheques: { pending: Number(chq.pending), overdue: Number(chq.overdue), pendingByCurrency: money(chqBy) },
      waiting: { salesDrafts: Number(drafts.s), purchaseDrafts: Number(drafts.p), pricingQueue: pricing.total, editRequests: Number(drafts.e), wasteDrafts: Number(drafts.w) },
    });
  }
  const recent = await db.query(
    `SELECT a.created_at::text AS at, c.name AS branch, COALESCE(u.username,'—') AS username, a.action, a.entity_type
       FROM audit_logs a LEFT JOIN companies c ON c.id=a.company_id LEFT JOIN users u ON u.id=a.user_id
      ORDER BY a.created_at DESC LIMIT 25`);
  return { generatedAt: new Date().toISOString(), branches, recentActivity: recent.rows };
}
