import type { Pool, PoolClient } from 'pg';
import { getPartyBalances } from './partyBalancesService.js';
import { listPricingQueue } from './pricingQueueService.js';
import { DEFAULT_THRESHOLDS, getBranchMetrics, resolvePeriod, type Thresholds } from './managementMetricsService.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED';
const fail = (m: string, code = 'VALIDATION') => Object.assign(new Error(m), { code });

export interface AlertSettings { inactiveCustomerDays: number; slowStockDays: number; externalLateDays: number; draftAgeDays: number; chequeDueSoonDays: number; disabledTypes: string[] }
export const DEFAULT_ALERT_SETTINGS: AlertSettings = { inactiveCustomerDays: 60, slowStockDays: 90, externalLateDays: 30, draftAgeDays: 3, chequeDueSoonDays: 7, disabledTypes: [] };
export const ALERT_TYPES: Array<{ type: string; label: string }> = [
  { type: 'CHEQUE_OVERDUE', label: 'شيك متأخر التحصيل' }, { type: 'CHEQUE_DUE_SOON', label: 'شيك يستحق قريباً' },
  { type: 'CREDIT_LIMIT', label: 'تجاوز حد الائتمان' }, { type: 'PROMISE_OVERDUE', label: 'تجاوز موعد التحصيل/السداد' },
  { type: 'PRICING_WAITING', label: 'مستند بانتظار التسعير' }, { type: 'DRAFT_STALE', label: 'مسودة فاتورة متأخرة' },
  { type: 'ORDER_LATE', label: 'طلبية متأخرة' }, { type: 'EXTERNAL_LATE', label: 'مصنعية خارجية متأخرة' },
  { type: 'WORKORDER_LATE', label: 'أمر إنتاج متأخر' }, { type: 'TRANSFER_STALE', label: 'مناقلة معلّقة قديمة' },
];

export async function getAlertSettings(db: Db, companyId: string): Promise<AlertSettings> {
  const r = (await db.query<Record<string, unknown>>('SELECT * FROM alert_settings WHERE company_id=$1', [companyId])).rows[0];
  if (!r) return { ...DEFAULT_ALERT_SETTINGS };
  return {
    inactiveCustomerDays: Number(r.inactive_customer_days), slowStockDays: Number(r.slow_stock_days), externalLateDays: Number(r.external_late_days),
    draftAgeDays: Number(r.draft_age_days), chequeDueSoonDays: Number(r.cheque_due_soon_days), disabledTypes: (r.disabled_types as string[]) ?? [],
  };
}
export const thresholdsOf = (s: AlertSettings): Thresholds => ({ inactiveCustomerDays: s.inactiveCustomerDays, slowStockDays: s.slowStockDays, externalLateDays: s.externalLateDays });

export async function saveAlertSettings(db: Db, companyId: string, userId: string, input: Partial<AlertSettings>): Promise<AlertSettings> {
  const cur = await getAlertSettings(db, companyId);
  const n = { ...cur, ...input };
  const within = (v: number, lo: number, hi: number, label: string) => { if (!Number.isInteger(v) || v < lo || v > hi) throw fail(`${label} يجب أن يكون بين ${lo} و${hi}`); };
  within(n.inactiveCustomerDays, 7, 730, 'أيام توقف العميل'); within(n.slowStockDays, 7, 730, 'أيام الركود'); within(n.externalLateDays, 3, 365, 'أيام تأخر المصنعية');
  within(n.draftAgeDays, 1, 60, 'أيام عمر المسودة'); within(n.chequeDueSoonDays, 1, 60, 'أيام قرب الاستحقاق');
  const known = new Set(ALERT_TYPES.map((t) => t.type));
  if (n.disabledTypes.some((t) => !known.has(t))) throw fail('نوع تنبيه غير معروف');
  await db.query(
    `INSERT INTO alert_settings (company_id, inactive_customer_days, slow_stock_days, external_late_days, draft_age_days, cheque_due_soon_days, disabled_types, updated_by_user_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (company_id) DO UPDATE SET inactive_customer_days=EXCLUDED.inactive_customer_days, slow_stock_days=EXCLUDED.slow_stock_days, external_late_days=EXCLUDED.external_late_days,
       draft_age_days=EXCLUDED.draft_age_days, cheque_due_soon_days=EXCLUDED.cheque_due_soon_days, disabled_types=EXCLUDED.disabled_types, updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()`,
    [companyId, n.inactiveCustomerDays, n.slowStockDays, n.externalLateDays, n.draftAgeDays, n.chequeDueSoonDays, n.disabledTypes, userId]);
  return n;
}

export interface ComputedAlert { key: string; type: string; severity: Severity; title: string; detail: string; href: string }

/** يحسب التنبيهات الحالية من بيانات الفرع الفعلية (لا بيانات بديلة). المفتاح يحدّد الكيان فلا تتكرر. */
export async function computeAlerts(db: Db, companyId: string, s: AlertSettings): Promise<ComputedAlert[]> {
  const out: ComputedAlert[] = [];
  const enabled = (t: string) => !s.disabledTypes.includes(t);
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, [companyId, ...params])).rows;

  if (enabled('CHEQUE_OVERDUE') || enabled('CHEQUE_DUE_SOON')) {
    for (const r of await q<{ id: string; check_no: string; party_name: string | null; amount: string; currency_code: string; due_date: string; late: boolean }>(
      `SELECT id, check_no, party_name, amount, currency_code, due_date::text, (due_date < current_date) AS late FROM checks
        WHERE company_id=$1 AND status IN ('RECEIVED','DEPOSITED') AND party_type='CUSTOMER' AND due_date <= current_date + $2::int ORDER BY due_date LIMIT 200`, [s.chequeDueSoonDays])) {
      const type = r.late ? 'CHEQUE_OVERDUE' : 'CHEQUE_DUE_SOON';
      if (!enabled(type)) continue;
      out.push({ key: `${type}:${r.id}`, type, severity: r.late ? 'HIGH' : 'MEDIUM', title: `${r.late ? 'شيك متأخر' : 'شيك يستحق قريباً'} ${r.check_no}${r.party_name ? ` — ${r.party_name}` : ''}`,
        detail: `${Number(r.amount).toLocaleString('en-US')} ${r.currency_code} · الاستحقاق ${r.due_date}`, href: `/treasury/checks-vault?check=${r.id}&search=${encodeURIComponent(r.check_no)}` });
    }
  }
  if (enabled('CREDIT_LIMIT') || enabled('PROMISE_OVERDUE')) {
    for (const [kind, base] of [['CUSTOMER', '/customers/balances'], ['SUPPLIER', '/suppliers/balances']] as const) {
      const res = await getPartyBalances(db, companyId, kind, {});
      for (const r of res.rows) {
        const href = `${base}?search=${encodeURIComponent(r.name)}`;
        if (r.alerts.limitExceeded && enabled('CREDIT_LIMIT')) {
          const c = r.currencies.find((x) => x.limitExceeded)!;
          out.push({ key: `CREDIT_LIMIT:${r.id}`, type: 'CREDIT_LIMIT', severity: 'HIGH', title: `تجاوز حد الائتمان — ${r.name}`, detail: `الرصيد ${c.balance.toLocaleString('en-US')} ${c.currency} > الحد ${c.creditLimit?.toLocaleString('en-US')}`, href });
        }
        if (r.alerts.promiseOverdue && enabled('PROMISE_OVERDUE')) {
          out.push({ key: `PROMISE_OVERDUE:${kind}:${r.id}`, type: 'PROMISE_OVERDUE', severity: 'MEDIUM', title: `تجاوز موعد ${kind === 'CUSTOMER' ? 'التحصيل' : 'السداد'} — ${r.name}`, detail: `الموعد ${r.profile?.expectedCollectionDate ?? ''}${r.profile?.ownerName ? ` · المسؤول ${r.profile.ownerName}` : ''}`, href });
        }
      }
    }
  }
  if (enabled('PRICING_WAITING')) {
    const pq = await listPricingQueue(db, companyId);
    for (const it of pq.items) {
      const href = it.kind === 'SALES' ? `/invoices/sales/${it.id}/edit` : it.kind === 'EXTERNAL' ? `/purchases/external-jobs/${it.id}?tab=pricing` : `/invoices/purchases/${it.id}/edit`;
      out.push({ key: `PRICING_WAITING:${it.kind}:${it.id}`, type: 'PRICING_WAITING', severity: 'MEDIUM', title: `بانتظار التسعير — ${it.invoiceNo}`, detail: it.partyName, href });
    }
  }
  if (enabled('DRAFT_STALE')) {
    for (const r of await q<{ id: string; no: string; kind: string; party: string | null; age: number }>(
      `SELECT si.id, si.invoice_no AS no, 'SALES' AS kind, c.name AS party, (current_date - si.invoice_date)::int AS age FROM sales_invoices si LEFT JOIN customers c ON c.id=si.customer_id AND c.company_id=si.company_id
        WHERE si.company_id=$1 AND si.document_status='DRAFT' AND si.invoice_date < current_date - $2::int
       UNION ALL
       SELECT pi.id, pi.invoice_no, 'PURCHASE', s2.name, (current_date - pi.invoice_date)::int FROM purchase_invoices pi LEFT JOIN suppliers s2 ON s2.id=pi.supplier_id AND s2.company_id=pi.company_id
        WHERE pi.company_id=$1 AND pi.document_status='DRAFT' AND pi.invoice_date < current_date - $2::int LIMIT 200`, [s.draftAgeDays])) {
      out.push({ key: `DRAFT_STALE:${r.kind}:${r.id}`, type: 'DRAFT_STALE', severity: 'LOW', title: `مسودة ${r.kind === 'SALES' ? 'بيع' : 'شراء'} متأخرة ${r.no}`, detail: `${r.party ?? ''} · عمرها ${r.age} يوماً`, href: r.kind === 'SALES' ? `/invoices/sales/${r.id}/edit` : `/invoices/purchases/${r.id}/edit` });
    }
  }
  if (enabled('ORDER_LATE')) {
    for (const r of await q<{ id: string; order_no: string; party: string | null; expected: string; age: number }>(
      `SELECT o.id, o.order_no, c.name AS party, o.expected_date::text AS expected, (current_date - o.expected_date)::int AS age FROM customer_orders o LEFT JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id
        WHERE o.company_id=$1 AND o.status IN ('pending_supply','partial_ready','ready_pickup') AND o.expected_date < current_date ORDER BY o.expected_date LIMIT 200`)) {
      out.push({ key: `ORDER_LATE:${r.id}`, type: 'ORDER_LATE', severity: r.age > 14 ? 'HIGH' : 'MEDIUM', title: `طلبية متأخرة ${r.order_no}`, detail: `${r.party ?? ''} · الموعد ${r.expected} (تأخر ${r.age} يوماً)`, href: `/orders?order=${r.id}` });
    }
  }
  if (enabled('EXTERNAL_LATE')) {
    for (const r of await q<{ id: string; job_no: string; supplier: string | null; age: number }>(
      `SELECT j.id, j.job_no, s.name AS supplier, (current_date - j.sent_date)::int AS age FROM external_jobs j LEFT JOIN suppliers s ON s.id=j.supplier_id AND s.company_id=j.company_id
        WHERE j.company_id=$1 AND j.document_status='CONFIRMED' AND j.lifecycle_closed_at IS NULL AND j.sent_date < current_date - $2::int ORDER BY j.sent_date LIMIT 200`, [s.externalLateDays])) {
      out.push({ key: `EXTERNAL_LATE:${r.id}`, type: 'EXTERNAL_LATE', severity: 'MEDIUM', title: `مصنعية خارجية متأخرة ${r.job_no}`, detail: `${r.supplier ?? ''} · مفتوحة منذ ${r.age} يوماً`, href: `/purchases/external-jobs/${r.id}` });
    }
  }
  if (enabled('WORKORDER_LATE')) {
    for (const r of await q<{ id: string; work_order_no: string; planned_end_date: string }>(
      `SELECT id, work_order_no, planned_end_date::text FROM manufacturing_work_orders WHERE company_id=$1 AND status IN ('RELEASED','IN_PROGRESS') AND planned_end_date < current_date ORDER BY planned_end_date LIMIT 200`)) {
      out.push({ key: `WORKORDER_LATE:${r.id}`, type: 'WORKORDER_LATE', severity: 'MEDIUM', title: `أمر إنتاج متأخر ${r.work_order_no}`, detail: `النهاية المخططة ${r.planned_end_date}`, href: '/manufacturing' });
    }
  }
  if (enabled('TRANSFER_STALE')) {
    for (const r of await q<{ id: string; transfer_no: string; age: number }>(
      `SELECT id, transfer_no, (current_date - transfer_date)::int AS age FROM inventory_transfers WHERE company_id=$1 AND status='DRAFT' AND transfer_date < current_date - 2 ORDER BY transfer_date LIMIT 100`)) {
      out.push({ key: `TRANSFER_STALE:${r.id}`, type: 'TRANSFER_STALE', severity: 'LOW', title: `مناقلة معلّقة ${r.transfer_no}`, detail: `منذ ${r.age} يوماً`, href: '/inventory/transfers' });
    }
  }
  return out;
}

export interface AlertRow extends ComputedAlert { status: AlertStatus; assigneeUserId: string | null; assigneeName: string | null; snoozedUntil: string | null; note: string | null; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null }

/**
 * مزامنة الحالة مع الواقع: تنبيه جديد يُفتح، المكرَّر لا يُنشأ ثانية (مفتاح فريد)، والمؤجَّل يعود بعد انتهاء التأجيل،
 * وما زال سببه ولّى يُغلق «محلول» تلقائياً، وإن عاد سببه يُعاد فتحه.
 */
export async function syncAlerts(db: Db, companyId: string, s: AlertSettings, today = new Date().toISOString().slice(0, 10)): Promise<void> {
  const computed = await computeAlerts(db, companyId, s);
  const keys = computed.map((a) => a.key);
  for (const a of computed) {
    await db.query(
      `INSERT INTO alert_states (company_id, alert_key, alert_type, severity, title, detail, href, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN')
       ON CONFLICT (company_id, alert_key) DO UPDATE SET
         severity=EXCLUDED.severity, title=EXCLUDED.title, detail=EXCLUDED.detail, href=EXCLUDED.href, last_seen_at=now(),
         status = CASE WHEN alert_states.status='RESOLVED' THEN 'OPEN'
                       WHEN alert_states.status='SNOOZED' AND alert_states.snoozed_until < $8::date THEN 'OPEN'
                       ELSE alert_states.status END,
         resolved_at = CASE WHEN alert_states.status='RESOLVED' THEN NULL ELSE alert_states.resolved_at END,
         first_seen_at = CASE WHEN alert_states.status='RESOLVED' THEN now() ELSE alert_states.first_seen_at END`,
      [companyId, a.key, a.type, a.severity, a.title, a.detail, a.href, today]);
  }
  await db.query(
    `UPDATE alert_states SET status='RESOLVED', resolved_at=now(), updated_at=now()
      WHERE company_id=$1 AND status <> 'RESOLVED' AND NOT (alert_key = ANY($2::text[]))`, [companyId, keys]);
}

export async function listAlerts(db: Db, companyId: string, opts: { status?: AlertStatus | 'ACTIVE'; assignee?: string } = {}): Promise<AlertRow[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT a.*, COALESCE(u.full_name, u.username) AS assignee_name FROM alert_states a LEFT JOIN users u ON u.id=a.assignee_user_id
      WHERE a.company_id=$1 AND ($2::text IS NULL OR ($2='ACTIVE' AND a.status IN ('OPEN','ACKNOWLEDGED','SNOOZED')) OR a.status=$2)
        AND ($3::uuid IS NULL OR a.assignee_user_id=$3)
      ORDER BY CASE a.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, a.first_seen_at DESC LIMIT 500`, [companyId, opts.status ?? null, opts.assignee ?? null])).rows;
  return rows.map((r) => ({
    key: String(r.alert_key), type: String(r.alert_type), severity: r.severity as Severity, title: String(r.title), detail: String(r.detail ?? ''), href: String(r.href ?? ''),
    status: r.status as AlertStatus, assigneeUserId: (r.assignee_user_id as string | null) ?? null, assigneeName: (r.assignee_name as string | null) ?? null,
    snoozedUntil: r.snoozed_until ? String(r.snoozed_until).slice(0, 10) : null, note: (r.note as string | null) ?? null,
    firstSeenAt: String(r.first_seen_at), lastSeenAt: String(r.last_seen_at), resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
  }));
}

export async function actOnAlert(db: Db, companyId: string, userId: string, input: { key: string; action: 'ack' | 'snooze' | 'assign' | 'reopen' | 'note'; until?: string; assigneeUserId?: string | null; note?: string }) {
  const cur = (await db.query<{ status: string }>('SELECT status FROM alert_states WHERE company_id=$1 AND alert_key=$2', [companyId, input.key])).rows[0];
  if (!cur) throw fail('التنبيه غير موجود', 'NOT_FOUND');
  if (cur.status === 'RESOLVED' && input.action !== 'note') throw fail('التنبيه محلول: عولج سببه');
  if (input.action === 'ack') await db.query(`UPDATE alert_states SET status='ACKNOWLEDGED', updated_by_user_id=$3, updated_at=now() WHERE company_id=$1 AND alert_key=$2`, [companyId, input.key, userId]);
  else if (input.action === 'reopen') await db.query(`UPDATE alert_states SET status='OPEN', snoozed_until=NULL, updated_by_user_id=$3, updated_at=now() WHERE company_id=$1 AND alert_key=$2`, [companyId, input.key, userId]);
  else if (input.action === 'snooze') {
    if (!input.until || !/^\d{4}-\d{2}-\d{2}$/.test(input.until) || input.until <= new Date().toISOString().slice(0, 10)) throw fail('حدّد تاريخ تأجيل بعد اليوم');
    await db.query(`UPDATE alert_states SET status='SNOOZED', snoozed_until=$3::date, updated_by_user_id=$4, updated_at=now() WHERE company_id=$1 AND alert_key=$2`, [companyId, input.key, input.until, userId]);
  } else if (input.action === 'assign') {
    if (input.assigneeUserId && !(await db.query('SELECT 1 FROM users WHERE id=$1 AND company_id=$2 AND is_active', [input.assigneeUserId, companyId])).rows.length) throw fail('المسؤول غير صالح');
    await db.query(`UPDATE alert_states SET assignee_user_id=$3, updated_by_user_id=$4, updated_at=now() WHERE company_id=$1 AND alert_key=$2`, [companyId, input.key, input.assigneeUserId ?? null, userId]);
  } else if (input.action === 'note') {
    const t = (input.note ?? '').trim(); if (!t || t.length > 1000) throw fail('نص الملاحظة مطلوب (حتى 1000 حرف)');
    await db.query(`UPDATE alert_states SET note=$3, updated_by_user_id=$4, updated_at=now() WHERE company_id=$1 AND alert_key=$2`, [companyId, input.key, t, userId]);
  }
}

/* ───── القرارات والموافقات المعلّقة: تجمع الآليات الموجودة ولا تنشئ محركاً جديداً (الاعتماد من شاشاتها الأصلية) ───── */
export interface DecisionItem { kind: 'EDIT_REQUEST' | 'WASTE_DRAFT' | 'PRICING' | 'TRANSFER_DRAFT'; id: string; title: string; detail: string; by: string | null; at: string | null; href: string; /** للطلبات: يُعتمد عبر واجهة طلبات الإذن الحالية */ editRequestId?: string }
export async function listPendingDecisions(db: Db, companyId: string): Promise<DecisionItem[]> {
  const out: DecisionItem[] = [];
  const q = async <T extends Record<string, unknown>>(sql: string) => (await db.query<T>(sql, [companyId])).rows;
  for (const r of await q<{ id: string; entity_type: string; entity_id: string; entity_label: string; reason: string; by: string; created_at: string }>(
    `SELECT e.id, e.entity_type, e.entity_id, e.entity_label, e.reason, COALESCE(u.full_name,u.username) AS by, e.created_at::text FROM edit_requests e JOIN users u ON u.id=e.requested_by WHERE e.company_id=$1 AND e.status='PENDING' ORDER BY e.created_at LIMIT 100`)) {
    const href = r.entity_type === 'SALES_INVOICE' ? `/invoices/sales/${r.entity_id}/edit` : r.entity_type === 'PURCHASE_INVOICE' ? `/invoices/purchases/${r.entity_id}/edit` : r.entity_type === 'SUPPLIER' ? `/suppliers?search=${encodeURIComponent(r.entity_label)}` : `/customers?search=${encodeURIComponent(r.entity_label)}`;
    out.push({ kind: 'EDIT_REQUEST', id: r.id, editRequestId: r.id, title: `طلب إذن تعديل — ${r.entity_label}`, detail: r.reason, by: r.by, at: r.created_at, href });
  }
  for (const r of await q<{ id: string; waste_no: string; waste_type: string; at: string }>(`SELECT id, waste_no, waste_type, created_at::text AS at FROM inventory_waste_records WHERE company_id=$1 AND status='DRAFT' ORDER BY created_at LIMIT 100`)) {
    out.push({ kind: 'WASTE_DRAFT', id: r.id, title: `إهلاك مادي بانتظار الاعتماد ${r.waste_no}`, detail: r.waste_type, by: null, at: r.at, href: `/inventory/depreciation?search=${encodeURIComponent(r.waste_no)}` });
  }
  const pq = await listPricingQueue(db, companyId);
  for (const it of pq.items) out.push({ kind: 'PRICING', id: it.id, title: `بانتظار التسعير — ${it.invoiceNo}`, detail: it.partyName, by: null, at: null, href: it.kind === 'SALES' ? `/invoices/sales/${it.id}/edit` : it.kind === 'EXTERNAL' ? `/purchases/external-jobs/${it.id}?tab=pricing` : `/invoices/purchases/${it.id}/edit` });
  for (const r of await q<{ id: string; transfer_no: string; at: string }>(`SELECT id, transfer_no, created_at::text AS at FROM inventory_transfers WHERE company_id=$1 AND status='DRAFT' ORDER BY created_at LIMIT 100`)) {
    out.push({ kind: 'TRANSFER_DRAFT', id: r.id, title: `مناقلة بانتظار التأكيد ${r.transfer_no}`, detail: '', by: null, at: r.at, href: '/inventory/transfers' });
  }
  return out;
}

/* ───── توقعات السيولة 7/30/60/90: المؤكد منفصل عن التوقع، ولكل عملة على حدة ───── */
export interface LiquidityHorizon { days: number; byCurrency: Array<{ currency: string; confirmedCash: number; confirmedChequesDue: number; confirmedTotal: number; forecastCollections: number; forecastPayments: number; forecastTotal: number }> }
export interface LiquidityForecast { horizons: LiquidityHorizon[]; undatedPayables: Array<{ currency: string; total: number }>; notes: string[] }
export async function liquidityForecast(db: Db, companyId: string): Promise<LiquidityForecast> {
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, [companyId, ...params])).rows;
  const cash = await q<{ currency: string; total: string }>(`SELECT currency_code AS currency, COALESCE(sum(current_balance),0)::text AS total FROM cashboxes WHERE company_id=$1 AND is_active AND account_kind <> 'CHECKS' GROUP BY 1`);
  const undated = await q<{ currency: string; total: string }>(`SELECT currency_code AS currency, COALESCE(sum(remaining_amount),0)::text AS total FROM purchase_invoices WHERE company_id=$1 AND document_status='CONFIRMED' AND remaining_amount > 0 GROUP BY 1 ORDER BY 1`);
  const horizons: LiquidityHorizon[] = [];
  for (const days of [7, 30, 60, 90]) {
    const cheques = await q<{ currency: string; total: string }>(
      `SELECT currency_code AS currency, COALESCE(sum(amount),0)::text AS total FROM checks WHERE company_id=$1 AND status IN ('RECEIVED','DEPOSITED') AND party_type='CUSTOMER' AND due_date <= current_date + $2::int GROUP BY 1`, [days]);
    const prom = await q<{ kind: string; currency: string; total: string }>(
      `SELECT party_type AS kind, promised_currency AS currency, COALESCE(sum(promised_amount),0)::text AS total FROM party_collection_profiles
        WHERE company_id=$1 AND promised_amount IS NOT NULL AND expected_collection_date IS NOT NULL AND expected_collection_date BETWEEN current_date AND current_date + $2::int GROUP BY 1, 2`, [days]);
    const set = new Set([...cash.map((r) => r.currency), ...cheques.map((r) => r.currency), ...prom.map((r) => r.currency)]);
    horizons.push({ days, byCurrency: [...set].sort().map((currency) => {
      const confirmedCash = Number(cash.find((r) => r.currency === currency)?.total ?? 0);
      const confirmedChequesDue = Number(cheques.find((r) => r.currency === currency)?.total ?? 0);
      const forecastCollections = Number(prom.find((r) => r.kind === 'CUSTOMER' && r.currency === currency)?.total ?? 0);
      const forecastPayments = Number(prom.find((r) => r.kind === 'SUPPLIER' && r.currency === currency)?.total ?? 0);
      return { currency, confirmedCash, confirmedChequesDue, confirmedTotal: confirmedCash + confirmedChequesDue, forecastCollections, forecastPayments, forecastTotal: confirmedCash + confirmedChequesDue + forecastCollections - forecastPayments };
    }) });
  }
  return {
    horizons,
    undatedPayables: undated.map((r) => ({ currency: r.currency, total: Number(r.total) })),
    notes: [
      'المؤكد = الأرصدة النقدية الحالية + الشيكات المستلمة التي يحلّ استحقاقها ضمن الأفق (أدوات قائمة فعلاً).',
      'التوقع = مبالغ موعودة بالتحصيل/السداد بتواريخ حددتها المتابعة؛ وهو تقدير لا التزام.',
      'التزامات الموردين (متبقي فواتير الشراء) لا تُوزَّع على الآفاق لأنه لا توجد تواريخ استحقاق مخزَّنة؛ تُعرض إجمالاً منفصلاً.',
      'لا تُجمع عملات مختلفة ولا يُحوَّل بينها.',
    ],
  };
}

/* ───── ملخص دوري للفرع (يومي/أسبوعي/شهري) ───── */
export async function branchSummary(db: Db, companyId: string, kind: 'daily' | 'weekly' | 'monthly') {
  const pk = kind === 'daily' ? 'today' : kind === 'weekly' ? 'week' : 'month';
  const period = resolvePeriod(pk);
  const settings = await getAlertSettings(db, companyId);
  const metrics = await getBranchMetrics(db, companyId, period, thresholdsOf(settings));
  const alerts = (await db.query<{ opened: string; resolved: string; active: string; high: string }>(
    `SELECT count(*) FILTER (WHERE first_seen_at::date BETWEEN $2::date AND $3::date)::text AS opened, count(*) FILTER (WHERE resolved_at::date BETWEEN $2::date AND $3::date)::text AS resolved,
            count(*) FILTER (WHERE status <> 'RESOLVED')::text AS active, count(*) FILTER (WHERE status <> 'RESOLVED' AND severity='HIGH')::text AS high
       FROM alert_states WHERE company_id=$1`, [companyId, period.from, period.to])).rows[0];
  const decisions = await listPendingDecisions(db, companyId);
  const money = (rows: Array<{ currency: string; total: number }>) => rows.length ? rows.map((r) => `${r.total.toLocaleString('en-US')} ${r.currency}`).join(' | ') : '—';
  const text = [
    `ملخص ${kind === 'daily' ? 'يومي' : kind === 'weekly' ? 'أسبوعي' : 'شهري'} — ${period.from}${period.from !== period.to ? ` → ${period.to}` : ''}`,
    `المبيعات: ${money(metrics.sales.current)} (السابق: ${money(metrics.sales.previous)})`,
    `المشتريات: ${money(metrics.purchases.current)}`,
    `أرصدة الصناديق: ${money(metrics.cash)}`,
    `شيكات قيد التحصيل: ${metrics.cheques.pending} (متأخر ${metrics.cheques.overdue})`,
    `طلبيات متأخرة: ${metrics.orders.late} · مصنعية خارجية متأخرة: ${metrics.external.late} · أوامر إنتاج متأخرة: ${metrics.production.late}`,
    `تنبيهات: جديدة ${alerts.opened} · معالَجة ${alerts.resolved} · نشطة ${alerts.active} (عالية ${alerts.high})`,
    `قرارات معلّقة: ${decisions.length}`,
  ].join('\n');
  return { period, metrics, alerts: { opened: Number(alerts.opened), resolved: Number(alerts.resolved), active: Number(alerts.active), high: Number(alerts.high) }, pendingDecisions: decisions.length, text };
}

export { DEFAULT_THRESHOLDS };
