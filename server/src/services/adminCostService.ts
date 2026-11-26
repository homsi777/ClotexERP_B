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

export interface CostGroup { itemId: string; itemName: string; itemCode: string | null; colorId: string | null; colorName: string | null; rolls: number; meters: number; officialPricedRolls: number; adminRate: { scope: string; unitCostPerMeter: number; basis: 'METER' | 'KG'; currency: string; since: string } | null }

/** مجموعات الخامة/اللون في المخزون (بما فيها الأرصدة الافتتاحية غير المسعّرة رسمياً) مع التكلفة الإدارية الحالية. */
export async function listCostGroups(db: Db, companyId: string, opts: { onlyMissing?: boolean; search?: string } = {}): Promise<CostGroup[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT r.item_id, fi.name AS item_name, fi.internal_code, r.color_id, fc.name_ar AS color_name,
            count(*)::int AS rolls, COALESCE(sum(CASE WHEN r.entry_basis='WEIGHT' THEN 0 ELSE r.length_m END),0)::float AS meters, count(*) FILTER (WHERE r.unit_cost IS NOT NULL AND r.unit_cost > 0)::int AS official,
            (SELECT row_to_json(x) FROM (SELECT a.scope, a.unit_cost_per_meter::float AS cost, a.unit_basis AS basis, a.currency_code AS currency, a.effective_from::text AS since FROM admin_cost_rates a
               WHERE a.company_id=r.company_id AND a.item_id=r.item_id AND ((a.scope='ITEM_COLOR' AND a.color_id IS NOT DISTINCT FROM r.color_id) OR a.scope='ITEM')
               ORDER BY CASE a.scope WHEN 'ITEM_COLOR' THEN 0 ELSE 1 END, a.effective_from DESC LIMIT 1) x) AS rate
       FROM fabric_rolls r JOIN fabric_items fi ON fi.id=r.item_id LEFT JOIN fabric_colors fc ON fc.id=r.color_id
      WHERE r.company_id=$1 AND r.status IN ('AVAILABLE','RESERVED') AND ($2::text IS NULL OR fi.name ILIKE $2 OR fi.internal_code ILIKE $2)
      GROUP BY r.company_id, r.item_id, fi.name, fi.internal_code, r.color_id, fc.name_ar ORDER BY fi.name, fc.name_ar LIMIT 1000`,
    [companyId, opts.search?.trim() ? `%${opts.search.trim()}%` : null])).rows;
  const groups = rows.map((r) => {
    const rate = r.rate as { scope: string; cost: number; basis: 'METER' | 'KG'; currency: string; since: string } | null;
    return { itemId: String(r.item_id), itemName: String(r.item_name), itemCode: (r.internal_code as string | null) ?? null, colorId: (r.color_id as string | null) ?? null, colorName: (r.color_name as string | null) ?? null,
      rolls: Number(r.rolls), meters: Number(r.meters), officialPricedRolls: Number(r.official), adminRate: rate ? { scope: rate.scope, unitCostPerMeter: Number(rate.cost), basis: rate.basis, currency: rate.currency, since: rate.since } : null };
  });
  return opts.onlyMissing ? groups.filter((g) => !g.adminRate) : groups;
}

export interface RateInput { scope: 'ITEM' | 'ITEM_COLOR' | 'ROLL'; itemId?: string | null; colorId?: string | null; rollId?: string | null; unitCostPerMeter: number; basis?: 'METER' | 'KG'; currency: string; note?: string | null }
/** يضيف أسعاراً جديدة (append-only). لا يعدّل ولا يحذف سجلاً قديماً ولا يمسّ unit_cost الرسمي للأتواب. القيمة بالمتر أو بالكيلو حسب basis. */
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
      `INSERT INTO admin_cost_rates (company_id, scope, item_id, color_id, roll_id, unit_cost_per_meter, unit_basis, currency_code, set_by_user_id, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [companyId, r.scope, r.scope === 'ROLL' ? null : r.itemId ?? null, r.scope === 'ITEM_COLOR' ? r.colorId ?? null : null, r.scope === 'ROLL' ? r.rollId ?? null : null, r.unitCostPerMeter, r.basis === 'KG' ? 'KG' : 'METER', r.currency.toUpperCase(), userId, r.note ?? null]);
  }
  return rates.length;
}

/** أتواب مفردة (للتسعير الإداري لتوب منفرد، بما فيها الأرصدة الافتتاحية) مع التكلفة الإدارية السارية. */
export async function listCostRolls(db: Db, companyId: string, opts: { itemId: string; colorId?: string | null; onlyMissing?: boolean }) {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT r.id, r.barcode, r.length_m::float AS meters, COALESCE(r.actual_weight_kg, r.calculated_weight_kg)::float AS kg, (r.unit_cost IS NOT NULL AND r.unit_cost > 0) AS official,
            (SELECT row_to_json(x) FROM (SELECT a.scope, a.unit_cost_per_meter::float AS cost, a.unit_basis AS basis, a.currency_code AS currency FROM admin_cost_rates a
               WHERE a.company_id=r.company_id AND ((a.scope='ROLL' AND a.roll_id=r.id) OR (a.scope='ITEM_COLOR' AND a.item_id=r.item_id AND a.color_id IS NOT DISTINCT FROM r.color_id) OR (a.scope='ITEM' AND a.item_id=r.item_id))
               ORDER BY CASE a.scope WHEN 'ROLL' THEN 0 WHEN 'ITEM_COLOR' THEN 1 ELSE 2 END, a.effective_from DESC LIMIT 1) x) AS rate
       FROM fabric_rolls r WHERE r.company_id=$1 AND r.item_id=$2 AND ($3::uuid IS NULL OR r.color_id=$3) AND r.status IN ('AVAILABLE','RESERVED') ORDER BY r.barcode LIMIT 500`,
    [companyId, opts.itemId, opts.colorId ?? null])).rows;
  const out = rows.map((r) => ({ rollId: String(r.id), barcode: String(r.barcode), meters: Number(r.meters), kg: r.kg == null ? null : Number(r.kg), officialPriced: Boolean(r.official), rate: (r.rate as { scope: string; cost: number; basis: 'METER' | 'KG'; currency: string } | null) }));
  return opts.onlyMissing ? out.filter((r) => !r.rate) : out;
}

/** سجل تعديلات التكلفة الإدارية (append-only) لخامة/لون/ثوب. */
export async function rateHistory(db: Db, companyId: string, p: { itemId?: string; rollId?: string }) {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT a.scope, a.unit_cost_per_meter::float AS cost, a.unit_basis AS basis, a.currency_code AS currency, a.effective_from::text AS since, COALESCE(u.full_name, u.username) AS by, a.note, fc.name_ar AS color, r.barcode
       FROM admin_cost_rates a LEFT JOIN users u ON u.id=a.set_by_user_id LEFT JOIN fabric_colors fc ON fc.id=a.color_id LEFT JOIN fabric_rolls r ON r.id=a.roll_id
      WHERE a.company_id=$1 AND (($2::uuid IS NOT NULL AND a.item_id=$2) OR ($3::uuid IS NOT NULL AND a.roll_id=$3)) ORDER BY a.effective_from DESC LIMIT 200`, [companyId, p.itemId ?? null, p.rollId ?? null])).rows;
  return rows.map((r) => ({ scope: String(r.scope), cost: Number(r.cost), basis: String(r.basis), currency: String(r.currency), since: String(r.since), by: (r.by as string | null) ?? null, note: (r.note as string | null) ?? null, color: (r.color as string | null) ?? null, barcode: (r.barcode as string | null) ?? null }));
}

/** التكلفة السارية لثوب/خامة/لون عند لحظة معيّنة: الثوب ثم الخامة+اللون ثم الخامة. */
export async function resolveRate(db: Db, companyId: string, p: { rollId?: string | null; itemId: string; colorId?: string | null; at?: string }) {
  const r = (await db.query<{ id: string; scope: 'ROLL' | 'ITEM_COLOR' | 'ITEM'; cost: string; basis: 'METER' | 'KG'; currency: string }>(
    `SELECT id, scope, unit_cost_per_meter::text AS cost, unit_basis AS basis, currency_code AS currency FROM admin_cost_rates
      WHERE company_id=$1 AND effective_from <= COALESCE($5::timestamptz, clock_timestamp())
        AND ((scope='ROLL' AND roll_id=$2) OR (scope='ITEM_COLOR' AND item_id=$3 AND color_id=$4) OR (scope='ITEM' AND item_id=$3))
      ORDER BY CASE scope WHEN 'ROLL' THEN 0 WHEN 'ITEM_COLOR' THEN 1 ELSE 2 END, effective_from DESC LIMIT 1`,
    [companyId, p.rollId ?? null, p.itemId, p.colorId ?? null, p.at ?? null])).rows[0];
  return r ? { id: r.id, scope: r.scope, unitCostPerMeter: Number(r.cost), basis: r.basis, currency: r.currency } : null;
}

/**
 * عند اعتماد البيع: تُحفظ لقطة التكلفة الإدارية السارية لكل سطر. سطر بلا تكلفة إدارية (أو لا يمكن تحويل وحدته) = بلا لقطة (غير مسعّر)،
 * ولا تُفترض تكلفة صفرية. تغيير التكلفة لاحقاً لا يمسّ اللقطة.
 * - تكلفة بالمتر: سطور المتر/الياردة. - تكلفة بالكيلو: سطور الكيلو مباشرة، وسطور المتر عبر وزن المتر الطولي = العرض × الوزن النوعي (gsm) للثوب (وإلا غير مسعّر؛ لا نستخدم وزن الثوب لأن طوله يتناقص مع البيع الجزئي).
 */
export async function snapshotAdminCostForInvoice(db: Db, companyId: string, invoiceId: string): Promise<number> {
  const lines = (await db.query<{ id: string; item_id: string | null; color_id: string | null; roll_id: string | null; quantity: string; unit: string; kg_per_m: string | null }>(
    `SELECT l.id, COALESCE(l.fabric_item_id, r.item_id) AS item_id, r.color_id, l.fabric_roll_id AS roll_id, l.quantity::text, l.unit,
            (r.width_cm / 100.0 * r.gsm / 1000.0)::text AS kg_per_m
       FROM sales_invoice_lines l LEFT JOIN fabric_rolls r ON r.id=l.fabric_roll_id
      WHERE l.company_id=$1 AND l.invoice_id=$2 AND l.unit IN ('meter','yard','kg')`, [companyId, invoiceId])).rows;
  let n = 0;
  for (const l of lines) {
    if (!l.item_id) continue;
    const rate = await resolveRate(db, companyId, { rollId: l.roll_id, itemId: l.item_id, colorId: l.color_id });
    if (!rate) continue;
    const qty = Number(l.quantity);
    const meters = l.unit === 'kg' ? 0 : quantityToMeters(qty, l.unit as 'meter' | 'yard');
    let basisQty: number;
    if (rate.basis === 'KG') {
      if (l.unit === 'kg') basisQty = qty;
      else if (l.kg_per_m && Number(l.kg_per_m) > 0 && meters > 0) basisQty = meters * Number(l.kg_per_m);
      else continue; // لا عرض/وزن نوعي للثوب: لا يمكن التحويل فلا نختلق تكلفة
    } else {
      if (l.unit === 'kg' || !(meters > 0)) continue; // تكلفة بالمتر لا تنطبق على بيع بالكيلو
      basisQty = meters;
    }
    await db.query(
      `INSERT INTO sales_line_admin_cost (company_id, sales_invoice_line_id, invoice_id, quantity_m, unit_cost_per_meter, unit_basis, basis_quantity, currency_code, total_cost, source, rate_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (sales_invoice_line_id) DO NOTHING`,
      [companyId, l.id, invoiceId, meters, rate.unitCostPerMeter, rate.basis, Math.round(basisQty * 1000) / 1000, rate.currency, Math.round(basisQty * rate.unitCostPerMeter * 100) / 100, rate.scope, rate.id]);
    n++;
  }
  return n;
}

export interface ProfitRow { currency: string; revenue: number; cost: number; profit: number; marginPct: number | null; pricedLines: number }
export type ProfitDimension = 'item' | 'color' | 'roll' | 'customer' | 'invoice' | 'creator';
export interface ProfitBreakdownRow { label: string; currency: string; revenue: number; cost: number; profit: number; marginPct: number | null; lines: number }
export interface Profitability {
  period: { from: string; to: string };
  /** صافي بعد المرتجعات المعتمدة المطابقة للقطة تكلفة. */
  byCurrency: ProfitRow[];
  /** أسطر بيع بلا تكلفة إدارية وقت البيع: لا تدخل في الربح ولا تُقدَّر بصفر؛ تُعرض مع نسبتها من إجمالي المبيعات. */
  unpriced: Array<{ currency: string; lines: number; revenue: number; totalRevenue: number; sharePct: number | null }>;
  /** أسطر تكلفتها بعملة تخالف عملة الفاتورة: مستبعدة لأننا لا نحوّل بين العملات. */
  currencyMismatch: number;
  returns: { counted: Array<{ currency: string; revenue: number; cost: number }>; excluded: number };
  /** مبيعات بسعر أقل من التكلفة الإدارية. */
  belowCost: Array<{ currency: string; lines: number; loss: number }>;
  by: ProfitDimension;
  breakdown: ProfitBreakdownRow[];
  byItem: Array<{ itemName: string; currency: string; revenue: number; cost: number; profit: number }>;
  notes: string[];
}
const DIM_EXPR: Record<ProfitDimension, { sel: string; join: string }> = {
  item: { sel: `COALESCE(fi.name, l.description, '—')`, join: 'LEFT JOIN fabric_items fi ON fi.id=l.fabric_item_id' },
  color: { sel: `COALESCE(fc.name_ar, fc.color_code, '—')`, join: 'LEFT JOIN fabric_rolls fr ON fr.id=l.fabric_roll_id LEFT JOIN fabric_colors fc ON fc.id=fr.color_id' },
  roll: { sel: `COALESCE(fr.barcode, '—')`, join: 'LEFT JOIN fabric_rolls fr ON fr.id=l.fabric_roll_id' },
  customer: { sel: `COALESCE(cu.name, '—')`, join: 'LEFT JOIN customers cu ON cu.id=si.customer_id' },
  invoice: { sel: 'si.invoice_no', join: '' },
  creator: { sel: `COALESCE(us.full_name, us.username, '—')`, join: 'LEFT JOIN users us ON us.id=si.created_by_user_id' },
};
export async function profitability(db: Db, companyId: string, from: string, to: string, by: ProfitDimension = 'item'): Promise<Profitability> {
  if (!DIM_EXPR[by]) throw fail('بُعد تحليل غير معروف');
  const base = `FROM sales_invoice_lines l JOIN sales_invoices si ON si.id=l.invoice_id AND si.company_id=l.company_id AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date
                JOIN sales_line_admin_cost c ON c.sales_invoice_line_id=l.id AND c.company_id=l.company_id`;
  const sold = (await db.query<{ currency: string; revenue: string; cost: string; n: string }>(
    `SELECT si.currency_code AS currency, sum(l.line_total)::text AS revenue, sum(c.total_cost)::text AS cost, count(*)::text AS n ${base} WHERE l.company_id=$1 AND c.currency_code = si.currency_code GROUP BY 1 ORDER BY 1`, [companyId, from, to])).rows;
  const mismatch = (await db.query<{ n: string }>(`SELECT count(*)::text AS n ${base} WHERE l.company_id=$1 AND c.currency_code <> si.currency_code`, [companyId, from, to])).rows[0];
  // المرتجعات المعتمدة: تُخصم من الإيراد وتُخصم تكلفتها من لقطة آخر بيع لنفس الثوب (نفس العملة والوحدة وبحدّ أقصى تكلفة السطر).
  const ret = (await db.query<{ currency: string; revenue: string; cost: string | null }>(
    `SELECT ri.currency_code AS currency, rl.line_total::text AS revenue,
            (SELECT LEAST(c2.total_cost, c2.total_cost * rl.quantity / NULLIF(l2.quantity, 0))::text FROM sales_invoice_lines l2 JOIN sales_invoices s2 ON s2.id=l2.invoice_id AND s2.company_id=l2.company_id AND s2.document_status='CONFIRMED'
               JOIN sales_line_admin_cost c2 ON c2.sales_invoice_line_id=l2.id AND c2.company_id=l2.company_id AND c2.currency_code=ri.currency_code
              WHERE l2.company_id=rl.company_id AND l2.fabric_roll_id=rl.fabric_roll_id AND l2.unit=rl.unit AND s2.invoice_date <= ri.return_date ORDER BY s2.invoice_date DESC, s2.created_at DESC LIMIT 1) AS cost
       FROM return_invoice_lines rl JOIN return_invoices ri ON ri.id=rl.return_invoice_id AND ri.company_id=rl.company_id
      WHERE rl.company_id=$1 AND ri.return_type='SALES_RETURN' AND ri.status='CONFIRMED' AND ri.return_date BETWEEN $2::date AND $3::date AND rl.fabric_roll_id IS NOT NULL`, [companyId, from, to])).rows;
  const retBy = new Map<string, { currency: string; revenue: number; cost: number }>();
  let retExcluded = 0;
  for (const r of ret) {
    if (r.cost == null) { retExcluded++; continue; }
    const e = retBy.get(r.currency) ?? { currency: r.currency, revenue: 0, cost: 0 };
    e.revenue += Number(r.revenue); e.cost += Number(r.cost); retBy.set(r.currency, e);
  }
  const unpricedRows = (await db.query<{ currency: string; lines: string; revenue: string }>(
    `SELECT si.currency_code AS currency, count(*)::text AS lines, COALESCE(sum(l.line_total),0)::text AS revenue FROM sales_invoice_lines l JOIN sales_invoices si ON si.id=l.invoice_id AND si.company_id=l.company_id
      WHERE l.company_id=$1 AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date AND l.unit IN ('meter','yard','kg')
        AND NOT EXISTS (SELECT 1 FROM sales_line_admin_cost c WHERE c.sales_invoice_line_id=l.id) GROUP BY 1 ORDER BY 1`, [companyId, from, to])).rows;
  const totals = (await db.query<{ currency: string; revenue: string }>(
    `SELECT si.currency_code AS currency, COALESCE(sum(l.line_total),0)::text AS revenue FROM sales_invoice_lines l JOIN sales_invoices si ON si.id=l.invoice_id AND si.company_id=l.company_id
      WHERE l.company_id=$1 AND si.document_status='CONFIRMED' AND si.invoice_date BETWEEN $2::date AND $3::date GROUP BY 1`, [companyId, from, to])).rows;
  const d = DIM_EXPR[by];
  const dim = (await db.query<{ label: string; currency: string; revenue: string; cost: string; n: string }>(
    `SELECT ${d.sel} AS label, si.currency_code AS currency, sum(l.line_total)::text AS revenue, sum(c.total_cost)::text AS cost, count(*)::text AS n ${base} ${d.join}
      WHERE l.company_id=$1 AND c.currency_code = si.currency_code GROUP BY 1, 2 ORDER BY sum(l.line_total) - sum(c.total_cost) DESC LIMIT 50`, [companyId, from, to])).rows;
  const below = (await db.query<{ currency: string; n: string; loss: string }>(
    `SELECT si.currency_code AS currency, count(*)::text AS n, sum(c.total_cost - l.line_total)::text AS loss ${base} WHERE l.company_id=$1 AND c.currency_code = si.currency_code AND l.line_total < c.total_cost GROUP BY 1 ORDER BY 1`, [companyId, from, to])).rows;

  const pct = (p: number, r: number) => (r > 0 ? Math.round((p / r) * 1000) / 10 : null);
  const currencies = new Set([...sold.map((r) => r.currency), ...retBy.keys()]);
  const byCurrency = [...currencies].sort().map((cur) => {
    const sd = sold.find((r) => r.currency === cur); const rt = retBy.get(cur);
    const rev = Number(sd?.revenue ?? 0) - (rt?.revenue ?? 0), cost = Number(sd?.cost ?? 0) - (rt?.cost ?? 0);
    return { currency: cur, revenue: rev, cost, profit: rev - cost, marginPct: pct(rev - cost, rev), pricedLines: Number(sd?.n ?? 0) };
  });
  const rows: ProfitBreakdownRow[] = dim.map((r) => { const rev = Number(r.revenue), cost = Number(r.cost); return { label: r.label, currency: r.currency, revenue: rev, cost, profit: rev - cost, marginPct: pct(rev - cost, rev), lines: Number(r.n) }; });
  return {
    period: { from, to }, byCurrency,
    unpriced: unpricedRows.map((r) => { const t = Number(totals.find((x) => x.currency === r.currency)?.revenue ?? 0); return { currency: r.currency, lines: Number(r.lines), revenue: Number(r.revenue), totalRevenue: t, sharePct: pct(Number(r.revenue), t) }; }),
    currencyMismatch: Number(mismatch.n),
    returns: { counted: [...retBy.values()], excluded: retExcluded },
    belowCost: below.map((r) => ({ currency: r.currency, lines: Number(r.n), loss: Number(r.loss) })),
    by, breakdown: rows,
    byItem: by === 'item' ? rows.map((r) => ({ itemName: r.label, currency: r.currency, revenue: r.revenue, cost: r.cost, profit: r.profit })) : [],
    notes: [
      'ربحية إدارية تقديرية وليست صافي الربح المحاسبي للشركة.',
      'الربح التقديري = صافي سعر البيع (بعد خصم السطر) − التكلفة الإدارية المحفوظة وقت اعتماد البيع؛ المرتجعات المعتمدة تُخصم بإيرادها وبتكلفتها من لقطة البيع الأصلية للثوب نفسه.',
      'المبيعات قبل تفعيل هذه الميزة، وأي سطر بلا تكلفة إدارية وقت بيعه، لا يدخل في الربح (لا تكلفة صفرية) وتُعرض قيمته ونسبته من المبيعات.',
      'الفواتير الملغاة (غير المعتمدة) مستبعدة تلقائياً. لا تحويل بين العملات؛ ولا تأثير على المحاسبة ولا الذمم ولا تقييم المخزون الرسمي.',
    ],
  };
}
