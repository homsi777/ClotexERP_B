import type { PoolClient } from 'pg';
import { z } from 'zod';
import { createSalesInvoice } from './salesInvoiceService.js';
import { generateBarcode } from '../utils/rollHelpers.js';
import { validateRollCut } from './rollCutMath.js';

/**
 * TASK 009 (بشير): قص التوب والبيع المباشر — يعيد استخدام محرك البيع الجزئي
 * الحالي (createSalesInvoice + confirm) دون بناء محرك جديد:
 *   1) فاتورة بيع مؤكَّدة بسطر واحد على التوب الأصلي بكمية القص → المحرك يخصم
 *      المتر مرة واحدة ويُبقي باركود الأصل ويسجّل حركة البيع.
 *   2) "قطعة مقصوصة" = سطر توب جديد بباركود جديد بحالة SOLD (خارج المخزون
 *      المتاح) مربوط بالأصل والفاتورة — للستيكر والتتبّع فقط، لا رصيد.
 *   3) سجل قص (fabric_roll_cuts) بقيد فريد على الفاتورة يمنع التكرار.
 * كل ذلك داخل معاملة واحدة يوفّرها المستدعي (الراوت) — ذرّية بالكامل.
 */

export const rollCutInputSchema = z.object({
  originalRollId: z.string().uuid(),
  cutLengthM: z.coerce.number().positive(),
  customerId: z.string().uuid(),
  unitPrice: z.coerce.number().positive(),
  unit: z.enum(['meter', 'yard']).default('meter'),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().positive().optional(),
  invoiceDate: z.string().min(1).optional(),
  paidAmount: z.coerce.number().nonnegative().default(0),
  cashboxId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type RollCutInput = z.infer<typeof rollCutInputSchema>;

export type RollCutResult = {
  invoice: { id: string; invoiceNo: string };
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

export async function cutAndSellRoll(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rawInput: unknown,
): Promise<RollCutResult> {
  const parsed = rollCutInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Object.assign(new Error('بيانات قص التوب غير صالحة'), {
      code: 'VALIDATION',
      details: parsed.error.flatten(),
    });
  }
  const d = parsed.data;

  // قفل التوب الأصلي أولاً لمنع أي بيع/قص متزامن عليه.
  const rollRes = await client.query<OriginalRollRow>(
    `SELECT id, barcode, item_id, color_id, variant_id, warehouse_id, location_id,
            length_m, width_cm, gsm, unit_cost, currency_code, status
       FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [d.originalRollId, companyId],
  );
  if (!rollRes.rows.length) {
    throw Object.assign(new Error('التوب غير موجود'), { code: 'NOT_FOUND' });
  }
  const roll = rollRes.rows[0];

  const check = validateRollCut({
    currentLengthM: Number(roll.length_m),
    cutLengthM: d.cutLengthM,
    status: roll.status,
  });
  if (!check.ok) {
    throw Object.assign(new Error(check.message), { code: 'VALIDATION' });
  }

  const lengthBefore = round2(Number(roll.length_m));
  const lineTotal = round2(d.cutLengthM * d.unitPrice);

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
        commodityType: 'FABRIC',
        fabricItemId: roll.item_id,
        variantId: roll.variant_id,
        warehouseId: roll.warehouse_id,
        description: 'قص توب',
        quantity: d.cutLengthM,
        unit: d.unit,
        unitPrice: d.unitPrice,
        lineDiscount: 0,
        lineTax: 0,
        lineTotal,
      },
    ],
    confirm: true,
    cashboxId: d.cashboxId ?? null,
  });

  // (2) القطعة المقصوصة: سطر توب جديد بباركود جديد بحالة SOLD مربوط بالأصل.
  //     خارج المخزون المتاح (SOLD) فلا يُحسب رصيداً — للستيكر والتتبّع فقط.
  const cutBarcode = await generateBarcode(client, companyId);
  const cutRollRes = await client.query<{ id: string; barcode: string }>(
    `INSERT INTO fabric_rolls
       (company_id, barcode, item_id, color_id, variant_id, warehouse_id, location_id,
        length_m, width_cm, gsm, unit_cost, currency_code, status, cut_from_roll_id,
        notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'SOLD',$13,$14,$15)
     RETURNING id, barcode`,
    [
      companyId,
      cutBarcode,
      roll.item_id,
      roll.color_id,
      roll.variant_id,
      roll.warehouse_id,
      roll.location_id,
      d.cutLengthM,
      roll.width_cm,
      roll.gsm,
      roll.unit_cost,
      roll.currency_code,
      roll.id,
      `قطعة مقصوصة من التوب ${roll.barcode} — فاتورة ${invoice.invoiceNo}`,
      userId,
    ],
  );
  const cutRoll = cutRollRes.rows[0];

  await client.query(
    `INSERT INTO inventory_movements
       (company_id, roll_id, movement_type, old_status, new_status, length_delta_m,
        reference_type, reference_id, reference_no, notes, created_by_user_id)
     VALUES ($1,$2,'CUT',NULL,'SOLD',$3,'SALES_INVOICE',$4,$5,$6,$7)`,
    [
      companyId,
      cutRoll.id,
      d.cutLengthM,
      invoice.id,
      invoice.invoiceNo,
      `قطعة مقصوصة من ${roll.barcode}`,
      userId,
    ],
  );

  // (3) سجل القص — القيد الفريد على الفاتورة يضمن عدم تكرار العملية.
  const cutLogRes = await client.query<{ id: string }>(
    `INSERT INTO fabric_roll_cuts
       (company_id, original_roll_id, cut_piece_roll_id, sales_invoice_id, sales_invoice_no,
        customer_id, original_barcode, cut_barcode, cut_length_m,
        original_length_before_m, original_length_after_m, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      companyId,
      roll.id,
      cutRoll.id,
      invoice.id,
      invoice.invoiceNo,
      d.customerId,
      roll.barcode,
      cutRoll.barcode,
      d.cutLengthM,
      lengthBefore,
      check.remainingLengthM,
      d.notes ?? null,
      userId,
    ],
  );

  return {
    invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo },
    originalRoll: { id: roll.id, barcode: roll.barcode, remainingLengthM: check.remainingLengthM },
    cutPiece: { id: cutRoll.id, barcode: cutRoll.barcode, lengthM: d.cutLengthM },
    cutLogId: cutLogRes.rows[0].id,
  };
}

export type RollCutLogRow = {
  id: string;
  sales_invoice_id: string;
  sales_invoice_no: string;
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
  opts: { search?: string; limit?: number } = {},
): Promise<RollCutLogRow[]> {
  const params: unknown[] = [companyId];
  let where = 'rc.company_id = $1';
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where += ` AND (rc.sales_invoice_no ILIKE $2 OR rc.original_barcode ILIKE $2 OR rc.cut_barcode ILIKE $2)`;
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const res = await client.query<RollCutLogRow>(
    `SELECT rc.id, rc.sales_invoice_id, rc.sales_invoice_no,
            rc.original_roll_id, rc.cut_piece_roll_id,
            rc.original_barcode, rc.cut_barcode,
            rc.cut_length_m, rc.original_length_before_m, rc.original_length_after_m,
            c.name AS customer_name, fi.name AS item_name, rc.created_at
       FROM fabric_roll_cuts rc
       LEFT JOIN customers c ON c.id = rc.customer_id
       LEFT JOIN fabric_rolls fr ON fr.id = rc.original_roll_id
       LEFT JOIN fabric_items fi ON fi.id = fr.item_id
      WHERE ${where}
      ORDER BY rc.created_at DESC
      LIMIT ${limit}`,
    params,
  );
  return res.rows;
}
