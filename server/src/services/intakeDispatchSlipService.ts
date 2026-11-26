import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { createPurchaseInvoice, confirmPurchaseInvoice } from './purchaseInvoiceService.js';
import { todayYmd } from '../utils/businessDate.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';

export type IntakeDispatchSlipRow = {
  id: string;
  company_id: string;
  intake_operation_id: string | null;
  external_job_id?: string | null;
  slip_no: string;
  slip_type: 'STOCK' | 'PURCHASE' | 'EXTERNAL' | 'ITEM_CREATION';
  warehouse_id: string;
  supplier_id: string | null;
  purchase_invoice_id: string | null;
  created_at: string;
  updated_at: string;
  warehouse_name?: string;
  supplier_name?: string;
  order_no?: string;
  purchase_invoice_no?: string | null;
  operation_status?: 'DRAFT' | 'COMPLETED' | 'VOID';
  line_count?: number;
  priced_line_count?: number;
};

export type IntakeDispatchSlipLineRow = {
  id: string;
  slip_id: string;
  fabric_roll_id: string;
  unit_price: string | null;
  line_total: string | null;
  price_basis?: 'METER' | 'KG';
  weight_kg?: string | null;
  entry_basis?: 'LENGTH' | 'WEIGHT';
  barcode: string;
  length_m: string;
  item_name: string;
  color_name_ar: string | null;
};

export async function listDispatchSlips(pool: Pool, companyId: string): Promise<IntakeDispatchSlipRow[]> {
  const res = await pool.query<IntakeDispatchSlipRow>(
    `SELECT s.*, w.name AS warehouse_name, sup.name AS supplier_name, COALESCE(io.order_no, 'مصنعية ' || ej.job_no, 'إنشاء مادة') AS order_no,
            COALESCE(io.status, 'COMPLETED') AS operation_status,
            pi.invoice_no AS purchase_invoice_no,
            (SELECT count(*) FROM intake_dispatch_slip_lines l WHERE l.slip_id = s.id) AS line_count,
            (SELECT count(*) FROM intake_dispatch_slip_lines l WHERE l.slip_id = s.id AND l.unit_price IS NOT NULL) AS priced_line_count
     FROM intake_dispatch_slips s
     JOIN warehouses w ON w.id = s.warehouse_id
     LEFT JOIN suppliers sup ON sup.id = s.supplier_id
     LEFT JOIN intake_operations io ON io.id = s.intake_operation_id
     LEFT JOIN external_jobs ej ON ej.id = s.external_job_id
     LEFT JOIN purchase_invoices pi ON pi.id = s.purchase_invoice_id
     WHERE s.company_id = $1
     ORDER BY s.created_at DESC`,
    [companyId],
  );
  return res.rows;
}

export async function getDispatchSlipWithLines(
  pool: Pool,
  companyId: string,
  id: string,
): Promise<{ slip: IntakeDispatchSlipRow; lines: IntakeDispatchSlipLineRow[] } | null> {
  const slipRes = await pool.query<IntakeDispatchSlipRow>(
    `SELECT s.*, w.name AS warehouse_name, sup.name AS supplier_name, COALESCE(io.order_no, 'مصنعية ' || ej.job_no, 'إنشاء مادة') AS order_no,
            COALESCE(io.status, 'COMPLETED') AS operation_status,
            pi.invoice_no AS purchase_invoice_no
     FROM intake_dispatch_slips s
     JOIN warehouses w ON w.id = s.warehouse_id
     LEFT JOIN suppliers sup ON sup.id = s.supplier_id
     LEFT JOIN intake_operations io ON io.id = s.intake_operation_id
     LEFT JOIN external_jobs ej ON ej.id = s.external_job_id
     LEFT JOIN purchase_invoices pi ON pi.id = s.purchase_invoice_id
     WHERE s.id = $1 AND s.company_id = $2`,
    [id, companyId],
  );
  const slip = slipRes.rows[0];
  if (!slip) return null;

  const linesRes = await pool.query<IntakeDispatchSlipLineRow>(
    `SELECT l.id, l.slip_id, l.fabric_roll_id, l.unit_price, l.line_total, l.price_basis,
            COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg) AS weight_kg, fr.entry_basis,
            fr.barcode, fr.length_m, fi.name AS item_name, fc.name_ar AS color_name_ar
     FROM intake_dispatch_slip_lines l
     JOIN fabric_rolls fr ON fr.id = l.fabric_roll_id
     JOIN fabric_items fi ON fi.id = fr.item_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE l.slip_id = $1
     ORDER BY fr.barcode`,
    [id],
  );
  return { slip, lines: linesRes.rows };
}

const priceLinesSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string().uuid(),
    unitPrice: z.number().min(0),
    /** METER: السعر للمتر (الافتراضي)؛ KG: السعر للكيلو والإجمالي = السعر × وزن التوب. */
    basis: z.enum(['METER', 'KG']).optional(),
  })).min(1),
});

export async function updateDispatchSlipLinePrices(
  pool: Pool,
  companyId: string,
  slipId: string,
  raw: unknown,
): Promise<void> {
  const parsed = priceLinesSchema.safeParse(raw);
  if (!parsed.success) throw Object.assign(new Error('بيانات غير صالحة'), { code: 'VALIDATION', issues: parsed.error.issues });

  const slipCheck = await pool.query('SELECT id FROM intake_dispatch_slips WHERE id=$1 AND company_id=$2', [slipId, companyId]);
  if (!slipCheck.rows.length) throw Object.assign(new Error('الإرسالية غير موجودة'), { code: 'NOT_FOUND' });

  for (const line of parsed.data.lines) {
    const basis = line.basis ?? 'METER';
    if (basis === 'KG') {
      const w = await pool.query<{ kg: string | null }>(
        `SELECT COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg)::text AS kg
           FROM intake_dispatch_slip_lines l JOIN fabric_rolls fr ON fr.id = l.fabric_roll_id
          WHERE l.id = $1 AND l.slip_id = $2`,
        [line.lineId, slipId],
      );
      if (!(Number(w.rows[0]?.kg) > 0)) throw Object.assign(new Error('التسعير بالكيلو يتطلب وزناً مسجلاً لكل توب'), { code: 'VALIDATION' });
    }
    await pool.query(
      `UPDATE intake_dispatch_slip_lines l
       SET unit_price = $1, price_basis = $4,
           line_total = ROUND($1 * CASE WHEN $4 = 'KG' THEN COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg) ELSE fr.length_m END, 2),
           updated_at = now()
       FROM fabric_rolls fr
       WHERE l.id = $2 AND l.slip_id = $3 AND fr.id = l.fabric_roll_id`,
      [line.unitPrice, line.lineId, slipId, basis],
    );
  }
}

/**
 * إلغاء ورقي بالكامل — يُعلِّم عملية الإدخال (intake_operations) ملغاة
 * فقط. الأتواب التي أُنشئت بهذه العملية كانت "متوفّرة" بالمستودع منذ
 * لحظة إنشائها (الإرسالية مجرد سجل تسعير فوقها، لا تحجزها ولا تغيّر
 * حالتها بأي شكل) — فلا حذف ولا تغيير حالة لأي توب هنا، خلافاً لإلغاء
 * مهمة خارجية (voidExternalJob) حيث كانت الأتواب فعلاً بحالة محجوزة
 * يلزم التراجع عنها.
 */
export async function voidIntakeDispatchSlip(
  client: PoolClient,
  companyId: string,
  slipId: string,
): Promise<void> {
  const slipRow = await client.query<{ intake_operation_id: string; purchase_invoice_id: string | null }>(
    `SELECT intake_operation_id, purchase_invoice_id FROM intake_dispatch_slips WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [slipId, companyId],
  );
  if (!slipRow.rows.length) throw Object.assign(new Error('الإرسالية غير موجودة'), { code: 'NOT_FOUND' });
  if (slipRow.rows[0].purchase_invoice_id) {
    throw Object.assign(
      new Error('تم ترحيل هذه الإرسالية لفاتورة شراء حقيقية — ألغِ الفاتورة من قسم المشتريات إن لزم'),
      { code: 'INVALID_STATE' },
    );
  }
  const opId = slipRow.rows[0].intake_operation_id;
  if (!opId) {
    throw Object.assign(new Error('إرسالية مصنعية: لا تُلغى من هنا؛ تُدار من مهمة المصنعية'), { code: 'INVALID_STATE' });
  }

  const opRow = await client.query<{ status: string }>(
    `SELECT status FROM intake_operations WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [opId, companyId],
  );
  if (!opRow.rows.length) throw Object.assign(new Error('عملية الإدخال غير موجودة'), { code: 'NOT_FOUND' });
  if (opRow.rows[0].status === 'VOID') {
    throw Object.assign(new Error('الإرسالية ملغاة مسبقاً'), { code: 'INVALID_STATE' });
  }

  const pricedCheck = await client.query(
    `SELECT 1 FROM intake_dispatch_slip_lines WHERE slip_id=$1 AND unit_price IS NOT NULL LIMIT 1`,
    [slipId],
  );
  if (pricedCheck.rows.length) {
    throw Object.assign(
      new Error('بدأ تسعير أسطر هذه الإرسالية — لا يمكن إلغاؤها بعد بدء التسعير'),
      { code: 'INVALID_STATE' },
    );
  }

  await client.query(`UPDATE intake_operations SET status='VOID', updated_at=now() WHERE id=$1`, [opId]);
}

/**
 * يُرحِّل إرسالية "شراء" مُسعَّرة بالكامل إلى فاتورة شراء حقيقية (مؤكَّدة
 * فوراً، نفس نمط فاتورة البيع التلقائية لإجراء "مخزون" بـ
 * finalizeIntakeOperation) — إرسالية الشراء وحدها ليست سجلاً محاسبياً ولا
 * تظهر بكشف حساب المورّد، فهذا هو ما يجعلها كذلك فعلياً.
 *
 * الأتواب التي أُنشئت بعملية الإدخال موجودة فعلاً بـfabric_rolls (ومُسجَّلة
 * بحركة مخزون MANUAL_CREATE منذ لحظة إدخالها) — يُمرَّر fabricRollId جاهزاً
 * لكل سطر فيتخطّى confirmPurchaseInvoice مسار إنشاء توب جديد، و
 * skipStockMovement:true يمنع تكرار تسجيل حركة استلام لنفس التوب.
 */
export async function createPurchaseInvoiceFromDispatchSlip(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  slipId: string,
): Promise<{ id: string; invoiceNo: string }> {
  const slipRow = await client.query<{
    id: string;
    company_id: string;
    slip_no: string;
    slip_type: string;
    supplier_id: string;
    warehouse_id: string;
    purchase_invoice_id: string | null;
    intake_operation_id: string;
  }>(
    `SELECT id, company_id, slip_no, slip_type, supplier_id, warehouse_id, purchase_invoice_id, intake_operation_id
       FROM intake_dispatch_slips WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [slipId, companyId],
  );
  if (!slipRow.rows.length) throw Object.assign(new Error('الإرسالية غير موجودة'), { code: 'NOT_FOUND' });
  const slip = slipRow.rows[0];
  if (slip.slip_type !== 'PURCHASE') {
    throw Object.assign(new Error('هذا الترحيل متاح فقط لإرساليات الشراء'), { code: 'VALIDATION' });
  }
  if (slip.purchase_invoice_id) {
    throw Object.assign(new Error('تم ترحيل هذه الإرسالية مسبقاً لفاتورة شراء'), { code: 'INVALID_STATE' });
  }

  const opRow = await client.query<{ status: string }>(
    `SELECT status FROM intake_operations WHERE id=$1 AND company_id=$2`,
    [slip.intake_operation_id, companyId],
  );
  if (opRow.rows[0]?.status === 'VOID') {
    throw Object.assign(new Error('عملية الإدخال ملغاة — لا يمكن ترحيلها لفاتورة شراء'), { code: 'INVALID_STATE' });
  }

  const linesRes = await client.query<{
    id: string;
    fabric_roll_id: string;
    unit_price: string | null;
    line_total: string | null;
    price_basis: string | null;
    length_m: string;
    item_id: string;
    item_name: string;
    warehouse_id: string;
  }>(
    `SELECT l.id, l.fabric_roll_id, l.unit_price, l.line_total, l.price_basis,
            fr.length_m, fr.item_id, fi.name AS item_name, fr.warehouse_id
       FROM intake_dispatch_slip_lines l
       JOIN fabric_rolls fr ON fr.id = l.fabric_roll_id
       JOIN fabric_items fi ON fi.id = fr.item_id
      WHERE l.slip_id = $1
      ORDER BY fr.barcode`,
    [slipId],
  );
  if (!linesRes.rows.length) {
    throw Object.assign(new Error('الإرسالية بلا أسطر'), { code: 'VALIDATION' });
  }
  const unpriced = linesRes.rows.some((l) => l.unit_price == null);
  if (unpriced) {
    throw Object.assign(new Error('سعّري كل أسطر الإرسالية أولاً قبل الترحيل لفاتورة شراء'), { code: 'VALIDATION' });
  }

  const lines = linesRes.rows.map((l) => ({
    fabricRollId: l.fabric_roll_id,
    fabricItemId: l.item_id,
    warehouseId: l.warehouse_id,
    description: l.item_name,
    quantity: Number(l.length_m),
    unit: 'meter' as const,
    // السعر بالكيلو: فاتورة الشراء بالمتر فيُشتق سعر المتر الفعلي من الإجمالي
    unitPrice: l.price_basis === 'KG' && Number(l.length_m) > 0 ? Math.round((Number(l.line_total) / Number(l.length_m)) * 10000) / 10000 : Number(l.unit_price),
    lineTotal: Number(l.line_total ?? Number(l.unit_price) * Number(l.length_m)),
  }));
  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;

  const created = await createPurchaseInvoice(client, companyId, userId, {
    invoiceNo: 'AUTO',
    invoiceDate: todayYmd(),
    supplierId: slip.supplier_id,
    warehouseId: slip.warehouse_id,
    currencyCode: 'USD',
    subtotal,
    discountTotal: 0,
    taxTotal: 0,
    totalAmount: subtotal,
    paidAmount: 0,
    remainingAmount: subtotal,
    notes: `مُرحَّلة تلقائياً من إرسالية شراء رقم ${slip.slip_no}`,
    lines,
    confirm: false,
  });

  await confirmPurchaseInvoice(client, companyId, userId, created.id, { skipStockMovement: true });

  await client.query(`UPDATE intake_dispatch_slips SET purchase_invoice_id=$1, updated_at=now() WHERE id=$2`, [
    created.id,
    slipId,
  ]);

  return created;
}

/**
 * إرسالية «إنشاء مادة جديدة»: بعد إضافة الأتواب كإنشاء ينتهي المسار بإرسالية قابلة للطباعة بالأتواب المضافة.
 * لا مورد ولا فاتورة؛ التسعير يُضاف لاحقاً. تُرفض أتواب غير موجودة/من فرع آخر.
 */
export async function createItemCreationSlip(
  client: PoolClient,
  input: { companyId: string; userId: string | null; rollIds: string[] },
): Promise<{ id: string; slipNo: string; lineCount: number }> {
  const ids = [...new Set(input.rollIds)];
  if (!ids.length) throw Object.assign(new Error('لا أتواب للإرسالية'), { code: 'VALIDATION' });
  if (ids.length > 1000) throw Object.assign(new Error('عدد الأتواب كبير'), { code: 'VALIDATION' });
  const rolls = await client.query<{ id: string; warehouse_id: string }>(
    `SELECT id, warehouse_id FROM fabric_rolls WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at`,
    [input.companyId, ids],
  );
  if (rolls.rows.length !== ids.length) throw Object.assign(new Error('بعض الأتواب غير موجودة'), { code: 'NOT_FOUND' });
  const warehouseId = rolls.rows[0].warehouse_id;
  const slipNo = await generateSequentialDocumentNo(client, input.companyId, 'INTAKE_DISPATCH_SLIP');
  const slip = await client.query<{ id: string }>(
    `INSERT INTO intake_dispatch_slips (company_id, intake_operation_id, slip_no, slip_type, warehouse_id, supplier_id, created_by_user_id)
     VALUES ($1, NULL, $2, 'ITEM_CREATION', $3, NULL, $4) RETURNING id`,
    [input.companyId, slipNo, warehouseId, input.userId],
  );
  for (const r of rolls.rows) {
    await client.query('INSERT INTO intake_dispatch_slip_lines (slip_id, fabric_roll_id) VALUES ($1, $2)', [slip.rows[0].id, r.id]);
  }
  return { id: slip.rows[0].id, slipNo, lineCount: rolls.rows.length };
}
