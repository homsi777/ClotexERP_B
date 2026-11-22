import type { Pool, PoolClient } from 'pg';

type Db = Pick<Pool | PoolClient, 'query'>;

/** مسودة فاتورة بيع بحاجة إلى تسعير: إجماليها صفر أو فيها سطر بلا سعر. */
export const SALES_NEEDS_PRICING_SQL = `(si.document_status = 'DRAFT' AND (si.total_amount = 0 OR EXISTS (
    SELECT 1 FROM sales_invoice_lines l WHERE l.invoice_id = si.id AND l.company_id = si.company_id AND l.unit_price = 0)))`;

/** مسودة فاتورة شراء بحاجة إلى تسعير. */
export const PURCHASE_NEEDS_PRICING_SQL = `(pi.document_status = 'DRAFT' AND (pi.total_amount = 0 OR EXISTS (
    SELECT 1 FROM purchase_invoice_lines l WHERE l.invoice_id = pi.id AND l.company_id = pi.company_id AND l.unit_cost = 0)))`;

const HEADER_MONEY = [
  'subtotal', 'discount_total', 'tax_total', 'total_amount', 'paid_amount', 'remaining_amount',
  'subtotal_usd', 'discount_total_usd', 'tax_total_usd', 'total_amount_usd', 'paid_amount_usd', 'remaining_amount_usd',
  'exchange_rate_to_usd',
];
const LINE_MONEY = [
  'unit_price', 'unit_price_usd', 'unit_cost', 'unit_cost_usd', 'line_discount', 'line_tax', 'line_total',
  'line_discount_usd', 'line_tax_usd', 'line_total_usd', 'cost_unit_price',
];

/** يخفي الحقول المالية عن من لا يملك صلاحية التسعير (الصفوف تبقى بكمياتها وأسمائها). */
export function maskMoneyRow<T extends Record<string, unknown>>(row: T, kind: 'header' | 'line'): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of kind === 'header' ? HEADER_MONEY : LINE_MONEY) {
    if (k in out) out[k] = k === 'exchange_rate_to_usd' ? 1 : 0;
  }
  if (kind === 'header' && 'payment_status' in out) out.payment_status = 'unpaid';
  out.money_hidden = true;
  return out as T;
}

export interface PricingQueueItem {
  kind: 'SALES' | 'PURCHASE';
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  partyName: string;
}

/** مسودات الشراء والبيع المنتظرة تسعير المحاسب (لإشعارات الجرس). */
export async function listPricingQueue(db: Db, companyId: string): Promise<{ total: number; items: PricingQueueItem[] }> {
  const sales = await db.query(
    `SELECT si.id, si.invoice_no, si.invoice_date::text AS invoice_date, c.name AS party
       FROM sales_invoices si JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
      WHERE si.company_id = $1 AND ${SALES_NEEDS_PRICING_SQL}
      ORDER BY si.invoice_date DESC, si.created_at DESC LIMIT 50`,
    [companyId],
  );
  const purchases = await db.query(
    `SELECT pi.id, pi.invoice_no, pi.invoice_date::text AS invoice_date, s.name AS party
       FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id AND s.company_id = pi.company_id
      WHERE pi.company_id = $1 AND ${PURCHASE_NEEDS_PRICING_SQL}
      ORDER BY pi.invoice_date DESC, pi.created_at DESC LIMIT 50`,
    [companyId],
  );
  const items: PricingQueueItem[] = [
    ...sales.rows.map((r) => ({ kind: 'SALES' as const, id: r.id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, partyName: r.party })),
    ...purchases.rows.map((r) => ({ kind: 'PURCHASE' as const, id: r.id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, partyName: r.party })),
  ];
  return { total: items.length, items };
}

/** يصفّر الأسعار والإجماليات: فاتورة أولية (عميل + بضاعة) يسعّرها المحاسب لاحقاً. */
export function unpricedInvoiceBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = { ...(body as Record<string, unknown>) };
  const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]).map((l) => ({
    ...l, unitPrice: 0, unitPriceUsd: 0, lineDiscount: 0, lineTax: 0, lineTotal: 0, lineDiscountUsd: 0, lineTaxUsd: 0, lineTotalUsd: 0,
  })) : b.lines;
  return { ...b, lines, subtotal: 0, discountTotal: 0, taxTotal: 0, totalAmount: 0, paidAmount: 0, remainingAmount: 0,
    subtotalUsd: 0, discountTotalUsd: 0, taxTotalUsd: 0, totalAmountUsd: 0, paidAmountUsd: 0, remainingAmountUsd: 0, paymentStatus: 'unpaid' };
}

