import { getPool as realGetPool } from '../db/pool.js';

/** للاختبارات فقط: يستبدل مصدر الاتصال (عميل معاملة تُلغى بعد الاختبار). */
let dbOverride: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> } | null = null;
export function __setStatementDbForTests(db: typeof dbOverride) { dbOverride = db; }
const getPool = () => (dbOverride ?? realGetPool()) as ReturnType<typeof realGetPool>;

/** ملحق وصف كشف الحساب لسند فيه شيك: «— شيك رقم X / بنك Y» ليظهر استلام الشيك بوضوح. */
const VOUCHER_CHECK_SUFFIX = `COALESCE((SELECT ' — شيك رقم ' || string_agg(c.check_no || ' / ' || c.bank_name || ' / استحقاق ' || to_char(c.due_date,'YYYY-MM-DD') || COALESCE(' / ' || NULLIF(c.account_holder_name,''), ''), '، ') FROM voucher_lines vl JOIN checks c ON c.id = vl.check_id WHERE vl.voucher_id = v.id AND vl.company_id = v.company_id), '')`;


/** مجموع بنود الشيكات في سند القبض (تُستثنى من صف السند وتُحتسب عند التحصيل). */
const VOUCHER_CHECK_AMOUNT = `COALESCE((SELECT SUM(vl.amount) FROM voucher_lines vl WHERE vl.voucher_id = v.id AND vl.company_id = v.company_id AND vl.check_id IS NOT NULL), 0)`;

/** سند محوَّل بسعر صرف (اختياري): يظهر المكافئ والسعر بجانب المبلغ الأصلي. */
const VOUCHER_CONVERT_SUFFIX = `CASE WHEN v.converted_amount IS NOT NULL THEN ' — ما يعادل ' || trim(to_char(v.converted_amount,'FM999999999990.00')) || ' ' || v.convert_to_currency_code || ' بسعر ' || trim(to_char(v.convert_rate,'FM999999990.999999')) ELSE '' END`;

type PartyKind = 'CUSTOMER' | 'SUPPLIER';

export type PartyStatementFilters = {
  fromDate?: string;
  toDate?: string;
  currency?: string;
};

type StatementSourceRow = {
  row_date: string;
  created_at: string;
  type: string;
  type_label: string;
  document_no: string;
  description: string;
  debit: string;
  credit: string;
  debit_usd: string;
  credit_usd: string;
  currency_code: string;
  source_type: string;
  source_id: string;
  status: string;
  notes: string | null;
};

export type PendingCheckRow = {
  checkId: string; checkNo: string; bankName: string; dueDate: string; status: string;
  voucherNo: string; currency: string; amount: number; amountUsd: number;
};

function toIsoDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

/**
 * سياسة العملات (بشير، البند 2) — يختار أي زوج أعمدة (الأصلي أم المُحوَّل
 * للدولار) يُستخدَم لحساب الرصيد لصف كشف حساب واحد. دالة صِرفة مُستخرَجة
 * لتكون قابلة للاختبار دون قاعدة بيانات حقيقية — نفس القاعدة المُطبَّقة
 * بـbuildStatement حرفياً، لا منطق جديد، فقط استخراج.
 */
export function pickStatementRowAmounts(
  row: Pick<StatementSourceRow, 'debit' | 'credit' | 'debit_usd' | 'credit_usd'>,
  useOriginalCurrency: boolean,
): { debit: number; credit: number } {
  return useOriginalCurrency
    ? { debit: Number(row.debit), credit: Number(row.credit) }
    : { debit: Number(row.debit_usd), credit: Number(row.credit_usd) };
}

async function loadCustomer(companyId: string, customerId: string) {
  const row = await getPool().query(
    `SELECT id, code, name, phone, email, address, notes, telegram_chat_id, telegram_enabled, telegram_label
     FROM customers WHERE id=$1 AND company_id=$2`,
    [customerId, companyId],
  );
  return row.rows[0] ?? null;
}

async function loadSupplier(companyId: string, supplierId: string) {
  const row = await getPool().query(
    `SELECT id, code, name, phone, email, address, country, notes, telegram_chat_id, telegram_enabled, telegram_label
     FROM suppliers WHERE id=$1 AND company_id=$2`,
    [supplierId, companyId],
  );
  return row.rows[0] ?? null;
}

function customerRowsQuery(period: 'opening' | 'period', filters: PartyStatementFilters) {
  const params: unknown[] = [];
  const p = { value: 1 };
  // سياسة العملات (بشير، البند 2): currencyAlias اختيارية — فرع قيود اليومية
  // (journal_lines jl / journal_entries je أدناه) له أليّاسان مختلفان لعمود
  // التاريخ (je.entry_date) وعمود currency_code (jl.currency_code)، بعكس كل
  // الفروع الأخرى حيث نفس الجدول يحمل العمودين معاً. هذه الثغرة لم تظهر
  // سابقاً لأن filters.currency لم يكن يُمرَّر فعلياً من أي مسار قبل هذه
  // الميزة — مُثبَّتة بتجربة فعلية (قراءة فقط) على بيانات الإنتاج قبل الاعتماد.
  const dateCondition = (alias: string, col: string, currencyAlias: string = alias) => {
    const conditions: string[] = [];
    if (period === 'opening' && filters.fromDate) {
      conditions.push(`${alias}.${col} < $${p.value}::date`);
      params.push(filters.fromDate);
      p.value++;
    } else if (period === 'period') {
      if (filters.fromDate) {
        conditions.push(`${alias}.${col} >= $${p.value}::date`);
        params.push(filters.fromDate);
        p.value++;
      }
      if (filters.toDate) {
        conditions.push(`${alias}.${col} <= $${p.value}::date`);
        params.push(filters.toDate);
        p.value++;
      }
    }
    if (filters.currency) {
      conditions.push(`${currencyAlias}.currency_code = $${p.value}`);
      params.push(filters.currency);
      p.value++;
    }
    return conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
  };

  const sql = `
    SELECT si.invoice_date AS row_date, si.created_at, 'SALES_INVOICE' AS type, 'فاتورة بيع' AS type_label,
           si.invoice_no AS document_no, 'فاتورة بيع مؤكدة' AS description,
           si.total_amount AS debit, 0::numeric AS credit, si.currency_code,
           COALESCE(si.total_amount_usd, CASE WHEN si.currency_code='USD' THEN si.total_amount ELSE si.total_amount / NULLIF(si.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'SALES_INVOICE' AS source_type, si.id AS source_id, si.document_status AS status, si.notes
    FROM sales_invoices si
    WHERE si.company_id=$${p.value++} AND si.customer_id=$${p.value++} AND si.document_status='CONFIRMED'
    ${dateCondition('si', 'invoice_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'RECEIPT_VOUCHER' AS type,
           ('سند قبض — ' || CASE COALESCE(v.purpose, 'INVOICE_PAYMENT')
              WHEN 'ADVANCE' THEN 'عربون'
              WHEN 'ADVANCE_REFUND' THEN 'رد عربون'
              WHEN 'COMPENSATION' THEN 'تعويض / عطل وضرر'
              WHEN 'OTHER' THEN 'أخرى'
              ELSE 'دفعة / تسوية فاتورة'
            END) || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند قبض مؤكد') || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS description,
           0::numeric AS debit, GREATEST(v.amount - ${VOUCHER_CHECK_AMOUNT}, 0) AS credit, v.currency_code,
           0::numeric AS debit_usd,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END)
             * GREATEST(v.amount - ${VOUCHER_CHECK_AMOUNT}, 0) / NULLIF(v.amount, 0) AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='CUSTOMER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    -- شيك مقبوض: لا يُخصم من ذمة العميل إلا عند تأكيد تحصيله (CLEARED)، بتاريخ التحصيل.
    SELECT x.row_date, x.created_at, 'CHECK_COLLECTION' AS type, 'تحصيل شيك' AS type_label,
           x.check_no AS document_no,
           ('تحصيل شيك رقم ' || x.check_no || ' / ' || x.bank_name || ' (سند ' || x.voucher_no || ')') AS description,
           0::numeric AS debit, x.line_amount AS credit, x.currency_code,
           0::numeric AS debit_usd,
           COALESCE(x.line_amount_usd, CASE WHEN x.currency_code='USD' THEN x.line_amount ELSE x.line_amount / NULLIF(x.exchange_rate_to_usd, 0) END) AS credit_usd,
           'VOUCHER' AS source_type, x.voucher_id AS source_id, 'CONFIRMED' AS status, NULL::text AS notes
    FROM (
      SELECT COALESCE((SELECT max(h.changed_at)::date FROM check_status_history h WHERE h.check_id = c.id AND h.to_status = 'CLEARED'), c.updated_at::date) AS row_date,
             c.updated_at AS created_at, c.check_no, c.bank_name, v.voucher_no, v.id AS voucher_id,
             vl.amount AS line_amount, vl.amount_usd AS line_amount_usd, v.currency_code, v.exchange_rate_to_usd
      FROM voucher_lines vl
      JOIN vouchers v ON v.id = vl.voucher_id AND v.company_id = vl.company_id
      JOIN checks c ON c.id = vl.check_id AND c.company_id = vl.company_id
      WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='CUSTOMER' AND v.voucher_type='RECEIPT'
        AND v.status='CONFIRMED' AND c.status='CLEARED'
    ) x
    WHERE true
    ${dateCondition('x', 'row_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'PAYMENT_VOUCHER' AS type,
           ('سند دفع للعميل — ' || CASE COALESCE(v.purpose, 'INVOICE_PAYMENT')
              WHEN 'ADVANCE' THEN 'عربون'
              WHEN 'ADVANCE_REFUND' THEN 'رد عربون'
              WHEN 'COMPENSATION' THEN 'تعويض / عطل وضرر'
              WHEN 'OTHER' THEN 'أخرى'
              ELSE 'دفعة / تسوية فاتورة'
            END) || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند دفع مؤكد') || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS description,
           v.amount AS debit, 0::numeric AS credit, v.currency_code,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='CUSTOMER' AND v.voucher_type='PAYMENT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    SELECT r.return_date AS row_date, r.created_at, 'SALES_RETURN' AS type, 'مرتجع بيع' AS type_label,
           r.return_no AS document_no, 'مرتجع بيع مؤكد' AS description,
           0::numeric AS debit, r.total_amount AS credit, r.currency_code,
           0::numeric AS debit_usd,
           COALESCE(r.total_amount_usd, CASE WHEN r.currency_code='USD' THEN r.total_amount ELSE r.total_amount / NULLIF(r.exchange_rate_to_usd, 0) END) AS credit_usd,
           'RETURN_INVOICE' AS source_type, r.id AS source_id, r.status, r.notes
    FROM return_invoices r
    WHERE r.company_id=$1 AND r.customer_id=$2 AND r.return_type='SALES_RETURN' AND r.status='CONFIRMED'
      AND COALESCE(r.settlement_type, 'CREDIT_BALANCE') <> 'NO_FINANCIAL_EFFECT'
    ${dateCondition('r', 'return_date')}

    UNION ALL
    SELECT cd.discount_date AS row_date, cd.created_at, 'CUSTOMER_DISCOUNT' AS type, 'حسم عميل' AS type_label,
           cd.discount_no AS document_no, COALESCE(cd.description, 'حسم منحة على ذمة العميل') AS description,
           0::numeric AS debit, cd.amount AS credit, cd.currency_code,
           0::numeric AS debit_usd,
           cd.amount_usd AS credit_usd,
           'CUSTOMER_DISCOUNT' AS source_type, cd.id AS source_id, cd.status, cd.notes
    FROM customer_discounts cd
    WHERE cd.company_id=$1 AND cd.customer_id=$2 AND cd.status='CONFIRMED'
    ${dateCondition('cd', 'discount_date')}

    UNION ALL
    SELECT je.entry_date AS row_date, je.created_at, 'CUSTOMER_JOURNAL' AS type, 'قيد مالي' AS type_label,
           je.entry_no AS document_no, COALESCE(jl.description, je.description, 'قيد مالي على ذمة العميل') AS description,
           jl.debit AS debit, jl.credit AS credit, jl.currency_code,
           jl.debit AS debit_usd, jl.credit AS credit_usd,
           je.source_type AS source_type, je.id AS source_id, je.status, je.description AS notes
    FROM journal_lines jl
    INNER JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    WHERE jl.company_id=$1 AND jl.party_id=$2 AND jl.party_type='CUSTOMER'
      AND je.status='POSTED' AND je.source_type IN ('MANUAL', 'OPENING', 'SYSTEM')
    ${dateCondition('je', 'entry_date', 'jl')}
  `;
  params.splice(0, 0);
  return { sql, params };
}

function supplierRowsQuery(period: 'opening' | 'period', filters: PartyStatementFilters) {
  const params: unknown[] = [];
  const p = { value: 1 };
  const dateCondition = (alias: string, col: string) => {
    const conditions: string[] = [];
    if (period === 'opening' && filters.fromDate) {
      conditions.push(`${alias}.${col} < $${p.value}::date`);
      params.push(filters.fromDate);
      p.value++;
    } else if (period === 'period') {
      if (filters.fromDate) {
        conditions.push(`${alias}.${col} >= $${p.value}::date`);
        params.push(filters.fromDate);
        p.value++;
      }
      if (filters.toDate) {
        conditions.push(`${alias}.${col} <= $${p.value}::date`);
        params.push(filters.toDate);
        p.value++;
      }
    }
    if (filters.currency) {
      conditions.push(`${alias}.currency_code = $${p.value}`);
      params.push(filters.currency);
      p.value++;
    }
    return conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
  };

  const sql = `
    SELECT pi.invoice_date AS row_date, pi.created_at, 'PURCHASE_INVOICE' AS type, 'فاتورة شراء' AS type_label,
           pi.invoice_no AS document_no, 'فاتورة شراء مؤكدة' AS description,
           0::numeric AS debit, pi.total_amount AS credit, pi.currency_code,
           0::numeric AS debit_usd,
           COALESCE(pi.total_amount_usd, CASE WHEN pi.currency_code='USD' THEN pi.total_amount ELSE pi.total_amount / NULLIF(pi.exchange_rate_to_usd, 0) END) AS credit_usd,
           'PURCHASE_INVOICE' AS source_type, pi.id AS source_id, pi.document_status AS status, pi.notes
    FROM purchase_invoices pi
    WHERE pi.company_id=$${p.value++} AND pi.supplier_id=$${p.value++} AND pi.document_status='CONFIRMED'
    ${dateCondition('pi', 'invoice_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'PAYMENT_VOUCHER' AS type,
           ('سند دفع — ' || CASE COALESCE(v.purpose, 'INVOICE_PAYMENT')
              WHEN 'ADVANCE' THEN 'عربون'
              WHEN 'ADVANCE_REFUND' THEN 'رد عربون'
              WHEN 'COMPENSATION' THEN 'تعويض / عطل وضرر'
              WHEN 'OTHER' THEN 'أخرى'
              ELSE 'دفعة / تسوية فاتورة'
            END) || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند دفع مؤكد') || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS description,
           v.amount AS debit, 0::numeric AS credit, v.currency_code,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='SUPPLIER' AND v.voucher_type='PAYMENT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'RECEIPT_VOUCHER' AS type,
           ('سند قبض من المورد — ' || CASE COALESCE(v.purpose, 'INVOICE_PAYMENT')
              WHEN 'ADVANCE' THEN 'عربون'
              WHEN 'ADVANCE_REFUND' THEN 'رد عربون'
              WHEN 'COMPENSATION' THEN 'تعويض / عطل وضرر'
              WHEN 'OTHER' THEN 'أخرى'
              ELSE 'دفعة / تسوية فاتورة'
            END) || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند قبض مؤكد') || ${VOUCHER_CHECK_SUFFIX} || ${VOUCHER_CONVERT_SUFFIX} AS description,
           0::numeric AS debit, v.amount AS credit, v.currency_code,
           0::numeric AS debit_usd,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END) AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='SUPPLIER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    SELECT r.return_date AS row_date, r.created_at, 'PURCHASE_RETURN' AS type, 'مرتجع شراء' AS type_label,
           r.return_no AS document_no, 'مرتجع شراء مؤكد' AS description,
           r.total_amount AS debit, 0::numeric AS credit, r.currency_code,
           COALESCE(r.total_amount_usd, CASE WHEN r.currency_code='USD' THEN r.total_amount ELSE r.total_amount / NULLIF(r.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'RETURN_INVOICE' AS source_type, r.id AS source_id, r.status, r.notes
    FROM return_invoices r
    WHERE r.company_id=$1 AND r.supplier_id=$2 AND r.return_type='PURCHASE_RETURN' AND r.status='CONFIRMED'
      AND COALESCE(r.settlement_type, 'CREDIT_BALANCE') <> 'NO_FINANCIAL_EFFECT'
    ${dateCondition('r', 'return_date')}
  `;
  return { sql, params };
}

async function buildStatement(kind: PartyKind, companyId: string, partyId: string, filters: PartyStatementFilters) {
  const party = kind === 'CUSTOMER' ? await loadCustomer(companyId, partyId) : await loadSupplier(companyId, partyId);
  if (!party) throw Object.assign(new Error(kind === 'CUSTOMER' ? 'العميل غير موجود' : 'المورد غير موجود'), { code: 'NOT_FOUND' });

  const queryBuilder = kind === 'CUSTOMER' ? customerRowsQuery : supplierRowsQuery;
  const openingQuery = filters.fromDate ? queryBuilder('opening', filters) : null;
  const periodQuery = queryBuilder('period', filters);
  const pool = getPool();

  const openingRows = openingQuery
    ? (
        await pool.query<StatementSourceRow>(
          `SELECT * FROM (${openingQuery.sql}) src ORDER BY row_date ASC, created_at ASC, document_no ASC`,
          [companyId, partyId, ...openingQuery.params],
        )
      ).rows
    : [];
  const periodRows = (
    await pool.query<StatementSourceRow>(
      `SELECT * FROM (${periodQuery.sql}) src ORDER BY row_date ASC, created_at ASC, document_no ASC`,
      [companyId, partyId, ...periodQuery.params],
    )
  ).rows;

  const applyBalance = (balance: number, debit: number, credit: number) =>
    kind === 'CUSTOMER' ? balance + debit - credit : balance + credit - debit;

  // سياسة العملات (بشير) — البند 2: عند تحديد عملة واحدة صريحة (filters.currency)،
  // كل الصفوف المُعادة بالفعل من نفس تلك العملة فقط (الشرط مطبَّق بـ
  // customerRowsQuery/supplierRowsQuery أعلاه) — فالرصيد يُحسَب من القيم
  // الأصلية (debit/credit) لا المُحوَّلة للدولار (debit_usd/credit_usd)، فيعكس
  // مديونية العميل بعملتها الحقيقية دون أي تحويل ضمني. بلا تحديد عملة (الوضع
  // الافتراضي الحالي، المُستخدَم فعلاً بـTASK 004/006) — السلوك الحالي يبقى
  // بلا أي تغيير: جمع موحَّد بالدولار عبر كل العملات المختلطة.
  const useOriginalCurrency = Boolean(filters.currency);

  let openingBalance = 0;
  openingRows.forEach((row) => {
    const { debit: d, credit: c } = pickStatementRowAmounts(row, useOriginalCurrency);
    openingBalance = applyBalance(openingBalance, d, c);
  });

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = periodRows.map((row) => {
    const debitOriginal = Number(row.debit);
    const creditOriginal = Number(row.credit);
    const { debit, credit } = pickStatementRowAmounts(row, useOriginalCurrency);
    totalDebit += debit;
    totalCredit += credit;
    running = applyBalance(running, debit, credit);
    return {
      date: toIsoDate(row.row_date),
      type: row.type,
      typeLabel: row.type_label,
      documentNo: row.document_no,
      description: row.description,
      debit,
      credit,
      balance: running,
      debitOriginal,
      creditOriginal,
      currency: row.currency_code,
      sourceType: row.source_type,
      sourceId: row.source_id,
      status: row.status,
      notes: row.notes,
    };
  });

  // شيكات العميل قيد التحصيل (مستلمة/مودعة ولم تُحصَّل): لا تُخصم من الرصيد الحالي،
  // وتُعرض مع «الرصيد المتوقع» بعد تحصيلها.
  let pendingChecks: PendingCheckRow[] = [];
  if (kind === 'CUSTOMER') {
    const pendParams: unknown[] = [companyId, partyId];
    let pendCond = '';
    if (filters.toDate) { pendParams.push(filters.toDate); pendCond += ` AND v.voucher_date <= $${pendParams.length}::date`; }
    if (filters.currency) { pendParams.push(filters.currency); pendCond += ` AND v.currency_code = $${pendParams.length}`; }
    const pend = await pool.query<{ check_id: string; check_no: string; bank_name: string; due_date: string; status: string; voucher_no: string; currency_code: string; amount: string; amount_usd: string }>(
      `SELECT c.id AS check_id, c.check_no, c.bank_name, c.due_date::text AS due_date, c.status, v.voucher_no, v.currency_code,
              vl.amount::text AS amount,
              COALESCE(vl.amount_usd, CASE WHEN v.currency_code='USD' THEN vl.amount ELSE vl.amount / NULLIF(v.exchange_rate_to_usd, 0) END)::text AS amount_usd
         FROM voucher_lines vl
         JOIN vouchers v ON v.id = vl.voucher_id AND v.company_id = vl.company_id
         JOIN checks c ON c.id = vl.check_id AND c.company_id = vl.company_id
        WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='CUSTOMER' AND v.voucher_type='RECEIPT'
          AND v.status='CONFIRMED' AND c.status IN ('RECEIVED','DEPOSITED')${pendCond}
        ORDER BY c.due_date ASC, c.check_no ASC`,
      pendParams,
    );
    pendingChecks = pend.rows.map((r) => ({
      checkId: r.check_id, checkNo: r.check_no, bankName: r.bank_name, dueDate: r.due_date.slice(0, 10), status: r.status,
      voucherNo: r.voucher_no, currency: r.currency_code, amount: Number(r.amount), amountUsd: Number(r.amount_usd),
    }));
  }
  const pendingChecksTotal = pendingChecks.reduce((s, c) => s + (useOriginalCurrency ? c.amount : c.amountUsd), 0);

  return {
    [kind === 'CUSTOMER' ? 'customer' : 'supplier']: party,
    period: {
      from: filters.fromDate || null,
      to: filters.toDate || null,
    },
    openingBalance,
    rows,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      closingBalance: running,
      /** الرصيد بعد تحصيل الشيكات قيد التحصيل (للعميل فقط). */
      pendingChecksTotal,
      expectedBalance: running - pendingChecksTotal,
    },
    pendingChecks,
  };
}

export async function getCustomerStatement(companyId: string, customerId: string, filters: PartyStatementFilters) {
  return buildStatement('CUSTOMER', companyId, customerId, filters);
}

export async function getSupplierStatement(companyId: string, supplierId: string, filters: PartyStatementFilters) {
  return buildStatement('SUPPLIER', companyId, supplierId, filters);
}

export type PartyStatementByCurrency = Awaited<ReturnType<typeof buildStatement>>;

/**
 * سياسة العملات (بشير) — البند 2: رصيد مستقل لكل عملة فعلية للعميل/المورّد،
 * دون جمعها ببعضها. لا يُعدِّل buildStatement الحالية (تبقى بسلوكها الحالي
 * تماماً — المُستخدَمة فعلياً بـTASK 004/006) — يستدعيها مرة واحدة أولاً
 * بلا فلتر عملة لاستخراج قائمة العملات الفعلية المُستخدَمة فعلياً (من
 * `rows[].currency` المُعادة أصلاً، لا استعلام إضافي جديد)، ثم مرة واحدة
 * لكل عملة فعلية بتفعيل filters.currency (فيُستخدَم مسار القيم الأصلية
 * المُضاف أعلاه تلقائياً). N+1 استدعاء صغير (عدد عملات العميل، عملياً 1-3)
 * — مقبول تماماً لحجم بيانات كشف حساب فرد واحد، ويتجنّب إعادة كتابة
 * استعلام UNION المُعقَّد لتجميع "GROUP BY عملة" بالخادم مباشرة.
 */
async function buildStatementByCurrency(
  kind: PartyKind,
  companyId: string,
  partyId: string,
  filters: Omit<PartyStatementFilters, 'currency'>,
): Promise<{
  customer?: unknown;
  supplier?: unknown;
  period: { from: string | null; to: string | null };
  byCurrency: Array<{
    currency: string;
    openingBalance: number;
    rows: PartyStatementByCurrency['rows'];
    totals: PartyStatementByCurrency['totals'];
    pendingChecks: PendingCheckRow[];
  }>;
}> {
  const all = await buildStatement(kind, companyId, partyId, filters);
  const currencies = Array.from(new Set(all.rows.map((r) => r.currency).filter(Boolean))).sort();

  const byCurrency = await Promise.all(
    currencies.map(async (currency) => {
      const scoped = await buildStatement(kind, companyId, partyId, { ...filters, currency });
      return {
        currency,
        openingBalance: scoped.openingBalance,
        rows: scoped.rows,
        totals: scoped.totals,
        pendingChecks: scoped.pendingChecks,
      };
    }),
  );

  return {
    customer: (all as { customer?: unknown }).customer,
    supplier: (all as { supplier?: unknown }).supplier,
    period: all.period,
    byCurrency,
  };
}

export async function getCustomerStatementByCurrency(
  companyId: string,
  customerId: string,
  filters: Omit<PartyStatementFilters, 'currency'>,
) {
  return buildStatementByCurrency('CUSTOMER', companyId, customerId, filters);
}

export async function getSupplierStatementByCurrency(
  companyId: string,
  supplierId: string,
  filters: Omit<PartyStatementFilters, 'currency'>,
) {
  return buildStatementByCurrency('SUPPLIER', companyId, supplierId, filters);
}
