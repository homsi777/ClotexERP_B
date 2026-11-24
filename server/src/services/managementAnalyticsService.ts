import type { Pool, PoolClient } from 'pg';
import { getPartyBalances } from './partyBalancesService.js';
import type { Period } from './managementMetricsService.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export interface SeriesPoint { bucket: string; currency: string; total: number }

/**
 * بيانات الرسوم البيانية للفرع (تُحمَّل عند الطلب لا مع الصفحة الرئيسية). كلها من بيانات فعلية، لكل عملة على حدة.
 * الفترة حتى 92 يوماً: تجميع يومي؛ الأطول: شهري.
 */
export async function getBranchAnalytics(db: Db, companyId: string, period: Period) {
  const { from, to } = period;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const unit = days > 92 ? 'month' : 'day';
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, [companyId, ...params])).rows;
  const toPoints = (rows: Array<{ bucket: string; currency: string; total: string }>): SeriesPoint[] => rows.map((r) => ({ bucket: r.bucket, currency: r.currency, total: Number(r.total) }));

  const sales = await q<{ bucket: string; currency: string; total: string }>(
    `SELECT date_trunc($4, invoice_date)::date::text AS bucket, currency_code AS currency, sum(total_amount)::text AS total FROM sales_invoices
      WHERE company_id=$1 AND document_status='CONFIRMED' AND invoice_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY 1, 2`, [from, to, unit]);
  const purchases = await q<{ bucket: string; currency: string; total: string }>(
    `SELECT date_trunc($4, invoice_date)::date::text AS bucket, currency_code AS currency, sum(total_amount)::text AS total FROM purchase_invoices
      WHERE company_id=$1 AND document_status='CONFIRMED' AND invoice_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY 1, 2`, [from, to, unit]);
  const receipts = await q<{ bucket: string; currency: string; total: string }>(
    `SELECT date_trunc($4, voucher_date)::date::text AS bucket, currency_code AS currency, sum(amount)::text AS total FROM vouchers
      WHERE company_id=$1 AND status='CONFIRMED' AND voucher_type='RECEIPT' AND voucher_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY 1, 2`, [from, to, unit]);
  const payments = await q<{ bucket: string; currency: string; total: string }>(
    `SELECT date_trunc($4, voucher_date)::date::text AS bucket, currency_code AS currency, sum(amount)::text AS total FROM vouchers
      WHERE company_id=$1 AND status='CONFIRMED' AND voucher_type='PAYMENT' AND voucher_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY 1, 2`, [from, to, unit]);
  const cashTotals = async (f: string, t: string) => q<{ currency: string; kind: string; total: string }>(
    `SELECT currency_code AS currency, voucher_type AS kind, sum(amount)::text AS total FROM vouchers
      WHERE company_id=$1 AND status='CONFIRMED' AND voucher_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY 1, 2`, [f, t]);
  const [curCash, prevCash] = [await cashTotals(from, to), await cashTotals(period.prevFrom, period.prevTo)];
  const fold = (rows: Array<{ currency: string; kind: string; total: string }>) => {
    const out = new Map<string, { currency: string; receipts: number; payments: number }>();
    for (const r of rows) { const e = out.get(r.currency) ?? { currency: r.currency, receipts: 0, payments: 0 }; if (r.kind === 'RECEIPT') e.receipts = Number(r.total); else e.payments = Number(r.total); out.set(r.currency, e); }
    return [...out.values()];
  };

  // تقادم ديون العملاء: مجموع شرائح كل عملة (من تاريخ الفاتورة؛ لا تواريخ استحقاق مخزّنة)
  const cust = await getPartyBalances(db, companyId, 'CUSTOMER', {});
  const aging = new Map<string, { currency: string; d0_30: number; d31_60: number; d61_90: number; d90plus: number; unallocated: number }>();
  for (const row of cust.rows) for (const c of row.currencies) {
    if (!(c.balance > 0)) continue; // الدين فقط (على العميل)
    const e = aging.get(c.currency) ?? { currency: c.currency, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, unallocated: 0 };
    e.d0_30 += c.aging.d0_30; e.d31_60 += c.aging.d31_60; e.d61_90 += c.aging.d61_90; e.d90plus += c.aging.d90plus; e.unallocated += c.aging.unallocated; aging.set(c.currency, e);
  }

  const byStatus = await q<{ status: string; n: string; m: string; kg: string }>(
    `SELECT status, count(*)::text AS n, COALESCE(sum(length_m),0)::text AS m, COALESCE(sum(COALESCE(actual_weight_kg, calculated_weight_kg)),0)::text AS kg FROM fabric_rolls WHERE company_id=$1 AND status IN ('AVAILABLE','RESERVED','DAMAGED') GROUP BY 1 ORDER BY 1`);
  const byWarehouse = await q<{ name: string; n: string; m: string }>(
    `SELECT w.name, count(*)::text AS n, COALESCE(sum(r.length_m),0)::text AS m FROM fabric_rolls r JOIN warehouses w ON w.id=r.warehouse_id WHERE r.company_id=$1 AND r.status IN ('AVAILABLE','RESERVED') GROUP BY 1 ORDER BY sum(r.length_m) DESC LIMIT 20`);

  return {
    period, bucketUnit: unit as 'day' | 'month',
    sales: toPoints(sales), purchases: toPoints(purchases), receipts: toPoints(receipts), payments: toPoints(payments),
    cashMovement: { current: fold(curCash), previous: fold(prevCash) },
    customerAging: [...aging.values()], agingNote: 'التقادم من تاريخ الفاتورة على المتبقي الفعلي (لا تواريخ استحقاق مخزَّنة)، والمتبقي غير المفسَّر بفواتير مفتوحة في «غير مخصص».',
    inventoryByStatus: byStatus.map((r) => ({ status: r.status, rolls: Number(r.n), meters: Number(r.m), kg: Number(r.kg) })),
    inventoryByWarehouse: byWarehouse.map((r) => ({ warehouse: r.name, rolls: Number(r.n), meters: Number(r.m) })),
  };
}
