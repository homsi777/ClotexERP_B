import type { Pool, PoolClient } from 'pg';
import { VOUCHER_CHECK_AMOUNT } from './partyStatementService.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export type PartyKind = 'CUSTOMER' | 'SUPPLIER';

/**
 * أرصدة العملاء/الموردين الحقيقية: نفس مصادر كشف الحساب وقواعده حرفياً (الشيك المعلّق لا يُخصم قبل التحصيل،
 * المرتجع والحسم والقيود اليدوية…)، لكن مجمَّعة لكل طرف ولكل عملة على حدة دون أي تحويل.
 * اختبار مطابقة يقارن كل رصيد هنا بكشف الحساب نفسه.
 */
const CUSTOMER_LEDGER = `
  SELECT si.customer_id AS party_id, si.invoice_date AS row_date, 'INVOICE' AS kind, si.currency_code, si.total_amount AS debit, 0::numeric AS credit
    FROM sales_invoices si WHERE si.company_id=$1 AND si.document_status='CONFIRMED'
  UNION ALL
  SELECT v.party_id, v.voucher_date, 'RECEIPT', v.currency_code, 0::numeric, GREATEST(v.amount - ${VOUCHER_CHECK_AMOUNT}, 0)
    FROM vouchers v WHERE v.company_id=$1 AND v.party_type='CUSTOMER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED'
  UNION ALL
  SELECT v.party_id,
         COALESCE((SELECT max(h.changed_at)::date FROM check_status_history h WHERE h.check_id = c.id AND h.to_status = 'CLEARED'), c.updated_at::date),
         'CHECK_COLLECTION', v.currency_code, 0::numeric, vl.amount
    FROM voucher_lines vl
    JOIN vouchers v ON v.id = vl.voucher_id AND v.company_id = vl.company_id
    JOIN checks c ON c.id = vl.check_id AND c.company_id = vl.company_id
   WHERE v.company_id=$1 AND v.party_type='CUSTOMER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED' AND c.status='CLEARED'
  UNION ALL
  SELECT v.party_id, v.voucher_date, 'PAYMENT', v.currency_code, v.amount, 0::numeric
    FROM vouchers v WHERE v.company_id=$1 AND v.party_type='CUSTOMER' AND v.voucher_type='PAYMENT' AND v.status='CONFIRMED'
  UNION ALL
  SELECT r.customer_id, r.return_date, 'RETURN', r.currency_code, 0::numeric, r.total_amount
    FROM return_invoices r WHERE r.company_id=$1 AND r.return_type='SALES_RETURN' AND r.status='CONFIRMED' AND COALESCE(r.settlement_type,'CREDIT_BALANCE') <> 'NO_FINANCIAL_EFFECT'
  UNION ALL
  SELECT cd.customer_id, cd.discount_date, 'DISCOUNT', cd.currency_code, 0::numeric, cd.amount
    FROM customer_discounts cd WHERE cd.company_id=$1 AND cd.status='CONFIRMED'
  UNION ALL
  SELECT jl.party_id, je.entry_date, 'JOURNAL', jl.currency_code, jl.debit, jl.credit
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
   WHERE jl.company_id=$1 AND jl.party_type='CUSTOMER' AND je.status='POSTED' AND je.source_type IN ('MANUAL','OPENING','SYSTEM')`;

const SUPPLIER_LEDGER = `
  SELECT pi.supplier_id AS party_id, pi.invoice_date AS row_date, 'INVOICE' AS kind, pi.currency_code, 0::numeric AS debit, pi.total_amount AS credit
    FROM purchase_invoices pi WHERE pi.company_id=$1 AND pi.document_status='CONFIRMED'
  UNION ALL
  SELECT v.party_id, v.voucher_date, 'PAYMENT', v.currency_code, v.amount, 0::numeric
    FROM vouchers v WHERE v.company_id=$1 AND v.party_type='SUPPLIER' AND v.voucher_type='PAYMENT' AND v.status='CONFIRMED'
  UNION ALL
  SELECT v.party_id, v.voucher_date, 'RECEIPT', v.currency_code, 0::numeric, v.amount
    FROM vouchers v WHERE v.company_id=$1 AND v.party_type='SUPPLIER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED'
  UNION ALL
  SELECT r.supplier_id, r.return_date, 'RETURN', r.currency_code, r.total_amount, 0::numeric
    FROM return_invoices r WHERE r.company_id=$1 AND r.return_type='PURCHASE_RETURN' AND r.status='CONFIRMED' AND COALESCE(r.settlement_type,'CREDIT_BALANCE') <> 'NO_FINANCIAL_EFFECT'`;

export interface AgingBuckets { d0_30: number; d31_60: number; d61_90: number; d90plus: number; unallocated: number }
export interface CurrencyBalance {
  currency: string;
  /** موجب = على الطرف (مدين للعميل / دائن للمورد)، سالب = له. */
  balance: number;
  side: 'OWES_US' | 'WE_OWE' | 'ZERO';
  pendingCheques: number;
  expectedBalance: number;
  /** تقادم الفواتير المفتوحة حسب تاريخ الفاتورة (لا تواريخ استحقاق مخزَّنة) + «غير مخصص» = ما لا تفسّره فواتير مفتوحة. */
  aging: AgingBuckets;
  openInvoices: number;
  sales12m: number;
  lastOperationDate: string | null;
  lastPaymentDate: string | null;
  creditLimit: number | null;
  limitExceeded: boolean;
}
export interface PartyBalanceRow {
  id: string; code: string | null; name: string; phone: string | null; isActive: boolean;
  telegramEnabled: boolean; telegramChatId: string | null;
  currencies: CurrencyBalance[];
  profile: { ownerUserId: string | null; ownerName: string | null; expectedCollectionDate: string | null; promisedAmount: number | null; promisedCurrency: string | null; creditLimit: number | null; creditLimitCurrency: string | null } | null;
  alerts: { promiseOverdue: boolean; limitExceeded: boolean };
  lastOperationDate: string | null;
  lastPaymentDate: string | null;
}
export interface PartyBalancesResult {
  agingBasis: 'INVOICE_DATE';
  dueDatesAvailable: false;
  note: string;
  rows: PartyBalanceRow[];
  /** إجمالي الأرصدة لكل عملة منفصلاً: ما هو على الأطراف وما هو لهم، دون تحويل بين العملات. */
  totals: Array<{ currency: string; owedToUs: number; weOwe: number; pendingCheques: number; parties: number }>;
}

const num = (v: unknown) => Number(v ?? 0);
const EPS = 0.005;
const ymd = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export async function getPartyBalances(
  db: Db,
  companyId: string,
  kind: PartyKind,
  opts: { search?: string; currency?: string; onlyWithBalance?: boolean; onlyAlerts?: boolean; sort?: 'name' | 'balance' | 'lastPayment' | 'lastOperation'; dir?: 'asc' | 'desc' } = {},
): Promise<PartyBalancesResult> {
  const sign = kind === 'CUSTOMER' ? 1 : -1; // رصيد العميل = مدين − دائن، والمورد = دائن − مدين
  const ledger = kind === 'CUSTOMER' ? CUSTOMER_LEDGER : SUPPLIER_LEDGER;
  const paymentKinds = kind === 'CUSTOMER' ? `('RECEIPT','CHECK_COLLECTION')` : `('PAYMENT')`;
  const table = kind === 'CUSTOMER' ? 'customers' : 'suppliers';
  const partyType = kind;

  const ledgerRows = (await db.query<{ party_id: string; currency_code: string; d: string; c: string; last_op: string | null; last_pay: string | null }>(
    `SELECT party_id, currency_code, COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c,
            MAX(row_date)::text AS last_op, MAX(row_date) FILTER (WHERE kind IN ${paymentKinds})::text AS last_pay
       FROM (${ledger}) l WHERE party_id IS NOT NULL GROUP BY party_id, currency_code`, [companyId])).rows;

  const pending = kind === 'CUSTOMER'
    ? (await db.query<{ party_id: string; currency_code: string; amount: string }>(
        `SELECT v.party_id, v.currency_code, SUM(vl.amount) AS amount
           FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id AND v.company_id = vl.company_id
           JOIN checks c ON c.id = vl.check_id AND c.company_id = vl.company_id
          WHERE v.company_id=$1 AND v.party_type='CUSTOMER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED' AND c.status IN ('RECEIVED','DEPOSITED')
          GROUP BY v.party_id, v.currency_code`, [companyId])).rows
    : [];

  const invTable = kind === 'CUSTOMER' ? 'sales_invoices' : 'purchase_invoices';
  const partyCol = kind === 'CUSTOMER' ? 'customer_id' : 'supplier_id';
  const open = (await db.query<{ party_id: string; currency_code: string; b1: string; b2: string; b3: string; b4: string; n: string }>(
    `SELECT ${partyCol} AS party_id, currency_code,
            COALESCE(SUM(remaining_amount) FILTER (WHERE current_date - invoice_date <= 30),0) AS b1,
            COALESCE(SUM(remaining_amount) FILTER (WHERE current_date - invoice_date BETWEEN 31 AND 60),0) AS b2,
            COALESCE(SUM(remaining_amount) FILTER (WHERE current_date - invoice_date BETWEEN 61 AND 90),0) AS b3,
            COALESCE(SUM(remaining_amount) FILTER (WHERE current_date - invoice_date > 90),0) AS b4,
            count(*)::text AS n
       FROM ${invTable} WHERE company_id=$1 AND document_status='CONFIRMED' AND remaining_amount > ${EPS}
      GROUP BY ${partyCol}, currency_code`, [companyId])).rows;

  const s12 = (await db.query<{ party_id: string; currency_code: string; total: string }>(
    `SELECT ${partyCol} AS party_id, currency_code, SUM(total_amount) AS total FROM ${invTable}
      WHERE company_id=$1 AND document_status='CONFIRMED' AND invoice_date >= current_date - 365 GROUP BY ${partyCol}, currency_code`, [companyId])).rows;

  const profiles = (await db.query<{ party_id: string; owner_user_id: string | null; owner_name: string | null; credit_limit: string | null; credit_limit_currency: string | null; expected_collection_date: string | null; promised_amount: string | null; promised_currency: string | null }>(
    `SELECT p.party_id, p.owner_user_id, COALESCE(u.full_name, u.username) AS owner_name, p.credit_limit, p.credit_limit_currency, p.expected_collection_date::text, p.promised_amount, p.promised_currency
       FROM party_collection_profiles p LEFT JOIN users u ON u.id = p.owner_user_id WHERE p.company_id=$1 AND p.party_type=$2`, [companyId, partyType])).rows;

  const parties = (await db.query<{ id: string; code: string | null; name: string; phone: string | null; is_active: boolean; telegram_enabled: boolean | null; telegram_chat_id: string | null }>(
    `SELECT id, code, name, phone, is_active, telegram_enabled, telegram_chat_id FROM ${table} WHERE company_id=$1`, [companyId])).rows;

  const key = (p: string, c: string) => `${p}|${c}`;
  const pendM = new Map(pending.map((r) => [key(r.party_id, r.currency_code), num(r.amount)]));
  const openM = new Map(open.map((r) => [key(r.party_id, r.currency_code), r]));
  const s12M = new Map(s12.map((r) => [key(r.party_id, r.currency_code), num(r.total)]));
  const profM = new Map(profiles.map((r) => [r.party_id, r]));
  const ledgerBy = new Map<string, typeof ledgerRows>();
  for (const r of ledgerRows) ledgerBy.set(r.party_id, [...(ledgerBy.get(r.party_id) ?? []), r]);
  const today = new Date().toISOString().slice(0, 10);

  let rows: PartyBalanceRow[] = parties.map((p) => {
    const prof = profM.get(p.id) ?? null;
    const lrows = ledgerBy.get(p.id) ?? [];
    // العملات: كل عملة لها حركة، مع عملات الفواتير المفتوحة.
    const currencies = [...new Set([...lrows.map((r) => r.currency_code), ...open.filter((o) => o.party_id === p.id).map((o) => o.currency_code)])].sort();
    const cur: CurrencyBalance[] = currencies.map((ccy) => {
      const l = lrows.find((r) => r.currency_code === ccy);
      const balance = sign * (num(l?.d) - num(l?.c));
      const pend = pendM.get(key(p.id, ccy)) ?? 0;
      const o = openM.get(key(p.id, ccy));
      const openTotal = o ? num(o.b1) + num(o.b2) + num(o.b3) + num(o.b4) : 0;
      const limit = prof?.credit_limit != null && prof.credit_limit_currency === ccy ? num(prof.credit_limit) : null;
      return {
        currency: ccy, balance,
        side: balance > EPS ? (kind === 'CUSTOMER' ? 'OWES_US' : 'WE_OWE') : balance < -EPS ? (kind === 'CUSTOMER' ? 'WE_OWE' : 'OWES_US') : 'ZERO',
        pendingCheques: pend,
        // الرصيد المتوقع بعد تحصيل الشيكات المعلّقة (للعميل فقط).
        expectedBalance: kind === 'CUSTOMER' ? balance - pend : balance,
        aging: { d0_30: num(o?.b1), d31_60: num(o?.b2), d61_90: num(o?.b3), d90plus: num(o?.b4), unallocated: balance - openTotal },
        openInvoices: num(o?.n),
        sales12m: s12M.get(key(p.id, ccy)) ?? 0,
        lastOperationDate: ymd(l?.last_op),
        lastPaymentDate: ymd(l?.last_pay),
        creditLimit: limit,
        limitExceeded: kind === 'CUSTOMER' && limit != null && balance > limit + EPS,
      };
    });
    const promiseOverdue = Boolean(prof?.expected_collection_date && prof.expected_collection_date < today && cur.some((c) => c.balance > EPS));
    return {
      id: p.id, code: p.code, name: p.name, phone: p.phone, isActive: p.is_active,
      telegramEnabled: Boolean(p.telegram_enabled), telegramChatId: p.telegram_chat_id,
      currencies: cur,
      profile: prof ? {
        ownerUserId: prof.owner_user_id, ownerName: prof.owner_name, expectedCollectionDate: ymd(prof.expected_collection_date),
        promisedAmount: prof.promised_amount != null ? num(prof.promised_amount) : null, promisedCurrency: prof.promised_currency,
        creditLimit: prof.credit_limit != null ? num(prof.credit_limit) : null, creditLimitCurrency: prof.credit_limit_currency,
      } : null,
      alerts: { promiseOverdue, limitExceeded: cur.some((c) => c.limitExceeded) },
      lastOperationDate: cur.map((c) => c.lastOperationDate).filter(Boolean).sort().pop() ?? null,
      lastPaymentDate: cur.map((c) => c.lastPaymentDate).filter(Boolean).sort().pop() ?? null,
    };
  });

  // التصفية
  const q = opts.search?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.code ?? '').toLowerCase().includes(q) || (r.phone ?? '').includes(q));
  if (opts.currency) rows = rows.filter((r) => r.currencies.some((c) => c.currency === opts.currency));
  if (opts.onlyWithBalance) rows = rows.filter((r) => r.currencies.some((c) => (!opts.currency || c.currency === opts.currency) && Math.abs(c.balance) > EPS));
  if (opts.onlyAlerts) rows = rows.filter((r) => r.alerts.promiseOverdue || r.alerts.limitExceeded);

  // الفرز (حسب العملة المحددة، أو أكبر رصيد مطلق عند غياب العملة — للترتيب فقط لا للجمع)
  const bal = (r: PartyBalanceRow) => Math.max(0, ...r.currencies.filter((c) => !opts.currency || c.currency === opts.currency).map((c) => Math.abs(c.balance)));
  const dir = opts.dir === 'asc' ? 1 : -1;
  const sort = opts.sort ?? 'balance';
  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ar') * (opts.dir === 'desc' ? -1 : 1);
    if (sort === 'lastPayment') return String(a.lastPaymentDate ?? '').localeCompare(String(b.lastPaymentDate ?? '')) * dir;
    if (sort === 'lastOperation') return String(a.lastOperationDate ?? '').localeCompare(String(b.lastOperationDate ?? '')) * dir;
    return (bal(a) - bal(b)) * dir;
  });

  // إجمالي المدين والدائن منفصلين لكل عملة (على الصفوف المعروضة)
  const tot = new Map<string, { currency: string; owedToUs: number; weOwe: number; pendingCheques: number; parties: number }>();
  for (const r of rows) for (const c of r.currencies) {
    if (opts.currency && c.currency !== opts.currency) continue;
    const t = tot.get(c.currency) ?? { currency: c.currency, owedToUs: 0, weOwe: 0, pendingCheques: 0, parties: 0 };
    if (c.side === 'OWES_US') t.owedToUs += Math.abs(c.balance);
    else if (c.side === 'WE_OWE') t.weOwe += Math.abs(c.balance);
    t.pendingCheques += c.pendingCheques;
    if (Math.abs(c.balance) > EPS) t.parties += 1;
    tot.set(c.currency, t);
  }
  return {
    agingBasis: 'INVOICE_DATE',
    dueDatesAvailable: false,
    note: 'لا توجد تواريخ استحقاق مخزَّنة بالفواتير، فالتقادم محسوب من تاريخ الفاتورة على المتبقي الفعلي لكل فاتورة (بعد الدفعات المرتبطة بها). «غير مخصص» = ما لا تفسّره فواتير مفتوحة (دفعات/خصومات غير مرتبطة بفاتورة، أو رصيد افتتاحي).',
    rows,
    totals: [...tot.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/* ───── ملف المتابعة وملاحظاته ───── */
export interface ProfileInput {
  ownerUserId?: string | null; creditLimit?: number | null; creditLimitCurrency?: string | null;
  expectedCollectionDate?: string | null; promisedAmount?: number | null; promisedCurrency?: string | null;
}
const fail = (m: string, code = 'VALIDATION') => Object.assign(new Error(m), { code });

export async function savePartyProfile(db: Db, companyId: string, userId: string, kind: PartyKind, partyId: string, p: ProfileInput) {
  const table = kind === 'CUSTOMER' ? 'customers' : 'suppliers';
  if (!(await db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND company_id=$2`, [partyId, companyId])).rows.length) throw fail('الطرف غير موجود', 'NOT_FOUND');
  if (p.ownerUserId && !(await db.query('SELECT 1 FROM users WHERE id=$1 AND company_id=$2 AND is_active', [p.ownerUserId, companyId])).rows.length) throw fail('مسؤول المتابعة غير صالح');
  const limit = p.creditLimit ?? null, promised = p.promisedAmount ?? null;
  if (limit != null && (!(limit >= 0) || !p.creditLimitCurrency)) throw fail('حد الائتمان يحتاج مبلغاً صالحاً وعملته');
  if (promised != null && (!(promised >= 0) || !p.promisedCurrency)) throw fail('المبلغ الموعود يحتاج قيمة صالحة وعملته');
  if (p.expectedCollectionDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.expectedCollectionDate)) throw fail('تاريخ التحصيل غير صالح');
  await db.query(
    `INSERT INTO party_collection_profiles (company_id, party_type, party_id, owner_user_id, credit_limit, credit_limit_currency, expected_collection_date, promised_amount, promised_currency, updated_by_user_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,now())
     ON CONFLICT (company_id, party_type, party_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id, credit_limit=EXCLUDED.credit_limit, credit_limit_currency=EXCLUDED.credit_limit_currency,
       expected_collection_date=EXCLUDED.expected_collection_date, promised_amount=EXCLUDED.promised_amount, promised_currency=EXCLUDED.promised_currency, updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()`,
    [companyId, kind, partyId, p.ownerUserId ?? null, limit, limit != null ? p.creditLimitCurrency!.toUpperCase() : null, p.expectedCollectionDate ?? null, promised, promised != null ? p.promisedCurrency!.toUpperCase() : null, userId]);
}

export async function addPartyNote(db: Db, companyId: string, userId: string, kind: PartyKind, partyId: string, note: string) {
  const text = note.trim();
  if (!text || text.length > 2000) throw fail('نص الملاحظة مطلوب (حتى 2000 حرف)');
  const table = kind === 'CUSTOMER' ? 'customers' : 'suppliers';
  if (!(await db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND company_id=$2`, [partyId, companyId])).rows.length) throw fail('الطرف غير موجود', 'NOT_FOUND');
  await db.query('INSERT INTO party_collection_notes (company_id, party_type, party_id, note, created_by_user_id) VALUES ($1,$2,$3,$4,$5)', [companyId, kind, partyId, text, userId]);
}

export async function listPartyNotes(db: Db, companyId: string, kind: PartyKind, partyId: string) {
  return (await db.query(
    `SELECT n.id, n.note, n.created_at::text AS created_at, COALESCE(u.full_name, u.username) AS author
       FROM party_collection_notes n LEFT JOIN users u ON u.id = n.created_by_user_id
      WHERE n.company_id=$1 AND n.party_type=$2 AND n.party_id=$3 ORDER BY n.created_at DESC LIMIT 100`, [companyId, kind, partyId])).rows;
}
