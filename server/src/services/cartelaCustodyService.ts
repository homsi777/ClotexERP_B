import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lookupCartelaColorByScan, normalizeCartelaScanInput } from './cartelaColorService.js';
import { computeCustody, diffDays, resolveDueDate, type CustodyStatus } from './cartelaCustodyMath.js';

/**
 * عهدة الكارتيلات (TASK 023): تسليم/إرجاع نسخ الكارتيلات للعملاء بالباركود.
 * الحركات هنا في جداول cartela_custody_* فقط — لا فواتير ولا قيود ولا حركات مخزون ولا رصيد عميل.
 * كل عملية كتابة تعمل داخل معاملة يملكها المستدعي (فشل أي سطر يعيدها كاملة).
 */

type Db = Pick<PoolClient, 'query'>;

export class CustodyError extends Error {
  constructor(message: string, public code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT') {
    super(message);
  }
}

export const todayYmd = () => new Date().toISOString().slice(0, 10);

export type ResolvedCopy = {
  copyId: string | null;
  barcode: string;
  cartelaId: string;
  cartelaTitle: string;
  artCode: string;
  serialNo: string;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  /** موجودة سلفاً كنسخة (وليست باركود موديل/لون يُسجَّل كنسخة عند الحفظ). */
  isRegisteredCopy: boolean;
  /** نسخة مفتوحة بعهدة عميل الآن. */
  heldBy: { customerId: string; customerName: string; voucherNo: string } | null;
};

const COPY_SELECT = `
  SELECT cp.id AS copy_id, cp.barcode, cl.id AS cartela_id, cl.title, cl.art_code, cl.serial_no,
         col.id AS color_id, col.color_code, col.name_ar AS color_name
    FROM cartela_copies cp
    JOIN cartela_labels cl ON cl.id = cp.cartela_label_id AND cl.company_id = cp.company_id
    LEFT JOIN cartela_label_colors col ON col.id = cp.color_id`;

async function heldByForCopy(db: Db, companyId: string, copyId: string) {
  const r = await db.query(
    `SELECT l.customer_id, c.name AS customer_name, v.voucher_no
       FROM cartela_custody_lines l
       JOIN cartela_custody_vouchers v ON v.id = l.voucher_id
       JOIN customers c ON c.id = l.customer_id
      WHERE l.company_id = $1 AND l.copy_id = $2 AND l.returned_on IS NULL`,
    [companyId, copyId],
  );
  const row = r.rows[0];
  return row ? { customerId: row.customer_id as string, customerName: row.customer_name as string, voucherNo: row.voucher_no as string } : null;
}

/**
 * يحلّ باركوداً ممسوحاً إلى نسخة: نسخة مسجّلة، أو باركود كارتيلة/لون لم تُسجَّل به نسخة بعد
 * (يُستخدم مباشرة كباركود النسخة). create=true يُنشئ سجل النسخة (داخل معاملة الحفظ)؛ false = معاينة فقط.
 */
export async function resolveScan(
  db: Db,
  companyId: string,
  userId: string | null,
  rawScan: string,
  create: boolean,
): Promise<ResolvedCopy> {
  const scan = normalizeCartelaScanInput(rawScan);
  if (!scan) throw new CustodyError('أدخل باركود الكارتيلة', 'VALIDATION');

  const existing = await db.query(`${COPY_SELECT} WHERE cp.company_id = $1 AND upper(cp.barcode) = $2 LIMIT 1`, [companyId, scan]);
  if (existing.rows.length) {
    const r = existing.rows[0];
    return {
      copyId: r.copy_id, barcode: r.barcode, cartelaId: r.cartela_id, cartelaTitle: r.title, artCode: r.art_code, serialNo: r.serial_no,
      colorId: r.color_id, colorCode: r.color_code, colorName: r.color_name, isRegisteredCopy: true,
      heldBy: await heldByForCopy(db, companyId, r.copy_id),
    };
  }

  let cartela: Record<string, any> | null = null;
  let color: Record<string, any> | null = null;
  const direct = await db.query(`SELECT * FROM cartela_labels WHERE company_id = $1 AND upper(barcode_code) = $2 LIMIT 1`, [companyId, scan]);
  if (direct.rows.length) {
    cartela = direct.rows[0];
  } else {
    const hit = await lookupCartelaColorByScan(db as any, companyId, scan);
    if (hit) {
      cartela = hit.cartela;
      color = hit.color;
    }
  }
  if (!cartela) throw new CustodyError(`لا كارتيلة بهذا الباركود: ${rawScan}`, 'NOT_FOUND');

  const barcode = String(color ? color.barcode_code : cartela.barcode_code);
  let copyId: string | null = null;
  if (create) {
    const ins = await db.query(
      `INSERT INTO cartela_copies (company_id, cartela_label_id, color_id, barcode, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, cartela.id, color ? color.id : null, barcode, userId],
    );
    copyId = ins.rows[0].id;
  }
  return {
    copyId, barcode, cartelaId: cartela.id, cartelaTitle: cartela.title, artCode: cartela.art_code, serialNo: cartela.serial_no,
    colorId: color ? color.id : null, colorCode: color ? color.color_code : null, colorName: color ? color.name_ar : null,
    isRegisteredCopy: false, heldBy: null,
  };
}

// ─────────────────────────── سند التسليم ───────────────────────────

export const deliverySchema = z.object({
  customerId: z.string().uuid(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional().nullable(),
  lines: z.array(z.object({
    barcode: z.string().min(1),
    days: z.coerce.number().int().positive().optional().nullable(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  })).min(1, 'أضف كارتيلة واحدة على الأقل').max(500),
});

async function nextNumber(db: Db, companyId: string, kind: string, table: string, column: string, prefix: string, width: number): Promise<string> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:${kind}`]);
  const r = await db.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(${column}, '\\D', '', 'g'), '')::bigint), 0) + 1 AS n FROM ${table} WHERE company_id = $1`,
    [companyId],
  );
  return `${prefix}${String(r.rows[0].n).padStart(width, '0')}`;
}

export async function createDeliveryVoucher(db: Db, companyId: string, userId: string | null, raw: unknown, today = todayYmd()) {
  const parsed = deliverySchema.safeParse(raw);
  if (!parsed.success) throw new CustodyError(parsed.error.issues[0]?.message ?? 'بيانات السند غير صالحة', 'VALIDATION');
  const d = parsed.data;
  const deliveryDate = d.deliveryDate ?? today;

  const cust = await db.query(`SELECT id, name FROM customers WHERE id = $1 AND company_id = $2`, [d.customerId, companyId]);
  if (!cust.rows.length) throw new CustodyError('العميل غير موجود', 'NOT_FOUND');

  // نفس النسخة مرتين بالسند (بأي صيغة مسح) ⇒ رفض قبل أي كتابة.
  const seen = new Set<string>();
  for (const ln of d.lines) {
    const k = normalizeCartelaScanInput(ln.barcode);
    if (seen.has(k)) throw new CustodyError(`الباركود مكرر في السند: ${ln.barcode}`, 'CONFLICT');
    seen.add(k);
  }

  const voucherNo = await nextNumber(db, companyId, 'cartela_voucher', 'cartela_custody_vouchers', 'voucher_no', 'CV', 6);
  const v = await db.query(
    `INSERT INTO cartela_custody_vouchers (company_id, voucher_no, customer_id, delivery_date, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [companyId, voucherNo, d.customerId, deliveryDate, d.notes ?? null, userId],
  );
  const voucherId = v.rows[0].id as string;

  const out: { lineId: string; barcode: string; dueDate: string | null }[] = [];
  for (const ln of d.lines) {
    let due: string | null;
    try {
      due = resolveDueDate(deliveryDate, { days: ln.days ?? null, dueDate: ln.dueDate ?? null });
    } catch (e) {
      throw new CustodyError(`${ln.barcode}: ${(e as Error).message}`, 'VALIDATION');
    }
    const copy = await resolveScan(db, companyId, userId, ln.barcode, true);
    const copyId = copy.copyId as string;
    // قفل صف النسخة ثم فحص العهدة المفتوحة (الفهرس الفريد شبكة أمان للتزامن).
    await db.query(`SELECT id FROM cartela_copies WHERE id = $1 FOR UPDATE`, [copyId]);
    const held = await heldByForCopy(db, companyId, copyId);
    if (held) throw new CustodyError(`النسخة ${copy.barcode} بعهدة العميل ${held.customerName} (سند ${held.voucherNo}) ولم تُرجَع`, 'CONFLICT');
    const l = await db.query(
      `INSERT INTO cartela_custody_lines (company_id, voucher_id, customer_id, copy_id, due_date)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, voucherId, d.customerId, copyId, due],
    );
    out.push({ lineId: l.rows[0].id, barcode: copy.barcode, dueDate: due });
  }
  return { voucherId, voucherNo, customerId: d.customerId, customerName: cust.rows[0].name as string, deliveryDate, lines: out };
}

// ─────────────────────────── الإرجاع والتمديد ───────────────────────────

export const returnSchema = z.object({
  customerId: z.string().uuid(),
  barcodes: z.array(z.string().min(1)).min(1, 'امسح باركود نسخة واحدة على الأقل').max(500),
  returnedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** إرجاع نسخة أو أكثر لعميل محدد (كلي/جزئي/دفعات). ذرّي: أي نسخة مرفوضة تُفشل العملية كلها. */
export async function returnCopies(db: Db, companyId: string, userId: string | null, raw: unknown, today = todayYmd()) {
  const parsed = returnSchema.safeParse(raw);
  if (!parsed.success) throw new CustodyError(parsed.error.issues[0]?.message ?? 'بيانات الإرجاع غير صالحة', 'VALIDATION');
  const d = parsed.data;
  const returnedOn = d.returnedOn ?? today;
  const seen = new Set<string>();
  const returned: { barcode: string; lineId: string; voucherNo: string }[] = [];
  for (const b of d.barcodes) {
    const scan = normalizeCartelaScanInput(b);
    if (seen.has(scan)) continue; // مسح مكرر لنفس النسخة بالدفعة = مرة واحدة
    seen.add(scan);
    const cp = await db.query(`SELECT id, barcode FROM cartela_copies WHERE company_id = $1 AND upper(barcode) = $2`, [companyId, scan]);
    if (!cp.rows.length) throw new CustodyError(`لا نسخة مسجّلة بهذا الباركود: ${b}`, 'NOT_FOUND');
    const copyId = cp.rows[0].id as string;
    const line = await db.query(
      `SELECT l.id, l.customer_id, v.voucher_no, v.delivery_date::text AS delivered_on, c.name AS customer_name
         FROM cartela_custody_lines l
         JOIN cartela_custody_vouchers v ON v.id = l.voucher_id
         JOIN customers c ON c.id = l.customer_id
        WHERE l.company_id = $1 AND l.copy_id = $2 AND l.returned_on IS NULL
        FOR UPDATE OF l`,
      [companyId, copyId],
    );
    if (!line.rows.length) throw new CustodyError(`النسخة ${cp.rows[0].barcode} غير بعهدة أي عميل (أُرجعت مسبقاً)`, 'CONFLICT');
    const l = line.rows[0];
    if (l.customer_id !== d.customerId) throw new CustodyError(`النسخة ${cp.rows[0].barcode} بعهدة عميل آخر (${l.customer_name}) — لا يمكن إرجاعها على هذا الحساب`, 'CONFLICT');
    if (diffDays(l.delivered_on, returnedOn) < 0) throw new CustodyError(`تاريخ الإرجاع قبل تاريخ التسليم للنسخة ${cp.rows[0].barcode}`, 'VALIDATION');
    await db.query(`UPDATE cartela_custody_lines SET returned_on = $2, returned_by_user_id = $3 WHERE id = $1`, [l.id, returnedOn, userId]);
    returned.push({ barcode: cp.rows[0].barcode, lineId: l.id, voucherNo: l.voucher_no });
  }
  return { returnedOn, returned };
}

export const extendSchema = z.object({
  lineId: z.string().uuid(),
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(300).optional().nullable(),
});

export async function extendDueDate(db: Db, companyId: string, userId: string | null, raw: unknown) {
  const parsed = extendSchema.safeParse(raw);
  if (!parsed.success) throw new CustodyError('بيانات التمديد غير صالحة', 'VALIDATION');
  const d = parsed.data;
  const r = await db.query(
    `SELECT l.id, l.due_date::text AS due_date, l.returned_on, v.delivery_date::text AS delivered_on
       FROM cartela_custody_lines l JOIN cartela_custody_vouchers v ON v.id = l.voucher_id
      WHERE l.id = $1 AND l.company_id = $2 FOR UPDATE OF l`,
    [d.lineId, companyId],
  );
  if (!r.rows.length) throw new CustodyError('السطر غير موجود', 'NOT_FOUND');
  const l = r.rows[0];
  if (l.returned_on) throw new CustodyError('النسخة مُرجعة — لا تمديد', 'CONFLICT');
  if (diffDays(l.delivered_on, d.newDueDate) < 0) throw new CustodyError('الموعد الجديد قبل تاريخ التسليم', 'VALIDATION');
  if (l.due_date === d.newDueDate) throw new CustodyError('الموعد الجديد مطابق للحالي', 'VALIDATION');
  await db.query(
    `INSERT INTO cartela_custody_due_changes (company_id, line_id, old_due_date, new_due_date, reason, changed_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [companyId, l.id, l.due_date, d.newDueDate, d.reason ?? null, userId],
  );
  await db.query(`UPDATE cartela_custody_lines SET due_date = $2 WHERE id = $1`, [l.id, d.newDueDate]);
  return { lineId: l.id, oldDueDate: l.due_date as string | null, newDueDate: d.newDueDate };
}

// ─────────────────────────── الكشوف والمتابعة ───────────────────────────

export type CustodyRow = {
  lineId: string;
  voucherId: string;
  voucherNo: string;
  customerId: string;
  customerName: string;
  barcode: string;
  cartelaTitle: string;
  artCode: string;
  colorCode: string | null;
  colorName: string | null;
  deliveredOn: string;
  dueDate: string | null;
  returnedOn: string | null;
  status: CustodyStatus;
  daysHeld: number;
  daysLate: number;
  dueUndefined: boolean;
};

export type CustodyFilter = {
  customerId?: string;
  search?: string;
  from?: string;
  to?: string;
  status?: CustodyStatus | 'OPEN' | 'ALL';
  limit?: number;
  today?: string;
};

export async function listCustody(db: Db, companyId: string, f: CustodyFilter = {}) {
  const today = f.today ?? todayYmd();
  const params: unknown[] = [companyId];
  let where = 'l.company_id = $1';
  if (f.customerId) { params.push(f.customerId); where += ` AND l.customer_id = $${params.length}`; }
  if (f.from) { params.push(f.from); where += ` AND v.delivery_date >= $${params.length}::date`; }
  if (f.to) { params.push(f.to); where += ` AND v.delivery_date <= $${params.length}::date`; }
  if (f.search?.trim()) {
    params.push(`%${f.search.trim()}%`);
    const p = `$${params.length}`;
    where += ` AND (c.name ILIKE ${p} OR cp.barcode ILIKE ${p} OR v.voucher_no ILIKE ${p})`;
  }
  const limit = Math.min(Math.max(Number(f.limit) || 500, 1), 2000);
  const res = await db.query(
    `SELECT l.id, l.voucher_id, v.voucher_no, l.customer_id, c.name AS customer_name, cp.barcode,
            cl.title, cl.art_code, col.color_code, col.name_ar AS color_name,
            v.delivery_date::text AS delivered_on, l.due_date::text AS due_date, l.returned_on::text AS returned_on
       FROM cartela_custody_lines l
       JOIN cartela_custody_vouchers v ON v.id = l.voucher_id
       JOIN customers c ON c.id = l.customer_id
       JOIN cartela_copies cp ON cp.id = l.copy_id
       JOIN cartela_labels cl ON cl.id = cp.cartela_label_id
       LEFT JOIN cartela_label_colors col ON col.id = cp.color_id
      WHERE ${where}
      ORDER BY v.delivery_date DESC, v.created_at DESC, cp.barcode
      LIMIT ${limit}`,
    params,
  );
  let rows: CustodyRow[] = res.rows.map((r) => {
    const c = computeCustody({ deliveredOn: r.delivered_on, dueDate: r.due_date, returnedOn: r.returned_on }, today);
    return {
      lineId: r.id, voucherId: r.voucher_id, voucherNo: r.voucher_no, customerId: r.customer_id, customerName: r.customer_name,
      barcode: r.barcode, cartelaTitle: r.title, artCode: r.art_code, colorCode: r.color_code, colorName: r.color_name,
      deliveredOn: r.delivered_on, dueDate: r.due_date, returnedOn: r.returned_on, ...c,
    };
  });
  const st = f.status ?? 'ALL';
  if (st === 'OPEN') rows = rows.filter((r) => r.status !== 'RETURNED');
  else if (st !== 'ALL') rows = rows.filter((r) => r.status === st);
  return rows;
}

/** رأس الكشف: العهدة الحالية للعميل (بلا فلتر فترة/حالة) — عددها ومنها المتأخرة. */
export async function custodySummary(db: Db, companyId: string, customerId: string, today = todayYmd()) {
  const open = await listCustody(db, companyId, { customerId, status: 'OPEN', today, limit: 2000 });
  return { heldNow: open.length, late: open.filter((r) => r.status === 'LATE').length, noDue: open.filter((r) => r.dueUndefined).length };
}

export async function listDueChanges(db: Db, companyId: string, lineId: string) {
  const r = await db.query(
    `SELECT old_due_date::text AS old_due_date, new_due_date::text AS new_due_date, reason, changed_at
       FROM cartela_custody_due_changes WHERE company_id = $1 AND line_id = $2 ORDER BY changed_at`,
    [companyId, lineId],
  );
  return r.rows;
}

// ─────────────────────────── توليد نسخ بباركود مستقل ───────────────────────────

export const generateCopiesSchema = z.object({
  cartelaId: z.string().uuid(),
  colorId: z.string().uuid().optional().nullable(),
  count: z.coerce.number().int().min(1).max(200),
});

/** ينشئ نسخاً بباركود مستقل لكل نسخة (لتمييز نسختين من نفس الموديل/اللون بين عميلين). */
export async function generateCopies(db: Db, companyId: string, userId: string | null, raw: unknown) {
  const parsed = generateCopiesSchema.safeParse(raw);
  if (!parsed.success) throw new CustodyError('بيانات التوليد غير صالحة (العدد 1–200)', 'VALIDATION');
  const d = parsed.data;
  const cl = await db.query(`SELECT id FROM cartela_labels WHERE id = $1 AND company_id = $2`, [d.cartelaId, companyId]);
  if (!cl.rows.length) throw new CustodyError('الكارتيلة غير موجودة', 'NOT_FOUND');
  if (d.colorId) {
    const col = await db.query(`SELECT id FROM cartela_label_colors WHERE id = $1 AND company_id = $2 AND cartela_label_id = $3`, [d.colorId, companyId, d.cartelaId]);
    if (!col.rows.length) throw new CustodyError('اللون لا يتبع هذه الكارتيلة', 'VALIDATION');
  }
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:cartela_copy_barcode`]);
  const mx = await db.query(
    `SELECT COALESCE(MAX(substr(barcode, 3)::bigint), 0) AS n FROM cartela_copies WHERE company_id = $1 AND barcode ~ '^KC[0-9]+$'`,
    [companyId],
  );
  let n = Number(mx.rows[0].n);
  const barcodes: string[] = [];
  for (let i = 0; i < d.count; i++) {
    n += 1;
    const barcode = `KC${String(n).padStart(7, '0')}`;
    await db.query(
      `INSERT INTO cartela_copies (company_id, cartela_label_id, color_id, barcode, created_by_user_id) VALUES ($1,$2,$3,$4,$5)`,
      [companyId, d.cartelaId, d.colorId ?? null, barcode, userId],
    );
    barcodes.push(barcode);
  }
  return { barcodes };
}
