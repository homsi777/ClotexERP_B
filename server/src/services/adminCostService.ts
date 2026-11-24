import type { Pool, PoolClient } from 'pg';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
/** نفس تحويل الياردة للمتر المعتمد بالفواتير (محلي لتفادي استيراد دائري). */
const quantityToMeters = (q: number, unit: 'meter' | 'yard') => (unit === 'yard' ? Math.round(q * 0.9144 * 1000) / 1000 : q);
const fail = (m: string, code = 'VALIDATION') => Object.assign(new Error(m), { code });

/**
 * التكلفة الإدارية السرّية وتحليل الربحية — للمالك فقط (أو من فوّضه صراحةً).
 * هذا الملف هو المرجع الوحيد لجداول admin_cost_* و sales_line_admin_cost؛ لا تقرؤها أي تقارير أو تصديرات أخرى
 * (يفرض ذلك اختبار يفحص بقية الشيفرة)، ولا تؤثر على المحاسبة أو الذمم أو تقييم المخزون الرسمي.
 */
export async function canSeeAdminCost(db: Db, user: { sub: string; companyId: string; isPlatformAdmin?: boolean } | undefined): Promise<boolean> {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return (await db.query('SELECT 1 FROM admin_cost_delegates WHERE company_id=$1 AND user_id=$2', [user.companyId, user.sub])).rows.length > 0;
}

export async function listDelegates(db: Db, companyId: string) {
  return (await db.query(`SELECT d.user_id, COALESCE(u.full_name,u.username) AS name, d.granted_at::text AS granted_at FROM admin_cost_delegates d JOIN users u ON u.id=d.user_id WHERE d.company_id=$1 ORDER BY d.granted_at`, [companyId])).rows;
}
export async function setDelegates(db: Db, companyId: string, ownerId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (ids.length) {
    const ok = await db.query('SELECT id FROM users WHERE company_id=$1 AND is_active AND id = ANY($2::uuid[])', [companyId, ids]);
    if (ok.rows.length !== ids.length) throw fail('مستخدم غير صالح للتفويض');
  }
  await db.query('DELETE FROM admin_cost_delegates WHERE company_id=$1', [companyId]);
  for (const id of ids) await db.query('INSERT INTO admin_cost_delegates (company_id, user_id, granted_by_user_id) VALUES ($1,$2,$3)', [companyId, id, ownerId]);
}

export interface CostGroup { itemId: string; itemName: string; itemCode: string | null; colorId: string | null; colorName: string | null; rolls: number; meters: number; officialPricedRolls: number; adminRate: { scope: string; unitCostPerMeter: number; currency: string; since: string } | null }

/** مجموعات الخامة/اللون في المخزون (بما فيها الأرصدة الافتتاحية غير المسعّرة رسمياً) مع التكلفة الإدارية الحالية. */
export async function listCostGroups(db: Db, companyId: string, opts: { onlyMissing?: boolean; search?: string } = {}): Promise<CostGroup[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT r.item_id, fi.name AS item_name, fi.internal_code, r.color_id, fc.name_ar AS color_name,
            count(*)::int AS rolls, COALESCE(sum(r.length_m),0)::float AS meters, count(*) FILTER (WHERE r.unit_cost IS NOT NULL AND r.unit_cost > 0)::int AS official,
            (SELECT row_to_json(x) FROM (SELECT a.scope, a.unit_cost_per_meter::float AS cost, a.currency_code AS currency, a.effective_from::text AS since FROM admin_cost_rates a
               WHERE a.company_id=r.company_id AND a.item_id=r.item_id AND ((a.scope='ITEM_COLOR' AND a.color_id IS NOT DISTINCT FROM r.color_id) OR a.scope='ITEM')
               ORDER BY CASE a.scope WHEN 'ITEM_COLOR' THEN 0 ELSE 1 END, a.effective_from DESC LIMIT 1) x) AS rate
       FROM fabric_rolls r JOIN fabric_items fi ON fi.id=r.item_id LEFT JOIN fabric_colors fc ON fc.id=r.color_id
      WHERE r.company_id=$1 AND r.status IN ('AVAILABLE','RESERVED') AND ($2::text IS NULL OR fi.name ILIKE $2 OR fi.internal_code ILIKE $2)
      GROUP BY r.company_id, r.item_id, fi.name, fi.internal_code, r.color_id, fc.name_ar ORDER BY fi.name, fc.name_ar LIMIT 1000`,
    [companyId, opts.search?.trim() ? `%${opts.search.trim()}%` : null])).rows;
  const groups = rows.map((r) => {
    const rate = r.rate as { scope: string; cost: number; currency: string; since: string } | null;
    return { itemId: String(r.item_id), itemName: String(r.item_name), itemCode: (r.internal_code as string | null) ?? null, colorId: (r.color_id as string | null) ?? null, colorName: (r.color_name as string | null) ?? null,
      rolls: Number(r.rolls), meters: Number(r.meters), officialPricedRolls: Number(r.official), adminRate: rate ? { scope: rate.scope, unitCostPerMeter: Number(rate.cost), currency: rate.currency, since: rate.since } : null };
  });
  return opts.onlyMissing ? groups.filter((g) => !g.adminRate) : groups;
}

export interface RateInput { scope: 'ITEM' | 'ITEM_COLOR' | 'ROLL'; itemId?: string | null; colorId?: string | null; rollId?: string | null; unitCostPerMeter: number; currency: string; note?: string | null }
/** يضيف أسعاراً جديدة (append-only). لا يعدّل ولا يحذف سجلاً قديماً ولا يمسّ unit_cost الرسمي للأتواب. */
export async function setRates(db: Db, companyId: string, userId: string, rates: RateInput[]): Promise<number> {
  if (!rates.length || rates.length > 500) throw fail('أدخل بين 1 و500 سعر');
  for (const r of rates) {
    if (!(r.unitCostPerMeter > 0) || !Number.isFinite(r.unitCostPerMeter)) throw fail('التكلفة الإدارية يجب أن تكون أكبر من صفر (لا تُقبل تكلفة صفرية)');
    if (!/^[A-Za-z]{2,8}$/.test(r.currency ?? '')) throw fail('عملة التكلفة مطلوبة');
    if (r.scope === 'ITEM' && !r.itemId) throw fail('الخامة مطلوبة');
    if (r.scope === 'ITEM_COLOR' && (!r.itemId || !r.colorId)) throw fail('الخامة واللون مطلوبان');
    if (r.scope === 'ROLL' && !r.rollId) throw fail('الثوب مطلوب');
    if (r.itemId && !(await db.query('SELECT 1 FROM fabric_items WHERE id=$1 AND company_id=$2', [r.itemId, companyId])).rows.length) throw fail('خامة غير موجودة بالفرع', 'NOT_FOUND');
    if (r.rollId && !(await db.query('SELECT 1 FROM fabric_rolls WHERE id=$1 AND company_id=$2', [r.rollId, companyId])).rows.length) throw fail('ثوب غير موجود بالفرع', 'NOT_FOUND');
    await db.query(
      `INSERT INTO admin_cost_rates (company_id, scope, item_id, color_id, roll_id, unit_cost_per_meter, currency_code, set_by_user_id, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [companyId, r.scope, r.scope === 'ROLL' ? null : r.itemId ?? null, r.scope === 'ITEM_COLOR' ? r.colorId ?? null : null, r.scope === 'ROLL' ? r.rollId ?? null : null, r.unitCostPerMeter, r.currency.toUpperCase(), userId, r.note ?? null]);
  }
  return rates.length;
}

/** التكلفة السارية لثوب/خامة/لون عند لحظة معيّنة: الثوب ثم الخامة+اللون ثم الخامة. */
export async function resolveRate(db: Db, companyId: string, p: { rollId?: string | null; itemId: string; colorId?: string | null; at?: string }) {
  const r = (await db.query<{ id: string; scope: 'ROLL' | 'ITEM_COLOR' | 'ITEM'; cost: string; currency: string }>(
    `SELECT id, scope, unit_cost_per_meter::text AS cost, currency_code AS currency FROM admin_cost_rates
      WHERE company_id=$1 AND effective_from <= COALESCE($5::timestamptz, clock_timestamp())
        AND ((scope='ROLL' AND roll_id=$2) OR (scope='ITEM_COLOR' AND item_id=$3 AND color_id=$4) OR (scope='ITEM' AND item_id=$3))
      ORDER BY CASE scope WHEN 'ROLL' THEN 0 WHEN 'ITEM_COLOR' THEN 1 ELSE 2 END, effective_from DESC LIMIT 1`,
    [companyId, p.rollId ?? null, p.itemId, p.colorId ?? null, p.at ?? null])).rows[0];
  return r ? { id: r.id, scope: r.scope, unitCostPerMeter: Number(r.cost), currency: r.currency } : null;
}

/**
 * عند اعتماد البيع: تُحفظ لقطة التكلفة الإدارية السارية لكل سطر بالمتر/الياردة. سطر بلا تكلفة إدارية = بلا لقطة (غير مسعّر)،
 * ولا تُفترض تكلفة صفرية. تغيير التكلفة لاحقاً لا يمسّ اللقطة.
 */
export async function snapshotAdminCostForInvoice(db: Db, companyId: string, invoiceId: string): Promise<number> {
  const lines = (await db.query<{ id: string; item_id: string | null; color_id: string | null; roll_id: string | null; quantity: string; unit: string }>(
    `SELECT l.id, COALESCE(l.fabric_item_id, r.item_id) AS item_id, r.color_id, l.fabric_roll_id AS roll_id, l.quantity::text, l.unit
       FROM sales_invoice_lines l LEFT JOIN fabric_rolls r ON r.id=l.fabric_roll_id
      WHERE l.company_id=$1 AND l.invoice_id=$2 AND l.unit IN ('meter','yard')`, [companyId, invoiceId])).rows;
  let n = 0;
  for (const l of lines) {
    if (!l.item_id) continue;
    const rate = await resolveRate(db, companyId, { rollId: l.roll_id, itemId: l.item_id, colorId: l.color_id });
    if (!rate) continue;
    const meters = quantityToMeters(Number(l.quantity), l.unit as 'meter' | 'yard');
    if (!(meters > 0)) continue;
    await db.query(
      `INSERT INTO sales_line_admin_cost (company_id, sales_invoice_line_id, invoice_id, quantity_m, unit_cost_per_meter, currency_code, total_cost, source, rate_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (sales_invoice_line_id) DO NOTHING`,
      [companyId, l.id, invoiceId, meters, rate.unitCostPerMeter, rate.currency, Math.round(meters * rate.unitCostPerMeter * 100) / 100, rate.scope, rate.id]);
    n++;
  }
  return n;
}

export interface ProfitRow { currency: string; revenue: number; cost: number; profit: number; marginPct: number | null; pricedLines: number }
export interface Profitability {
  period: { from: string; to: string };
  byCurrency: ProfitRow[];
  /** أسطر بيع بالمتر بلا تكلفة إدارية وقت البيع: لا تدخل في الربح ولا تُقدَّر بصفر. */
  unpriced: Array<{ currency: string; lines: number; revenue: number }>;
  /** أسطر تكلفتها بعملة تخالف عملة الفاتورة: مستبعدة لأننا لا نحوّل بين العملات. */
  currencyMismatch: number;
  byItem: Array<{ itemName: string; currency: string; revenue: number; cost: number; profit: number }>;
  notes: string[];
}
export async function profitability(db: Db, companyId: string, from: string, to: string): Promise<Profitability> {
  const base = `FROM sales_invoice_lines l JOIN sales_invoices si ON si.id=l.invoice_id AND si.company_id=l.company_id AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date
                JOIN sales_line_admin_cost c ON c.sales_invoice_line_id=l.id AND c.company_id=l.company_id`;
  const rows = (await db.query<{ currency: string; revenue: string; cost: string; n: string }>(
    `SELECT si.currency_code AS currency, sum(l.line_total)::text AS revenue, sum(c.total_cost)::text AS cost, count(*)::text AS n ${base} WHERE l.company_id=$1 AND c.currency_code = si.currency_code GROUP BY 1 ORDER BY 1`, [companyId, from, to])).rows;
  const mismatch = (await db.query<{ n: string }>(`SELECT count(*)::text AS n ${base} WHERE l.company_id=$1 AND c.currency_code <> si.currency_code`, [companyId, from, to])).rows[0];
  const unpriced = (await db.query<{ currency: string; lines: string; revenue: string }>(
    `SELECT si.currency_code AS currency, count(*)::text AS lines, COALESCE(sum(l.line_total),0)::text AS revenue FROM sales_invoice_lines l JOIN sales_invoices si ON si.id=l.invoice_id AND si.company_id=l.company_id
      WHERE l.company_id=$1 AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date AND l.unit IN ('meter','yard')
        AND NOT EXISTS (SELECT 1 FROM sales_line_admin_cost c WHERE c.sales_invoice_line_id=l.id) GROUP BY 1 ORDER BY 1`, [companyId, from, to])).rows;
  const items = (await db.query<{ item: string; currency: string; revenue: string; cost: string }>(
    `SELECT COALESCE(fi.name, l.description, '—') AS item, si.currency_code AS currency, sum(l.line_total)::text AS revenue, sum(c.total_cost)::text AS cost ${base} LEFT JOIN fabric_items fi ON fi.id=l.fabric_item_id
      WHERE l.company_id=$1 AND c.currency_code = si.currency_code GROUP BY 1, 2 ORDER BY sum(l.line_total) - sum(c.total_cost) DESC LIMIT 20`, [companyId, from, to])).rows;
  return {
    period: { from, to },
    byCurrency: rows.map((r) => { const rev = Number(r.revenue), cost = Number(r.cost); return { currency: r.currency, revenue: rev, cost, profit: rev - cost, marginPct: rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : null, pricedLines: Number(r.n) }; }),
    unpriced: unpriced.map((r) => ({ currency: r.currency, lines: Number(r.lines), revenue: Number(r.revenue) })),
    currencyMismatch: Number(mismatch.n),
    byItem: items.map((r) => ({ itemName: r.item, currency: r.currency, revenue: Number(r.revenue), cost: Number(r.cost), profit: Number(r.revenue) - Number(r.cost) })),
    notes: [
      'الربح التقديري = صافي سعر البيع (بعد الخصم وقبل الضريبة) − التكلفة الإدارية المحفوظة وقت اعتماد البيع.',
      'المبيعات قبل تفعيل هذه الميزة، وأي سطر بلا تكلفة إدارية وقت بيعه، لا يدخل في الربح (لا تكلفة صفرية).',
      'لا تحويل بين العملات؛ وهذه التكلفة لا تؤثر على المحاسبة ولا الذمم ولا تقييم المخزون الرسمي.',
    ],
  };
}
