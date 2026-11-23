import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createSalesInvoice } from './salesInvoiceService.js';
import { assertNoQualityHold } from './externalJobQualityHold.js';
import { generateBarcode } from '../utils/rollHelpers.js';
import { validateRollCut } from './rollCutMath.js';

/**
 * TASK 009 (بشير): قص التوب والبيع المباشر — يعيد استخدام محرك البيع الجزئي الحالي دون بناء محرك جديد.
 *
 * وضعان (ملاحظة مدير بشير: التسعير صلاحية):
 *  أ) مسعَّر فوراً (لمن يملك صلاحية invoices.price): فاتورة بيع مؤكَّدة بسطر على التوب الأصلي بكمية القص —
 *     المحرك يخصم المتر مرة واحدة ويُبقي باركود الأصل ويسجّل حركة SALE.
 *  ب) حفظ بلا تسعير (لبروفايل المخزون، أو لمن اختار التأجيل): يُخصم المتر من التوب الأصلي فوراً بحركة CUT،
 *     ويُسجَّل القص PENDING بلا فاتورة؛ وتبقى «الفاتورة معلّقة» حتى يسعّرها المحاسب (priceRollCut) فتُنشأ فاتورة مؤكَّدة
 *     دون خصم ثانٍ (سطرها يحمل rollCutPrededucted فيتجاوز المحرك الخصم).
 * في الحالتين: "قطعة مقصوصة" = توب جديد بباركود جديد بحالة SOLD وطول 0 (قاعدة المحرك) للستيكر والتتبّع فقط،
 * وسجل قص fabric_roll_cuts. كل ذلك داخل معاملة واحدة يوفّرها المستدعي — ذرّية بالكامل.
 */

export const rollCutInputSchema = z.object({
  originalRollId: z.string().uuid(),
  cutLengthM: z.coerce.number().positive(),
  customerId: z.string().uuid(),
  /** سعر المتر — اختياري: غيابه (أو deferPricing) يعني حفظ القص بلا تسعير. */
  unitPrice: z.coerce.number().positive().optional(),
  unit: z.enum(['meter', 'yard']).default('meter'),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().positive().optional(),
  invoiceDate: z.string().min(1).optional(),
  paidAmount: z.coerce.number().nonnegative().default(0),
  cashboxId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** من يملك التسعير قد يختار الحفظ بلا تسعير الآن. */
  deferPricing: z.boolean().optional().default(false),
});

export type RollCutInput = z.infer<typeof rollCutInputSchema>;

export type RollCutResult = {
  pricingStatus: 'PRICED' | 'PENDING';
  /** null عند القص المعلّق (لا فاتورة قبل التسعير). */
  invoice: { id: string; invoiceNo: string } | null;
  originalRoll: { id: string; barcode: string; remainingLengthM: number };
  cutPiece: { id: string; barcode: string; lengthM: number };
  cutLogId: string;
};

type OriginalRollRow = {
  id: string;
  barcode: string;
  item_id: string;
  color_id: string | null;
  variant_id: string | null;
  warehouse_id: string;
  location_id: string | null;
  length_m: string;
  width_cm: string | null;
  gsm: string | null;
  unit_cost: string | null;
  currency_code: string | null;
  status: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function err(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** ينشئ توب «القطعة المقصوصة»: SOLD وطوله 0 (قاعدة المحرك للتوب المباع)، مربوطاً بالأصل. */
async function insertCutPieceRoll(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  roll: OriginalRollRow,
  note: string,
): Promise<{ id: string; barcode: string }> {
  const cutBarcode = await generateBarcode(client, companyId);
  const res = await client.query<{ id: string; barcode: string }>(
    `INSERT INTO fabric_rolls
       (company_id, barcode, item_id, color_id, variant_id, warehouse_id, location_id,
        length_m, width_cm, gsm, unit_cost, currency_code, status, cut_from_roll_id,
        notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,'SOLD',$12,$13,$14)
     RETURNING id, barcode`,
    [
      companyId,
      cutBarcode,
      roll.item_id,
      roll.color_id,
      roll.variant_id,
      roll.warehouse_id,
      roll.location_id,
      roll.width_cm,
      roll.gsm,
      roll.unit_cost,
      roll.currency_code,
      roll.id,
      note,
      userId,
    ],
  );
  return res.rows[0];
}

export async function cutAndSellRoll(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rawInput: unknown,
  opts: { canPrice?: boolean; warehouseScope?: string[] | null } = {},
): Promise<RollCutResult> {
  const canPrice = opts.canPrice !== false;
  const parsed = rollCutInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Object.assign(new Error('بيانات قص التوب غير صالحة'), {
      code: 'VALIDATION',
      details: parsed.error.flatten(),
    });
  }
  const d = parsed.data;

  // من لا يملك صلاحية التسعير: يُتجاهل أي سعر/دفعة/صندوق يصله ويُحفَظ القص معلّقاً — تُفرَض الصلاحية هنا بالخادم لا بالواجهة.
  const priceNow = canPrice && !d.deferPricing;
  if (priceNow && d.unitPrice === undefined) {
    throw err('أدخل سعر المتر، أو احفظ القص بلا تسعير', 'VALIDATION');
  }

  // قفل التوب الأصلي أولاً لمنع أي بيع/قص متزامن عليه.
  const rollRes = await client.query<OriginalRollRow>(
    `SELECT id, barcode, item_id, color_id, variant_id, warehouse_id, location_id,
            length_m, width_cm, gsm, unit_cost, currency_code, status
       FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [d.originalRollId, companyId],
  );
  if (!rollRes.rows.length) throw err('التوب غير موجود', 'NOT_FOUND');
  const roll = rollRes.rows[0];
  if (opts.warehouseScope && !opts.warehouseScope.includes(String(roll.warehouse_id).toLowerCase())) {
    throw err('هذا المستودع غير مخصّص لحسابك', 'VALIDATION');
  }

  const check = validateRollCut({
    currentLengthM: Number(roll.length_m),
    cutLengthM: d.cutLengthM,
    status: roll.status,
  });
  if (!check.ok) throw err(check.message, 'VALIDATION');

  const lengthBefore = round2(Number(roll.length_m));

  // ───────────────────────── حفظ بلا تسعير (المخزون يُخصم الآن، والفاتورة معلّقة) ─────────────────────────
  if (!priceNow) {
    // نفس صرامة المحرك: توب محجوز لمسودة بيع أخرى أو محجوز جودة لا يُقصّ.
    if (roll.status === 'RESERVED') throw err('الثوب محجوز لفاتورة مسودة — لا يمكن قصّه الآن', 'INVALID_STOCK');
    await assertNoQualityHold(client, companyId, roll.id);

    const piece = await insertCutPieceRoll(
      client,
      companyId,
      userId,
      roll,
      `قطعة مقصوصة من التوب ${roll.barcode} — بانتظار التسعير`,
    );
    const log = await client.query<{ id: string }>(
      `INSERT INTO fabric_roll_cuts
         (company_id, original_roll_id, cut_piece_roll_id, sales_invoice_id, sales_invoice_no, pricing_status,
          customer_id, original_barcode, cut_barcode, cut_length_m,
          original_length_before_m, original_length_after_m, notes, created_by_user_id)
       VALUES ($1,$2,$3,NULL,NULL,'PENDING',$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        companyId,
        roll.id,
        piece.id,
        d.customerId,
        roll.barcode,
        piece.barcode,
        d.cutLengthM,
        lengthBefore,
        check.remainingLengthM,
        d.notes ?? null,
        userId,
      ],
    );
    const cutId = log.rows[0].id;
    const newStatus = check.fullRoll ? 'SOLD' : 'AVAILABLE';

    await client.query(`UPDATE fabric_rolls SET length_m=$3, status=$4, updated_at=now() WHERE id=$1 AND company_id=$2`, [
      roll.id,
      companyId,
      check.remainingLengthM,
      newStatus,
    ]);
    // خصم المتر من الأصل (delta سالب = مباع، تقرؤه تقارير المباع) وحركة تتبّع للقطعة (delta=0).
    await client.query(
      `INSERT INTO inventory_movements
         (company_id, roll_id, movement_type, old_status, new_status, length_delta_m,
          reference_type, reference_id, reference_no, notes, created_by_user_id)
       VALUES ($1,$2,'CUT',$3,$4,$5,'ROLL_CUT',$6,$7,$8,$9)`,
      [companyId, roll.id, roll.status, newStatus, -d.cutLengthM, cutId, piece.barcode, `قص ${d.cutLengthM} م — بانتظار التسعير`, userId],
    );
    await client.query(
      `INSERT INTO inventory_movements
         (company_id, roll_id, movement_type, old_status, new_status, length_delta_m,
          reference_type, reference_id, reference_no, notes, created_by_user_id)
       VALUES ($1,$2,'CUT',NULL,'SOLD',0,'ROLL_CUT',$3,$4,$5,$6)`,
      [companyId, piece.id, cutId, roll.barcode, `قطعة مقصوصة من ${roll.barcode} بطول ${d.cutLengthM} م`, userId],
    );

    return {
      pricingStatus: 'PENDING',
      invoice: null,
      originalRoll: { id: roll.id, barcode: roll.barcode, remainingLengthM: check.remainingLengthM },
      cutPiece: { id: piece.id, barcode: piece.barcode, lengthM: d.cutLengthM },
      cutLogId: cutId,
    };
  }

  // ───────────────────────── مسعَّر فوراً (المسار الأصلي كما هو) ─────────────────────────
  const unitPrice = d.unitPrice as number;
  const lineTotal = round2(d.cutLengthM * unitPrice);

  // (1) فاتورة بيع مؤكَّدة على التوب الأصلي بكمية القص — محرك البيع الجزئي
  //     الحالي يخصم المتر مرة واحدة ويُبقي باركود الأصل ويسجّل حركة SALE.
  const invoice = await createSalesInvoice(client, companyId, userId, {
    invoiceNo: 'AUTO',
    invoiceDate: (d.invoiceDate ?? new Date().toISOString()).slice(0, 10),
    customerId: d.customerId,
    warehouseId: roll.warehouse_id,
    currencyCode: d.currencyCode,
    exchangeRateToUsd: d.exchangeRateToUsd,
    notes: d.notes ?? null,
    subtotal: lineTotal,
    discountTotal: 0,
    taxTotal: 0,
    totalAmount: lineTotal,
    paidAmount: d.paidAmount,
    remainingAmount: round2(Math.max(0, lineTotal - d.paidAmount)),
    paymentStatus: d.paidAmount <= 0 ? 'unpaid' : d.paidAmount >= lineTotal ? 'paid' : 'partial',
    lines: [
      {
        fabricRollId: roll.id,
        fabricItemId: roll.item_id,
        variantId: roll.variant_id,
        warehouseId: roll.warehouse_id,
        description: 'قص توب',
        quantity: d.cutLengthM,
        unit: d.unit,
        unitPrice,
        lineDiscount: 0,
        lineTax: 0,
        lineTotal,
      },
    ],
    confirm: true,
    cashboxId: d.cashboxId ?? null,
  });

  // (2) القطعة المقصوصة: توب جديد بباركود جديد SOLD وطوله 0 مربوط بالأصل — للستيكر والتتبّع فقط.
  const piece = await insertCutPieceRoll(
    client,
    companyId,
    userId,
    roll,
    `قطعة مقصوصة من التوب ${roll.barcode} — فاتورة ${invoice.invoiceNo}`,
  );

  await client.query(
    `INSERT INTO inventory_movements
       (company_id, roll_id, movement_type, old_status, new_status, length_delta_m,
        reference_type, reference_id, reference_no, notes, created_by_user_id)
     VALUES ($1,$2,'CUT',NULL,'SOLD',$3,'SALES_INVOICE',$4,$5,$6,$7)`,
    [
      companyId,
      piece.id,
      // حركة تتبّع فقط (delta = 0): الخصم الفعلي سُجّل مرة واحدة بحركة SALE على التوب الأصلي، وأي delta
      // موجب هنا كان سيُقرأ بتقرير الأمتار المستلمة (positive_length_m) كإدخال مخزون وهمي.
      0,
      invoice.id,
      invoice.invoiceNo,
      `قطعة مقصوصة من ${roll.barcode} بطول ${d.cutLengthM} م`,
      userId,
    ],
  );

  // (3) سجل القص — القيد الفريد على الفاتورة يضمن عدم تكرار العملية.
  const cutLogRes = await client.query<{ id: string }>(
    `INSERT INTO fabric_roll_cuts
       (company_id, original_roll_id, cut_piece_roll_id, sales_invoice_id, sales_invoice_no, pricing_status,
        customer_id, original_barcode, cut_barcode, cut_length_m,
        original_length_before_m, original_length_after_m, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,'PRICED',$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      companyId,
      roll.id,
      piece.id,
      invoice.id,
      invoice.invoiceNo,
      d.customerId,
      roll.barcode,
      piece.barcode,
      d.cutLengthM,
      lengthBefore,
      check.remainingLengthM,
      d.notes ?? null,
      userId,
    ],
  );

  return {
    pricingStatus: 'PRICED',
    invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo },
    originalRoll: { id: roll.id, barcode: roll.barcode, remainingLengthM: check.remainingLengthM },
    cutPiece: { id: piece.id, barcode: piece.barcode, lengthM: d.cutLengthM },
    cutLogId: cutLogRes.rows[0].id,
  };
}

// ───────────────────────── تسعير قص معلّق (المحاسب) ─────────────────────────

export const priceRollCutSchema = z.object({
  cutId: z.string().uuid(),
  unitPrice: z.coerce.number().positive(),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().positive().optional(),
  invoiceDate: z.string().min(1).optional(),
  paidAmount: z.coerce.number().nonnegative().default(0),
  cashboxId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * يسعّر قصاً معلّقاً: ينشئ فاتورة بيع مؤكَّدة للعميل المحفوظ مع القص. المتر خُصم من التوب الأصلي عند القص،
 * فسطر الفاتورة يحمل rollCutPrededucted ليتجاوز المحرك الخصم (يحسب التكلفة COGS من التوب الأصلي فقط).
 * يُرفض إن لم يكن القص PENDING (لا تسعير مزدوج).
 */
export async function priceRollCut(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rawInput: unknown,
): Promise<{ cutId: string; invoice: { id: string; invoiceNo: string } }> {
  const parsed = priceRollCutSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Object.assign(new Error('بيانات التسعير غير صالحة'), { code: 'VALIDATION', details: parsed.error.flatten() });
  }
  const d = parsed.data;

  const cutRes = await client.query<{
    id: string;
    pricing_status: string;
    customer_id: string | null;
    original_roll_id: string;
    cut_piece_roll_id: string;
    cut_length_m: string;
    notes: string | null;
    item_id: string;
    variant_id: string | null;
    warehouse_id: string;
  }>(
    `SELECT c.id, c.pricing_status, c.customer_id, c.original_roll_id, c.cut_piece_roll_id, c.cut_length_m, c.notes,
            r.item_id, r.variant_id, r.warehouse_id
       FROM fabric_roll_cuts c
       JOIN fabric_rolls r ON r.id = c.original_roll_id AND r.company_id = c.company_id
      WHERE c.id = $1 AND c.company_id = $2
      FOR UPDATE OF c`,
    [d.cutId, companyId],
  );
  if (!cutRes.rows.length) throw err('سجل القص غير موجود', 'NOT_FOUND');
  const cut = cutRes.rows[0];
  if (cut.pricing_status !== 'PENDING') throw err('هذا القص مسعَّر مسبقاً', 'VALIDATION');
  if (!cut.customer_id) throw err('لا عميل مسجّل لهذا القص', 'VALIDATION');

  const qtyM = Number(cut.cut_length_m);
  const lineTotal = round2(qtyM * d.unitPrice);

  const invoice = await createSalesInvoice(client, companyId, userId, {
    invoiceNo: 'AUTO',
    invoiceDate: (d.invoiceDate ?? new Date().toISOString()).slice(0, 10),
    customerId: cut.customer_id,
    warehouseId: cut.warehouse_id,
    currencyCode: d.currencyCode,
    exchangeRateToUsd: d.exchangeRateToUsd,
    notes: d.notes ?? cut.notes ?? null,
    subtotal: lineTotal,
    discountTotal: 0,
    taxTotal: 0,
    totalAmount: lineTotal,
    paidAmount: d.paidAmount,
    remainingAmount: round2(Math.max(0, lineTotal - d.paidAmount)),
    paymentStatus: d.paidAmount <= 0 ? 'unpaid' : d.paidAmount >= lineTotal ? 'paid' : 'partial',
    lines: [
      {
        // لا fabricRollId: التوب الأصلي لا يُحجَز ولا يُخصم ثانيةً (المتر خُصم عند القص).
        fabricItemId: cut.item_id,
        variantId: cut.variant_id,
        warehouseId: cut.warehouse_id,
        description: 'قص توب',
        quantity: qtyM,
        unit: 'meter',
        unitPrice: d.unitPrice,
        lineDiscount: 0,
        lineTax: 0,
        lineTotal,
        metadata: {
          rollCutPrededucted: {
            cutId: cut.id,
            originalRollId: cut.original_roll_id,
            cutRollId: cut.cut_piece_roll_id,
            qtyM,
          },
        },
      },
    ],
    confirm: true,
    cashboxId: d.cashboxId ?? null,
  });

  await client.query(
    `UPDATE fabric_roll_cuts SET pricing_status='PRICED', sales_invoice_id=$3, sales_invoice_no=$4
      WHERE id=$1 AND company_id=$2`,
    [cut.id, companyId, invoice.id, invoice.invoiceNo],
  );
  return { cutId: cut.id, invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo } };
}

export type RollCutLogRow = {
  id: string;
  pricing_status: 'PENDING' | 'PRICED';
  sales_invoice_id: string | null;
  sales_invoice_no: string | null;
  original_roll_id: string;
  cut_piece_roll_id: string;
  original_barcode: string;
  cut_barcode: string;
  cut_length_m: string;
  original_length_before_m: string;
  original_length_after_m: string;
  customer_name: string | null;
  item_name: string | null;
  created_at: string;
};

export async function listRollCuts(
  client: PoolClient,
  companyId: string,
  opts: { search?: string; limit?: number; pendingOnly?: boolean } = {},
): Promise<RollCutLogRow[]> {
  const params: unknown[] = [companyId];
  let where = 'rc.company_id = $1';
  if (opts.pendingOnly) where += ` AND rc.pricing_status = 'PENDING'`;
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where += ` AND (COALESCE(rc.sales_invoice_no,'') ILIKE $${params.length} OR rc.original_barcode ILIKE $${params.length} OR rc.cut_barcode ILIKE $${params.length})`;
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const res = await client.query<RollCutLogRow>(
    `SELECT rc.id, rc.pricing_status, rc.sales_invoice_id, rc.sales_invoice_no,
            rc.original_roll_id, rc.cut_piece_roll_id,
            rc.original_barcode, rc.cut_barcode,
            rc.cut_length_m, rc.original_length_before_m, rc.original_length_after_m,
            c.name AS customer_name, fi.name AS item_name, rc.created_at
       FROM fabric_roll_cuts rc
       LEFT JOIN customers c ON c.id = rc.customer_id
       LEFT JOIN fabric_rolls fr ON fr.id = rc.original_roll_id
       LEFT JOIN fabric_items fi ON fi.id = fr.item_id
      WHERE ${where}
      ORDER BY (rc.pricing_status = 'PENDING') DESC, rc.created_at DESC
      LIMIT ${limit}`,
    params,
  );
  return res.rows;
}
