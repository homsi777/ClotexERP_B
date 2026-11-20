import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lookupCartelaColorByScan, normalizeCartelaScanInput } from './cartelaColorService.js';
import { computeCustody, diffDays, resolveDueDate, type CustodyStatus } from './cartelaCustodyMath.js';
import { todayYmd as businessTodayYmd } from '../utils/businessDate.js';

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

export const todayYmd = () => businessTodayYmd();

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
  /** وضع العدد: للكارتيلة عدد مخزون مُدخَل، والتسليم يخصم وحدة من المتاح (بلا نسخة بعينها). */
  poolMode: boolean;
  /** مستوى المخزون المنطبق (لون محدد أو الكارتيلة كلها = null) في وضع العدد. */
  levelColorId: string | null;
  stock: { quantity: number; held: number; available: number } | null;
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

type StockLevel = { quantity: number; colorId: string | null };

/** مستوى المخزون المنطبق على (كارتيلة، لون): مستوى اللون إن وُجد وإلا مستوى الكارتيلة كلها. */
async function stockLevelFor(db: Db, companyId: string, cartelaId: string, colorId: string | null): Promise<StockLevel | null> {
  if (colorId) {
    const c = await db.query(
      `SELECT quantity FROM cartela_stock_levels WHERE company_id = $1 AND cartela_label_id = $2 AND color_id = $3`,
      [companyId, cartelaId, colorId],
    );
    if (c.rows.length) return { quantity: Number(c.rows[0].quantity), colorId };
  }
  const w = await db.query(
    `SELECT quantity FROM cartela_stock_levels WHERE company_id = $1 AND cartela_label_id = $2 AND color_id IS NULL`,
    [companyId, cartelaId],
  );
  return w.rows.length ? { quantity: Number(w.rows[0].quantity), colorId: null } : null;
}

async function heldCountForLevel(db: Db, companyId: string, cartelaId: string, levelColorId: string | null): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int AS n
       FROM cartela_custody_lines l JOIN cartela_copies cp ON cp.id = l.copy_id
      WHERE l.company_id = $1 AND l.returned_on IS NULL AND cp.cartela_label_id = $2
        AND cp.color_id IS NOT DISTINCT FROM $3::uuid`,
    [companyId, cartelaId, levelColorId],
  );
  return Number(r.rows[0].n);
}

/** بحث بالرقم التسلسلي / كود الخامة / رمز CLOTEX| — نفس منطق شاشة الأوردر (/api/cartela/lookup). */
async function findCartelaBySerial(db: Db, companyId: string, scan: string): Promise<Record<string, any> | null> {
  let serial = scan;
  let artCode = '';
  let designNo = '';
  if (/^CLOTEX\|/i.test(scan)) {
    const p = scan.split('|').map((x) => x.trim());
    artCode = p[1] ?? '';
    designNo = p[2] ?? '';
    serial = p[3] ?? '';
  }
  const numeric = /^\d{1,18}$/.test(serial) ? serial : null;
  const r = await db.query(
    `SELECT * FROM cartela_labels
      WHERE company_id = $1
        AND (
          ($2 <> '' AND upper(trim(serial_no)) = $2)
          OR ($3 <> '' AND $4 <> '' AND art_code ILIKE $3 AND design_no ILIKE $4)
          OR upper(trim(art_code)) = $5
          OR (CASE WHEN trim(serial_no) ~ '^[0-9]{1,18}$' THEN trim(serial_no)::bigint END) = $6::bigint
        )
      ORDER BY CASE WHEN $2 <> '' AND upper(trim(serial_no)) = $2 THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [companyId, serial, artCode, designNo, scan, numeric],
  );
  return r.rows[0] ?? null;
}

async function poolResolved(
  db: Db, companyId: string, level: StockLevel,
  info: Omit<ResolvedCopy, 'copyId' | 'isRegisteredCopy' | 'heldBy' | 'poolMode' | 'levelColorId' | 'stock'>,
): Promise<ResolvedCopy> {
  const held = await heldCountForLevel(db, companyId, info.cartelaId, level.colorId);
  return {
    ...info, copyId: null, isRegisteredCopy: false, heldBy: null, poolMode: true, levelColorId: level.colorId,
    stock: { quantity: level.quantity, held, available: Math.max(level.quantity - held, 0) },
  };
}

/**
 * يحلّ باركوداً ممسوحاً. ثلاث حالات:
 *  1) نسخة مولَّدة (KC…) = وحدة بعينها دائماً.
 *  2) كارتيلة/لون لها عدد مخزون مُدخَل (وضع العدد): التسليم يخصم وحدة من المتاح بلا ربط بنسخة معينة.
 *  3) كارتيلة بلا عدد: السلوك السابق (نسخة واحدة بباركود الموديل/اللون، تُسجَّل عند الحفظ).
 * يُعرَّف الباركود بباركود الكارتيلة/اللون أو بالرقم التسلسلي أو كود الخامة.
 * create=true يُنشئ سجل النسخة في الحالة 3 (داخل معاملة الحفظ)؛ false = معاينة فقط.
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
    const info = {
      barcode: r.barcode as string, cartelaId: r.cartela_id as string, cartelaTitle: r.title as string, artCode: r.art_code as string,
      serialNo: r.serial_no as string, colorId: (r.color_id as string | null) ?? null, colorCode: (r.color_code as string | null) ?? null,
      colorName: (r.color_name as string | null) ?? null,
    };
    if (!/^KC\d+$/i.test(String(r.barcode))) {
      const level = await stockLevelFor(db, companyId, info.cartelaId, info.colorId);
      if (level) return poolResolved(db, companyId, level, info);
    }
    return {
      copyId: r.copy_id, ...info, isRegisteredCopy: true, heldBy: await heldByForCopy(db, companyId, r.copy_id),
      poolMode: false, levelColorId: null, stock: null,
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
    } else {
      cartela = await findCartelaBySerial(db, companyId, scan);
    }
  }
  if (!cartela) throw new CustodyError(`لا كارتيلة بهذا الباركود: ${rawScan}`, 'NOT_FOUND');

  const barcode = String((color ? color.barcode_code : cartela.barcode_code) || '');
  const info = {
    barcode: barcode || scan, cartelaId: cartela.id as string, cartelaTitle: cartela.title as string, artCode: cartela.art_code as string,
    serialNo: cartela.serial_no as string, colorId: color ? (color.id as string) : null, colorCode: color ? (color.color_code as string) : null,
    colorName: color ? (color.name_ar as string) : null,
  };
  const level = await stockLevelFor(db, companyId, info.cartelaId, info.colorId);
  if (level) return poolResolved(db, companyId, level, info);

  if (!barcode) {
    throw new CustodyError(`الكارتيلة ${info.cartelaTitle} بلا باركود محفوظ؛ أدخل عدد مخزونها من شاشة «مخزون الكارتيلات» ليمكن تسليمها`, 'VALIDATION');
  }
  let copyId: string | null = null;
  if (create) {
    const ins = await db.query(
      `INSERT INTO cartela_copies (company_id, cartela_label_id, color_id, barcode, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, cartela.id, color ? color.id : null, barcode, userId],
    );
    copyId = ins.rows[0].id;
  }
  return { copyId, ...info, barcode, isRegisteredCopy: false, heldBy: null, poolMode: false, levelColorId: null, stock: null };
}

/** يختار نسخة حرة للمستوى (أو يولّدها) بعد التحقق من المتاح — داخل قفل المستوى لمنع التجاوز المتزامن. */
async function allocatePoolCopy(
  db: Db, companyId: string, userId: string | null, cartelaId: string, levelColorId: string | null, title: string,
): Promise<{ copyId: string; barcode: string }> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:cartela_stock:${cartelaId}:${levelColorId ?? '-'}`]);
  const lv = await db.query(
    `SELECT quantity FROM cartela_stock_levels WHERE company_id = $1 AND cartela_label_id = $2 AND color_id IS NOT DISTINCT FROM $3::uuid`,
    [companyId, cartelaId, levelColorId],
  );
  if (!lv.rows.length) throw new CustodyError(`لا عدد مخزون محدد للكارتيلة ${title}`, 'CONFLICT');
  const quantity = Number(lv.rows[0].quantity);
  const held = await heldCountForLevel(db, companyId, cartelaId, levelColorId);
  if (held >= quantity) {
    throw new CustodyError(`نفد مخزون الكارتيلة ${title}: العدد ${quantity} وكله بعهدة العملاء (${held}) — لا نسخة متاحة للتسليم`, 'CONFLICT');
  }
  const free = await db.query(
    `SELECT cp.id, cp.barcode FROM cartela_copies cp
      WHERE cp.company_id = $1 AND cp.cartela_label_id = $2 AND cp.color_id IS NOT DISTINCT FROM $3::uuid
        AND NOT EXISTS (SELECT 1 FROM cartela_custody_lines l WHERE l.copy_id = cp.id AND l.returned_on IS NULL)
      ORDER BY cp.created_at LIMIT 1 FOR UPDATE OF cp`,
    [companyId, cartelaId, levelColorId],
  );
  if (free.rows.length) return { copyId: free.rows[0].id as string, barcode: free.rows[0].barcode as string };
  const gen = await insertGeneratedCopies(db, companyId, userId, cartelaId, levelColorId, 1);
  return { copyId: gen[0].id, barcode: gen[0].barcode };
}

// ─────────────────────────── سند التسليم ───────────────────────────

export const deliverySchema = z.object({
  customerId: z.string().uuid(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional().nullable(),
  lines: z.array(z.object({
    barcode: z.string().min(1),
    /** عدد النسخ لكارتيلة بوضع العدد (يُخصم من المتاح). */
    quantity: z.coerce.number().int().min(1).max(200).optional().default(1),
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

  // حلّ الأسطر أولاً بلا كتابة: وضع العدد أو نسخة بعينها (التكرار يُرفض لنسخة بعينها فقط).
  const resolved: { ln: (typeof d.lines)[number]; copy: ResolvedCopy }[] = [];
  const seenUnit = new Set<string>();
  for (const ln of d.lines) {
    const copy = await resolveScan(db, companyId, userId, ln.barcode, false);
    if (!copy.poolMode) {
      const k = normalizeCartelaScanInput(ln.barcode);
      if (seenUnit.has(k)) throw new CustodyError(`الباركود مكرر في السند: ${ln.barcode}`, 'CONFLICT');
      seenUnit.add(k);
      if ((ln.quantity ?? 1) > 1) {
        throw new CustodyError(`الكارتيلة ${copy.cartelaTitle} بلا عدد مخزون محدد؛ لا يمكن تسليم أكثر من نسخة بهذا الباركود — أدخل عددها من «مخزون الكارتيلات»`, 'VALIDATION');
      }
    }
    resolved.push({ ln, copy });
  }

  const voucherNo = await nextNumber(db, companyId, 'cartela_voucher', 'cartela_custody_vouchers', 'voucher_no', 'CV', 6);
  const v = await db.query(
    `INSERT INTO cartela_custody_vouchers (company_id, voucher_no, customer_id, delivery_date, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [companyId, voucherNo, d.customerId, deliveryDate, d.notes ?? null, userId],
  );
  const voucherId = v.rows[0].id as string;

  const out: { lineId: string; barcode: string; dueDate: string | null; scanned: string }[] = [];
  for (const { ln, copy: scanned } of resolved) {
    let due: string | null;
    try {
      due = resolveDueDate(deliveryDate, { days: ln.days ?? null, dueDate: ln.dueDate ?? null });
    } catch (e) {
      throw new CustodyError(`${ln.barcode}: ${(e as Error).message}`, 'VALIDATION');
    }
    if (scanned.poolMode) {
      for (let i = 0; i < (ln.quantity ?? 1); i++) {
        const picked = await allocatePoolCopy(db, companyId, userId, scanned.cartelaId, scanned.levelColorId, scanned.cartelaTitle);
        const l = await db.query(
          `INSERT INTO cartela_custody_lines (company_id, voucher_id, customer_id, copy_id, due_date)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [companyId, voucherId, d.customerId, picked.copyId, due],
        );
        out.push({ lineId: l.rows[0].id, barcode: picked.barcode, dueDate: due, scanned: ln.barcode });
      }
      continue;
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
    out.push({ lineId: l.rows[0].id, barcode: copy.barcode, dueDate: due, scanned: ln.barcode });
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
    // وضع العدد: كل مسح = وحدة واحدة تُرجَع من عهدة هذا العميل (الأقدم أولاً).
    let rc: ResolvedCopy | null = null;
    try {
      rc = await resolveScan(db, companyId, userId, b, false);
    } catch (e) {
      if (!(e instanceof CustodyError) || e.code !== 'NOT_FOUND') throw e;
    }
    if (rc?.poolMode) {
      const pl = await db.query(
        `SELECT l.id, v.voucher_no, v.delivery_date::text AS delivered_on, cp.barcode
           FROM cartela_custody_lines l
           JOIN cartela_custody_vouchers v ON v.id = l.voucher_id
           JOIN cartela_copies cp ON cp.id = l.copy_id
          WHERE l.company_id = $1 AND l.customer_id = $2 AND l.returned_on IS NULL
            AND cp.cartela_label_id = $3 AND cp.color_id IS NOT DISTINCT FROM $4::uuid
          ORDER BY v.delivery_date, l.created_at LIMIT 1 FOR UPDATE OF l`,
        [companyId, d.customerId, rc.cartelaId, rc.levelColorId],
      );
      if (!pl.rows.length) throw new CustodyError(`لا توجد نسخة من الكارتيلة ${rc.cartelaTitle} بعهدة هذا العميل (أُرجعت كلها أو بعهدة عميل آخر)`, 'CONFLICT');
      const pr = pl.rows[0];
      if (diffDays(pr.delivered_on, returnedOn) < 0) throw new CustodyError(`تاريخ الإرجاع قبل تاريخ التسليم للكارتيلة ${rc.cartelaTitle}`, 'VALIDATION');
      await db.query(`UPDATE cartela_custody_lines SET returned_on = $2, returned_by_user_id = $3 WHERE id = $1`, [pr.id, returnedOn, userId]);
      returned.push({ barcode: String(pr.barcode), lineId: pr.id, voucherNo: pr.voucher_no });
      continue;
    }
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
  const rows = await insertGeneratedCopies(db, companyId, userId, d.cartelaId, d.colorId ?? null, d.count);
  const barcodes = rows.map((r) => r.barcode);
  return { barcodes };
}


/** يُدرج نسخاً بباركود KC مولَّد متسلسل (قفل استشاري لضمان التفرد). */
async function insertGeneratedCopies(
  db: Db, companyId: string, userId: string | null, cartelaId: string, colorId: string | null, count: number,
): Promise<{ id: string; barcode: string }[]> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:cartela_copy_barcode`]);
  const mx = await db.query(
    `SELECT COALESCE(MAX(substr(barcode, 3)::bigint), 0) AS n FROM cartela_copies WHERE company_id = $1 AND barcode ~ '^KC[0-9]+$'`,
    [companyId],
  );
  let n = Number(mx.rows[0].n);
  const rows: { id: string; barcode: string }[] = [];
  for (let i = 0; i < count; i++) {
    n += 1;
    const barcode = `KC${String(n).padStart(7, '0')}`;
    const ins = await db.query(
      `INSERT INTO cartela_copies (company_id, cartela_label_id, color_id, barcode, created_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, cartelaId, colorId, barcode, userId],
    );
    rows.push({ id: ins.rows[0].id as string, barcode });
  }
  return rows;
}

// ─────────────────────────── مخزون الكارتيلات بالعدد ───────────────────────────

export type StockRow = {
  cartelaId: string;
  title: string;
  artCode: string;
  serialNo: string;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  colorCount: number;
  /** null = بلا تتبع عددي. */
  quantity: number | null;
  held: number;
  available: number | null;
};

const toStockRow = (r: any, kind: 'cartela' | 'color'): StockRow => {
  const quantity = r.quantity === null || r.quantity === undefined ? null : Number(r.quantity);
  const held = Number(r.held ?? 0);
  return {
    cartelaId: r.cartela_id, title: r.title, artCode: r.art_code, serialNo: r.serial_no,
    colorId: kind === 'color' ? r.color_id : null, colorCode: kind === 'color' ? r.color_code : null, colorName: kind === 'color' ? r.color_name : null,
    colorCount: Number(r.color_count ?? 0), quantity, held, available: quantity === null ? null : Math.max(quantity - held, 0),
  };
};

/** قائمة الكارتيلات مع أعداد مستوى الكارتيلة كلها (والمُسلَّم منها). */
export async function listStock(db: Db, companyId: string, search?: string): Promise<StockRow[]> {
  const params: unknown[] = [companyId];
  let where = 'cl.company_id = $1';
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    where += ` AND (cl.title ILIKE $2 OR cl.art_code ILIKE $2 OR cl.serial_no ILIKE $2 OR cl.barcode_code ILIKE $2)`;
  }
  const r = await db.query(
    `SELECT cl.id AS cartela_id, cl.title, cl.art_code, cl.serial_no,
            (SELECT count(*)::int FROM cartela_label_colors c WHERE c.company_id = cl.company_id AND c.cartela_label_id = cl.id) AS color_count,
            lvl.quantity,
            (SELECT count(*)::int FROM cartela_custody_lines l JOIN cartela_copies cp ON cp.id = l.copy_id
              WHERE l.company_id = cl.company_id AND l.returned_on IS NULL AND cp.cartela_label_id = cl.id AND cp.color_id IS NULL) AS held
       FROM cartela_labels cl
       LEFT JOIN cartela_stock_levels lvl ON lvl.company_id = cl.company_id AND lvl.cartela_label_id = cl.id AND lvl.color_id IS NULL
      WHERE ${where}
      ORDER BY cl.title, cl.serial_no LIMIT 300`,
    params,
  );
  return r.rows.map((x) => toStockRow(x, 'cartela'));
}

/** ألوان كارتيلة واحدة مع أعداد مستوى كل لون. */
export async function listStockColors(db: Db, companyId: string, cartelaId: string): Promise<StockRow[]> {
  const r = await db.query(
    `SELECT cl.id AS cartela_id, cl.title, cl.art_code, cl.serial_no, 0 AS color_count,
            c.id AS color_id, c.color_code, c.name_ar AS color_name, lvl.quantity,
            (SELECT count(*)::int FROM cartela_custody_lines l JOIN cartela_copies cp ON cp.id = l.copy_id
              WHERE l.company_id = c.company_id AND l.returned_on IS NULL AND cp.cartela_label_id = cl.id AND cp.color_id = c.id) AS held
       FROM cartela_label_colors c
       JOIN cartela_labels cl ON cl.id = c.cartela_label_id AND cl.company_id = c.company_id
       LEFT JOIN cartela_stock_levels lvl ON lvl.company_id = c.company_id AND lvl.cartela_label_id = cl.id AND lvl.color_id = c.id
      WHERE c.company_id = $1 AND c.cartela_label_id = $2
      ORDER BY c.color_code`,
    [companyId, cartelaId],
  );
  return r.rows.map((x) => toStockRow(x, 'color'));
}

export const stockSetSchema = z.object({
  cartelaId: z.string().uuid(),
  colorId: z.string().uuid().optional().nullable(),
  /** null = إلغاء التتبع العددي (يعود السلوك السابق). */
  quantity: z.coerce.number().int().min(0).max(100000).nullable(),
});

export async function setStockLevel(db: Db, companyId: string, userId: string | null, raw: unknown) {
  const parsed = stockSetSchema.safeParse(raw);
  if (!parsed.success) throw new CustodyError('بيانات المخزون غير صالحة (عدد صحيح من 0 إلى 100000)', 'VALIDATION');
  const d = parsed.data;
  const cl = await db.query(`SELECT id, title FROM cartela_labels WHERE id = $1 AND company_id = $2`, [d.cartelaId, companyId]);
  if (!cl.rows.length) throw new CustodyError('الكارتيلة غير موجودة', 'NOT_FOUND');
  if (d.colorId) {
    const col = await db.query(`SELECT id FROM cartela_label_colors WHERE id = $1 AND company_id = $2 AND cartela_label_id = $3`, [d.colorId, companyId, d.cartelaId]);
    if (!col.rows.length) throw new CustodyError('اللون لا يتبع هذه الكارتيلة', 'VALIDATION');
  }
  const colorId = d.colorId ?? null;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:cartela_stock:${d.cartelaId}:${colorId ?? '-'}`]);
  const held = await heldCountForLevel(db, companyId, d.cartelaId, colorId);
  if (d.quantity === null) {
    if (held > 0) throw new CustodyError(`لا يمكن إلغاء التتبع: ${held} نسخة بعهدة العملاء — استرجعها أولاً`, 'CONFLICT');
    await db.query(
      `DELETE FROM cartela_stock_levels WHERE company_id = $1 AND cartela_label_id = $2 AND color_id IS NOT DISTINCT FROM $3::uuid`,
      [companyId, d.cartelaId, colorId],
    );
    return { cartelaId: d.cartelaId, colorId, quantity: null as number | null, held, available: null as number | null };
  }
  if (d.quantity < held) {
    throw new CustodyError(`العدد أقل من المُسلَّم فعلاً (${held} نسخة بعهدة العملاء) — العدد يجب ألا يقل عنه`, 'VALIDATION');
  }
  await db.query(
    `UPDATE cartela_stock_levels SET quantity = $4, updated_by_user_id = $5, updated_at = now()
      WHERE company_id = $1 AND cartela_label_id = $2 AND color_id IS NOT DISTINCT FROM $3::uuid`,
    [companyId, d.cartelaId, colorId, d.quantity, userId],
  );
  await db.query(
    `INSERT INTO cartela_stock_levels (company_id, cartela_label_id, color_id, quantity, updated_by_user_id)
     SELECT $1,$2,$3::uuid,$4,$5
      WHERE NOT EXISTS (SELECT 1 FROM cartela_stock_levels WHERE company_id = $1 AND cartela_label_id = $2 AND color_id IS NOT DISTINCT FROM $3::uuid)`,
    [companyId, d.cartelaId, colorId, d.quantity, userId],
  );
  return { cartelaId: d.cartelaId, colorId, quantity: d.quantity as number | null, held, available: Math.max(d.quantity - held, 0) as number | null };
}
