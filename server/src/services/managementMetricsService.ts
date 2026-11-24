import type { Pool, PoolClient } from 'pg';
import { getPartyBalances } from './partyBalancesService.js';
import { listPricingQueue } from './pricingQueueService.js';
import { listActiveSessions } from './activeSessionsService.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export type PeriodKind = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';
export interface Period { kind: PeriodKind; from: string; to: string; prevFrom: string; prevTo: string; label: string }
export interface Money { currency: string; total: number; count?: number }

const AR_LABEL: Record<PeriodKind, string> = { today: 'اليوم', yesterday: 'أمس', week: 'هذا الأسبوع', month: 'هذا الشهر', year: 'هذه السنة', custom: 'فترة مخصصة' };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const parse = (s: string) => new Date(s + 'T00:00:00Z');

/** يحدد الفترة والفترة السابقة لها بنفس الطول للمقارنة. الأسبوع يبدأ السبت. */
export function resolvePeriod(kind: PeriodKind, opts: { from?: string; to?: string; today?: string } = {}): Period {
  const today = parse(opts.today ?? iso(new Date()));
  let from = today, to = today;
  if (kind === 'yesterday') { from = to = addDays(today, -1); }
  else if (kind === 'week') { const dow = (today.getUTCDay() + 1) % 7; from = addDays(today, -dow); }
  else if (kind === 'month') { from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); }
  else if (kind === 'year') { from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); }
  else if (kind === 'custom') {
    if (!opts.from || !opts.to || !/^\d{4}-\d{2}-\d{2}$/.test(opts.from) || !/^\d{4}-\d{2}-\d{2}$/.test(opts.to)) throw Object.assign(new Error('حدّد بداية ونهاية الفترة المخصصة'), { code: 'VALIDATION' });
    from = parse(opts.from); to = parse(opts.to);
    if (from > to) throw Object.assign(new Error('بداية الفترة بعد نهايتها'), { code: 'VALIDATION' });
    if ((to.getTime() - from.getTime()) / 86400000 > 3660) throw Object.assign(new Error('الفترة المخصصة أطول من المسموح'), { code: 'VALIDATION' });
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  return { kind, from: iso(from), to: iso(to), prevFrom: iso(addDays(from, -days)), prevTo: iso(addDays(from, -1)), label: AR_LABEL[kind] };
}

export interface BranchMetrics {
  period: Period;
  sales: { current: Money[]; previous: Money[]; topCustomers: Array<{ name: string; currency: string; total: number }>; byItem: Array<{ name: string; currency: string; total: number; meters: number }>; byColor: Array<{ name: string; currency: string; total: number }>; byCreator: Array<{ name: string; currency: string; total: number; count: number }> };
  purchases: { current: Money[]; previous: Money[] };
  inactiveCustomers: { thresholdDays: number; count: number; items: Array<{ id: string; name: string; lastPurchase: string }> };
  orders: { inPreparation: number; awaitingDelivery: number; open: number; late: number };
  balances: { customers: Array<{ currency: string; owedToUs: number; weOwe: number; pendingCheques: number }>; suppliers: Array<{ currency: string; owedToUs: number; weOwe: number }>; customerAlerts: { promiseOverdue: number; limitExceeded: number }; supplierPromiseOverdue: number };
  cash: Money[];
  cheques: { pending: number; overdue: number; pendingByCurrency: Money[] };
  inventory: { available: { rolls: number; meters: number }; reserved: { rolls: number; meters: number }; quarantined: { rolls: number; meters: number }; withoutLocation: number; slowMoving: { thresholdDays: number; rolls: number; meters: number }; pendingTransfers: number };
  external: { open: number; late: number; lateThresholdDays: number; partiallyReceived: number; metersSent: number; metersReceived: number; metersRemaining: number; settlementsInPeriod: Array<{ category: string; meters: number }> };
  production: { open: number; late: number; byStatus: Array<{ status: string; count: number }> };
  waiting: { salesDrafts: number; purchaseDrafts: number; pricingQueue: number; editRequests: number; wasteDrafts: number };
  users: { active: number; onlineNow: number };
  /** مؤشرات طُلبت ولا تدعمها بيانات النظام الحالية — موثّقة بدل اختلاق بدائل. */
  unavailable: Array<{ key: string; label: string; reason: string }>;
}

export const UNAVAILABLE: BranchMetrics['unavailable'] = [
  { key: 'exitPermits', label: 'أذون الخروج بانتظار الموافقة أو التسليم', reason: 'لا يوجد في النظام مستند «إذن خروج» بحالة موافقة؛ المتاح: الطلبيات بانتظار التسليم (ready_pickup).' },
  { key: 'externalSettlementsPending', label: 'التسويات بانتظار الاعتماد (مصنعية خارجية)', reason: 'التسوية تُعتمد لحظة إنشائها (معتمِدها إلزامي)، فلا حالة انتظار.' },
  { key: 'externalExpectedLoss', label: 'الخيسان المتوقع والفروقات (مصنعية خارجية)', reason: 'لا يُخزَّن خيسان متوقع للمهمة؛ المتاح الفعلي فقط حسب سبب التسوية.' },
  { key: 'externalDueDate', label: 'تأخر الإرساليات حسب موعد الاستلام', reason: 'لا يوجد موعد استلام متوقع بالمهمة؛ التأخر محسوب بعمر المهمة المفتوحة (عتبة قابلة للضبط).' },
  { key: 'productionProgress', label: 'نسب إنجاز مراحل الإنتاج والهالك واستهلاك الخيوط والإنتاجية', reason: 'تُعرض تفاصيلها في شاشة التصنيع؛ لا تُجمَّع هنا إلا أعداد الأوامر وتأخرها.' },
  { key: 'salesAgent', label: 'المبيعات حسب «المندوب»', reason: 'لا يوجد حقل مندوب بالفاتورة؛ يُعرض حسب منشئ الفاتورة.' },
  { key: 'dueDates', label: 'تقادم الديون حسب تواريخ الاستحقاق', reason: 'لا توجد تواريخ استحقاق مخزَّنة بالفواتير؛ التقادم من تاريخ الفاتورة على المتبقي الفعلي.' },
];

const m = (rows: Array<{ currency: string; total: string; n?: string }>): Money[] => rows.map((r) => ({ currency: r.currency, total: Number(r.total), ...(r.n !== undefined ? { count: Number(r.n) } : {}) }));

export interface Thresholds { inactiveCustomerDays: number; slowStockDays: number; externalLateDays: number }
export const DEFAULT_THRESHOLDS: Thresholds = { inactiveCustomerDays: 60, slowStockDays: 90, externalLateDays: 30 };

export async function getBranchMetrics(db: Db, companyId: string, period: Period, thresholds: Thresholds = DEFAULT_THRESHOLDS): Promise<BranchMetrics> {
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, [companyId, ...params])).rows;
  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0];
  const { from, to, prevFrom, prevTo } = period;

  const salesBy = (f: string, t: string) => q<{ currency: string; total: string; n: string }>(
    `SELECT currency_code AS currency, COALESCE(sum(total_amount),0)::text AS total, count(*)::text AS n FROM sales_invoices
      WHERE company_id=$1 AND document_status='CONFIRMED' AND invoice_date BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`, [f, t]);
  const purchBy = (f: string, t: string) => q<{ currency: string; total: string; n: string }>(
    `SELECT currency_code AS currency, COALESCE(sum(total_amount),0)::text AS total, count(*)::text AS n FROM purchase_invoices
      WHERE company_id=$1 AND document_status='CONFIRMED' AND invoice_date BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`, [f, t]);

  const topCust = await q<{ name: string; currency: string; total: string }>(
    `SELECT c.name, si.currency_code AS currency, sum(si.total_amount)::text AS total FROM sales_invoices si JOIN customers c ON c.id=si.customer_id AND c.company_id=si.company_id
      WHERE si.company_id=$1 AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date GROUP BY c.name, si.currency_code ORDER BY sum(si.total_amount) DESC LIMIT 10`, [from, to]);
  const byItem = await q<{ name: string; currency: string; total: string; meters: string }>(
    `SELECT COALESCE(fi.name, l.description, '—') AS name, si.currency_code AS currency, sum(l.line_total)::text AS total, COALESCE(sum(l.quantity) FILTER (WHERE l.unit='meter'),0)::text AS meters
       FROM sales_invoice_lines l JOIN sales_invoices si ON si.id=l.invoice_id AND si.company_id=l.company_id LEFT JOIN fabric_items fi ON fi.id=l.fabric_item_id
      WHERE si.company_id=$1 AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY sum(l.line_total) DESC LIMIT 10`, [from, to]);
  const byColor = await q<{ name: string; currency: string; total: string }>(
    `SELECT COALESCE(fc.name_ar, fc.color_code, '—') AS name, si.currency_code AS currency, sum(l.line_total)::text AS total
       FROM sales_invoice_lines l JOIN sales_invoices si ON si.id=l.invoice_id AND si.company_id=l.company_id JOIN fabric_rolls fr ON fr.id=l.fabric_roll_id LEFT JOIN fabric_colors fc ON fc.id=fr.color_id
      WHERE si.company_id=$1 AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY sum(l.line_total) DESC LIMIT 10`, [from, to]);
  const byCreator = await q<{ name: string; currency: string; total: string; n: string }>(
    `SELECT COALESCE(u.full_name, u.username, '—') AS name, si.currency_code AS currency, sum(si.total_amount)::text AS total, count(*)::text AS n
       FROM sales_invoices si LEFT JOIN users u ON u.id=si.created_by_user_id
      WHERE si.company_id=$1 AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY sum(si.total_amount) DESC LIMIT 10`, [from, to]);

  const inactive = await q<{ id: string; name: string; last: string }>(
    `SELECT c.id, c.name, max(si.invoice_date)::text AS last FROM customers c JOIN sales_invoices si ON si.customer_id=c.id AND si.company_id=c.company_id AND si.document_status='CONFIRMED'
      WHERE c.company_id=$1 AND c.is_active GROUP BY c.id, c.name HAVING max(si.invoice_date) < current_date - $2::int ORDER BY max(si.invoice_date) DESC LIMIT 200`, [thresholds.inactiveCustomerDays]);

  const orders = await one<{ prep: string; deliver: string; open: string; late: string }>(
    `SELECT count(*) FILTER (WHERE status IN ('pending_supply','partial_ready'))::text AS prep, count(*) FILTER (WHERE status='ready_pickup')::text AS deliver,
            count(*) FILTER (WHERE status IN ('pending_supply','partial_ready','ready_pickup'))::text AS open,
            count(*) FILTER (WHERE status IN ('pending_supply','partial_ready','ready_pickup') AND expected_date < current_date)::text AS late
       FROM customer_orders WHERE company_id=$1`);

  const [custBal, supBal] = await Promise.all([getPartyBalances(db, companyId, 'CUSTOMER', {}), getPartyBalances(db, companyId, 'SUPPLIER', {})]);

  const cash = await q<{ currency: string; total: string }>(
    `SELECT currency_code AS currency, COALESCE(sum(current_balance),0)::text AS total FROM cashboxes WHERE company_id=$1 AND is_active AND account_kind <> 'CHECKS' GROUP BY 1 ORDER BY 1`);
  const chq = await one<{ pending: string; overdue: string }>(
    `SELECT count(*)::text AS pending, count(*) FILTER (WHERE due_date < current_date)::text AS overdue FROM checks WHERE company_id=$1 AND status IN ('RECEIVED','DEPOSITED') AND party_type='CUSTOMER'`);
  const chqBy = await q<{ currency: string; total: string }>(
    `SELECT currency_code AS currency, COALESCE(sum(amount),0)::text AS total FROM checks WHERE company_id=$1 AND status IN ('RECEIVED','DEPOSITED') AND party_type='CUSTOMER' GROUP BY 1 ORDER BY 1`);

  const inv = await one<{ av_n: string; av_m: string; rs_n: string; rs_m: string; q_n: string; q_m: string; noloc: string; tr: string }>(
    `SELECT count(*) FILTER (WHERE status='AVAILABLE')::text AS av_n, COALESCE(sum(length_m) FILTER (WHERE status='AVAILABLE'),0)::text AS av_m,
            count(*) FILTER (WHERE status='RESERVED')::text AS rs_n, COALESCE(sum(length_m) FILTER (WHERE status='RESERVED'),0)::text AS rs_m,
            count(*) FILTER (WHERE status='DAMAGED' OR EXISTS (SELECT 1 FROM external_job_return_lines q WHERE q.result_roll_id=fabric_rolls.id AND q.company_id=fabric_rolls.company_id AND q.defective AND q.resolution IS NULL))::text AS q_n,
            COALESCE(sum(length_m) FILTER (WHERE status='DAMAGED' OR EXISTS (SELECT 1 FROM external_job_return_lines q WHERE q.result_roll_id=fabric_rolls.id AND q.company_id=fabric_rolls.company_id AND q.defective AND q.resolution IS NULL)),0)::text AS q_m,
            count(*) FILTER (WHERE status IN ('AVAILABLE','RESERVED') AND location_id IS NULL)::text AS noloc,
            (SELECT count(*) FROM inventory_transfers t WHERE t.company_id=$1 AND t.status='DRAFT')::text AS tr
       FROM fabric_rolls WHERE company_id=$1`);
  const slow = await one<{ n: string; m: string }>(
    `SELECT count(*)::text AS n, COALESCE(sum(r.length_m),0)::text AS m FROM fabric_rolls r
      WHERE r.company_id=$1 AND r.status='AVAILABLE' AND r.length_m > 0
        AND GREATEST(r.created_at, COALESCE((SELECT max(im.created_at) FROM inventory_movements im WHERE im.roll_id=r.id AND im.company_id=r.company_id), r.created_at)) < now() - make_interval(days => $2::int)`, [thresholds.slowStockDays]);

  const ext = await one<{ open: string; late: string; partial: string; sent: string; remaining: string }>(
    `SELECT count(*) FILTER (WHERE j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL)::text AS open,
            count(*) FILTER (WHERE j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL AND j.sent_date < current_date - $2::int)::text AS late,
            count(*) FILTER (WHERE j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL
                              AND EXISTS (SELECT 1 FROM external_job_return_lines rl WHERE rl.job_id=j.id AND rl.company_id=j.company_id)
                              AND EXISTS (SELECT 1 FROM external_job_lines l WHERE l.job_id=j.id AND l.company_id=j.company_id AND l.line_status='SENT'))::text AS partial,
            COALESCE(sum((SELECT sum(l.sent_length_m) FROM external_job_lines l WHERE l.job_id=j.id AND l.company_id=j.company_id AND l.line_status<>'CANCELLED')) FILTER (WHERE j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL),0)::text AS sent,
            COALESCE(sum((SELECT sum(l.sent_length_m) FROM external_job_lines l WHERE l.job_id=j.id AND l.company_id=j.company_id AND l.line_status='SENT')) FILTER (WHERE j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL),0)::text AS remaining
       FROM external_jobs j WHERE j.company_id=$1`, [thresholds.externalLateDays]);
  const recv = await one<{ legacy: string; lifecycle: string }>(
    `SELECT COALESCE((SELECT sum(l.new_length_m) FROM external_job_lines l JOIN external_jobs j ON j.id=l.job_id AND j.company_id=l.company_id WHERE l.company_id=$1 AND l.line_status='RECEIVED' AND j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL),0)::text AS legacy,
            COALESCE((SELECT sum(rl.length_m) FROM external_job_return_lines rl JOIN external_jobs j ON j.id=rl.job_id AND j.company_id=rl.company_id WHERE rl.company_id=$1 AND j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL),0)::text AS lifecycle`);
  const settle = await q<{ category: string; meters: string }>(
    `SELECT COALESCE(reason_category, kind) AS category, sum(amount_m)::text AS meters FROM external_job_settlements WHERE company_id=$1 AND approved_at::date BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`, [from, to]);

  const wo = await q<{ status: string; n: string; late: string }>(
    `SELECT status, count(*)::text AS n, count(*) FILTER (WHERE status IN ('DRAFT','RELEASED','IN_PROGRESS') AND planned_end_date < current_date)::text AS late FROM manufacturing_work_orders WHERE company_id=$1 GROUP BY status`);

  const wait = await one<{ s: string; p: string; e: string; w: string }>(
    `SELECT (SELECT count(*) FROM sales_invoices WHERE company_id=$1 AND document_status='DRAFT')::text AS s, (SELECT count(*) FROM purchase_invoices WHERE company_id=$1 AND document_status='DRAFT')::text AS p,
            (SELECT count(*) FROM edit_requests WHERE company_id=$1 AND status='PENDING')::text AS e, (SELECT count(*) FROM inventory_waste_records WHERE company_id=$1 AND status='DRAFT')::text AS w`);
  const pricing = await listPricingQueue(db, companyId);
  const users = await one<{ active: string }>('SELECT count(*) FILTER (WHERE is_active)::text AS active FROM users WHERE company_id=$1');

  const open = wo.filter((r) => ['RELEASED', 'IN_PROGRESS'].includes(r.status)).reduce((s, r) => s + Number(r.n), 0);
  return {
    period,
    sales: {
      current: m(await salesBy(from, to)), previous: m(await salesBy(prevFrom, prevTo)),
      topCustomers: topCust.map((r) => ({ name: r.name, currency: r.currency, total: Number(r.total) })),
      byItem: byItem.map((r) => ({ name: r.name, currency: r.currency, total: Number(r.total), meters: Number(r.meters) })),
      byColor: byColor.map((r) => ({ name: r.name, currency: r.currency, total: Number(r.total) })),
      byCreator: byCreator.map((r) => ({ name: r.name, currency: r.currency, total: Number(r.total), count: Number(r.n) })),
    },
    purchases: { current: m(await purchBy(from, to)), previous: m(await purchBy(prevFrom, prevTo)) },
    inactiveCustomers: { thresholdDays: thresholds.inactiveCustomerDays, count: inactive.length, items: inactive.slice(0, 15).map((r) => ({ id: r.id, name: r.name, lastPurchase: r.last })) },
    orders: { inPreparation: Number(orders.prep), awaitingDelivery: Number(orders.deliver), open: Number(orders.open), late: Number(orders.late) },
    balances: {
      customers: custBal.totals.map((t) => ({ currency: t.currency, owedToUs: t.owedToUs, weOwe: t.weOwe, pendingCheques: t.pendingCheques })),
      suppliers: supBal.totals.map((t) => ({ currency: t.currency, owedToUs: t.owedToUs, weOwe: t.weOwe })),
      customerAlerts: { promiseOverdue: custBal.rows.filter((r) => r.alerts.promiseOverdue).length, limitExceeded: custBal.rows.filter((r) => r.alerts.limitExceeded).length },
      supplierPromiseOverdue: supBal.rows.filter((r) => r.alerts.promiseOverdue).length,
    },
    cash: m(cash),
    cheques: { pending: Number(chq.pending), overdue: Number(chq.overdue), pendingByCurrency: m(chqBy) },
    inventory: {
      available: { rolls: Number(inv.av_n), meters: Number(inv.av_m) }, reserved: { rolls: Number(inv.rs_n), meters: Number(inv.rs_m) },
      quarantined: { rolls: Number(inv.q_n), meters: Number(inv.q_m) }, withoutLocation: Number(inv.noloc),
      slowMoving: { thresholdDays: thresholds.slowStockDays, rolls: Number(slow.n), meters: Number(slow.m) }, pendingTransfers: Number(inv.tr),
    },
    external: {
      open: Number(ext.open), late: Number(ext.late), lateThresholdDays: thresholds.externalLateDays, partiallyReceived: Number(ext.partial),
      metersSent: Number(ext.sent), metersReceived: Number(recv.legacy) + Number(recv.lifecycle), metersRemaining: Number(ext.remaining),
      settlementsInPeriod: settle.map((r) => ({ category: r.category, meters: Number(r.meters) })),
    },
    production: { open, late: wo.reduce((s, r) => s + Number(r.late), 0), byStatus: wo.map((r) => ({ status: r.status, count: Number(r.n) })) },
    waiting: { salesDrafts: Number(wait.s), purchaseDrafts: Number(wait.p), pricingQueue: pricing.total, editRequests: Number(wait.e), wasteDrafts: Number(wait.w) },
    users: { active: Number(users.active), onlineNow: listActiveSessions(companyId).length },
    unavailable: UNAVAILABLE,
  };
}
