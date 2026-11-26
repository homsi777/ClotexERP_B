import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { receiveFabricRoll, receiveYarnLot } from './purchaseInvoiceService.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
const fail = (m: string, code = 'VALIDATION') => Object.assign(new Error(m), { code });
const EPS = 0.0005;
const YARD = 0.9144;
const text = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? n : null; };

export type LineStatus = 'NOT_RECEIVED' | 'PARTIAL' | 'COMPLETE' | 'OVER';
export const statusOf = (invoiced: number, received: number): LineStatus =>
  received <= EPS ? 'NOT_RECEIVED' : received < invoiced - EPS ? 'PARTIAL' : received > invoiced + EPS ? 'OVER' : 'COMPLETE';

/** الكمية بوحدة الفاتورة: نفس الوحدة، أو متر↔ياردة تلقائياً، وإلا معامل تحويل صريح (أو الكمية بوحدة الفاتورة مباشرة). */
export function toInvoiceUnit(q: number, from: string, to: string, factor?: number | null, explicit?: number | null): { qty: number; factor: number | null } {
  if (explicit != null && explicit >= 0) return { qty: explicit, factor: q > 0 ? explicit / q : null };
  if (from === to) return { qty: q, factor: 1 };
  if (from === 'yard' && to === 'meter') return { qty: q * YARD, factor: YARD };
  if (from === 'meter' && to === 'yard') return { qty: q / YARD, factor: 1 / YARD };
  if (factor != null && factor > 0) return { qty: q * factor, factor };
  throw fail(`وحدة الاستلام (${from}) تخالف وحدة الفاتورة (${to}): سجّل معامل التحويل المعتمد أو الكمية بوحدة الفاتورة`);
}

/* ───── العرض للمخزن: لا أسعار ولا إجماليات ولا خصومات ولا ضرائب ولا دفع — الأعمدة المالية لا تُستعلَم أصلاً ───── */
export interface ReceivingLine {
  id: string; lineNo: number; description: string; materialKind: 'FABRIC' | 'YARN' | 'OTHER'; unit: string; quantity: number; received: number; remaining: number; diff: number;
  status: LineStatus; autoReceived: boolean; warehouseId: string | null; warehouseName: string | null; details: Record<string, unknown>;
}
export interface ReceivingInvoice {
  id: string; invoiceNo: string; supplierInvoiceNo: string | null; invoiceDate: string; supplierId: string; supplierName: string; documentStatus: string; receiveViaWarehouse: boolean;
  lines: ReceivingLine[]; overall: LineStatus;
}
const SAFE_META = ['materialName', 'designCode', 'colorName', 'colorCode', 'widthCm', 'gsm', 'lotNo', 'note'];

const kindOf = (unit: string, stored: string | null, hasYarn: boolean): 'FABRIC' | 'YARN' | 'OTHER' =>
  (stored as 'FABRIC' | 'YARN' | 'OTHER' | null) ?? (unit === 'package' || unit === 'piece' ? 'OTHER' : unit === 'kg' ? (hasYarn ? 'YARN' : 'YARN') : 'FABRIC');

export async function listReceivingInvoices(db: Db, companyId: string, f: {
  search?: string; supplierId?: string; from?: string; to?: string; warehouseId?: string; materialKind?: string; status?: string; invoiceStatus?: string; id?: string; limit?: number;
}): Promise<ReceivingInvoice[]> {
  const inv = (await db.query<Record<string, unknown>>(
    `SELECT i.id, i.invoice_no, i.supplier_invoice_no, i.invoice_date::text AS invoice_date, i.supplier_id, s.name AS supplier_name, i.document_status, i.receive_via_warehouse
       FROM purchase_invoices i JOIN suppliers s ON s.id=i.supplier_id
      WHERE i.company_id=$1 AND i.document_status <> 'VOIDED' AND ($2::uuid IS NULL OR i.id=$2)
        AND ($3::text IS NULL OR i.invoice_no ILIKE $3 OR COALESCE(i.supplier_invoice_no,'') ILIKE $3 OR s.name ILIKE $3)
        AND ($4::uuid IS NULL OR i.supplier_id=$4) AND ($5::date IS NULL OR i.invoice_date >= $5::date) AND ($6::date IS NULL OR i.invoice_date <= $6::date)
        AND ($7::text IS NULL OR i.document_status=$7)
      ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT ${Math.min(Math.max(f.limit ?? 100, 1), 300)}`,
    [companyId, f.id ?? null, f.search?.trim() ? `%${f.search.trim()}%` : null, f.supplierId ?? null, f.from ?? null, f.to ?? null, f.invoiceStatus ?? null])).rows;
  if (!inv.length) return [];
  const ids = inv.map((r) => String(r.id));
  const lines = (await db.query<Record<string, unknown>>(
    `SELECT l.id, l.invoice_id, l.line_no, l.description, l.unit, l.material_kind, l.quantity::float AS quantity, l.warehouse_id, w.name AS warehouse_name, l.metadata,
            (l.fabric_roll_id IS NOT NULL OR l.yarn_lot_id IS NOT NULL) AS stocked,
            COALESCE((SELECT sum(rl.quantity_in_invoice_unit) FROM purchase_receipt_lines rl JOIN purchase_receipts r ON r.id=rl.receipt_id AND r.status <> 'CANCELLED'
                       WHERE rl.company_id=l.company_id AND rl.invoice_line_id=l.id),0)::float AS received
       FROM purchase_invoice_lines l LEFT JOIN warehouses w ON w.id=l.warehouse_id
      WHERE l.company_id=$1 AND l.invoice_id = ANY($2::uuid[]) ORDER BY l.invoice_id, l.line_no`, [companyId, ids])).rows;
  const byInv = new Map<string, ReceivingLine[]>();
  const viaWh = new Map(inv.map((r) => [String(r.id), Boolean(r.receive_via_warehouse)]));
  const docSt = new Map(inv.map((r) => [String(r.id), String(r.document_status)]));
  for (const l of lines) {
    const unit = String(l.unit);
    const iid = String(l.invoice_id);
    // فاتورة بالاستلام التلقائي (القديم): سطور المتر/الياردة/الكيلو يُنشئ التأكيد مخزونها مباشرة فتُعدّ مستلمة كاملة؛ الطرد/القطعة تُتتبَّع بالاستلام.
    const auto = !viaWh.get(iid) && docSt.get(iid) === 'CONFIRMED' && ['meter', 'yard', 'kg'].includes(unit) && Boolean(l.stocked);
    const qty = Number(l.quantity);
    const received = auto ? qty : Number(l.received);
    const meta = (l.metadata as Record<string, unknown>) ?? {};
    const details: Record<string, unknown> = {};
    for (const k of SAFE_META) if (meta[k] != null && meta[k] !== '') details[k] = meta[k];
    const row: ReceivingLine = {
      id: String(l.id), lineNo: Number(l.line_no), description: String(l.description ?? ''), materialKind: kindOf(unit, (l.material_kind as string | null) ?? null, true), unit, quantity: qty,
      received: Math.round(received * 1000) / 1000, remaining: Math.max(0, Math.round((qty - received) * 1000) / 1000), diff: Math.round((received - qty) * 1000) / 1000,
      status: statusOf(qty, received), autoReceived: auto, warehouseId: (l.warehouse_id as string | null) ?? null, warehouseName: (l.warehouse_name as string | null) ?? null, details,
    };
    (byInv.get(iid) ?? byInv.set(iid, []).get(iid)!).push(row);
  }
  const rank: Record<LineStatus, number> = { NOT_RECEIVED: 0, PARTIAL: 1, OVER: 2, COMPLETE: 3 };
  let out: ReceivingInvoice[] = inv.map((r) => {
    const ls = byInv.get(String(r.id)) ?? [];
    const worst = ls.length ? ls.map((l) => l.status).reduce((a, b) => (rank[a] <= rank[b] ? a : b)) : 'COMPLETE';
    const tot = ls.reduce((a, l) => ({ q: a.q + l.quantity, r: a.r + Math.min(l.received, l.quantity) }), { q: 0, r: 0 });
    const overall: LineStatus = ls.some((l) => l.status === 'OVER') && ls.every((l) => l.status === 'COMPLETE' || l.status === 'OVER') ? 'OVER' : tot.r <= EPS ? 'NOT_RECEIVED' : worst === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL';
    return { id: String(r.id), invoiceNo: String(r.invoice_no), supplierInvoiceNo: (r.supplier_invoice_no as string | null) ?? null, invoiceDate: String(r.invoice_date), supplierId: String(r.supplier_id), supplierName: String(r.supplier_name), documentStatus: String(r.document_status), receiveViaWarehouse: Boolean(r.receive_via_warehouse), lines: ls, overall };
  });
  if (f.warehouseId) out = out.filter((i) => i.lines.some((l) => !l.warehouseId || l.warehouseId === f.warehouseId));
  if (f.materialKind) out = out.filter((i) => i.lines.some((l) => l.materialKind === f.materialKind));
  if (f.status) out = out.filter((i) => i.overall === f.status);
  return out;
}

export interface ReceiptView { id: string; receiptNo: string; invoiceId: string | null; invoiceNo: string | null; supplierName: string | null; warehouseName: string; status: string; notes: string | null; createdAt: string; createdBy: string | null; linkedAt: string | null;
  lines: Array<{ id: string; invoiceLineId: string | null; description: string; materialKind: string; unit: string; quantity: number; quantityInInvoiceUnit: number; conversionFactor: number | null; packageCount: number | null; details: Record<string, unknown>; rolls: number; lots: number }> }

export async function listReceipts(db: Db, companyId: string, f: { invoiceId?: string; pending?: boolean; limit?: number } = {}): Promise<ReceiptView[]> {
  const rs = (await db.query<Record<string, unknown>>(
    `SELECT r.id, r.receipt_no, r.invoice_id, i.invoice_no, s.name AS supplier_name, COALESCE(w.name, ow.name) AS warehouse_name, r.status, r.notes, r.created_at, COALESCE(u.full_name,u.username) AS by, r.linked_at
       FROM purchase_receipts r LEFT JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN operating_warehouses ow ON ow.id=r.operating_warehouse_id LEFT JOIN purchase_invoices i ON i.id=r.invoice_id LEFT JOIN suppliers s ON s.id=COALESCE(r.supplier_id, i.supplier_id) LEFT JOIN users u ON u.id=r.created_by_user_id
      WHERE r.company_id=$1 AND ($2::uuid IS NULL OR r.invoice_id=$2) AND ($3::boolean IS NOT TRUE OR r.status='PENDING_INVOICE') ORDER BY r.created_at DESC LIMIT ${Math.min(Math.max(f.limit ?? 100, 1), 300)}`,
    [companyId, f.invoiceId ?? null, f.pending === true])).rows;
  if (!rs.length) return [];
  const ls = (await db.query<Record<string, unknown>>(
    `SELECT id, receipt_id, invoice_line_id, description, material_kind, unit, quantity::float AS q, quantity_in_invoice_unit::float AS qi, conversion_factor::float AS cf, package_count::float AS pc, details, cardinality(roll_ids) AS rolls, cardinality(yarn_lot_ids) AS lots
       FROM purchase_receipt_lines WHERE company_id=$1 AND receipt_id = ANY($2::uuid[]) ORDER BY created_at`, [companyId, rs.map((r) => String(r.id))])).rows;
  return rs.map((r) => ({
    id: String(r.id), receiptNo: String(r.receipt_no), invoiceId: (r.invoice_id as string | null) ?? null, invoiceNo: (r.invoice_no as string | null) ?? null, supplierName: (r.supplier_name as string | null) ?? null, warehouseName: String(r.warehouse_name),
    status: String(r.status), notes: (r.notes as string | null) ?? null, createdAt: String(r.created_at), createdBy: (r.by as string | null) ?? null, linkedAt: r.linked_at ? String(r.linked_at) : null,
    lines: ls.filter((l) => String(l.receipt_id) === String(r.id)).map((l) => ({ id: String(l.id), invoiceLineId: (l.invoice_line_id as string | null) ?? null, description: String(l.description), materialKind: String(l.material_kind), unit: String(l.unit), quantity: Number(l.q), quantityInInvoiceUnit: Number(l.qi), conversionFactor: l.cf == null ? null : Number(l.cf), packageCount: l.pc == null ? null : Number(l.pc), details: (l.details as Record<string, unknown>) ?? {}, rolls: Number(l.rolls), lots: Number(l.lots) })),
  }));
}

/* ───── إنشاء استلام ───── */
const rollIn = z.object({ barcode: z.string().trim().max(60).optional(), lengthM: z.coerce.number().positive().optional(), weightKg: z.coerce.number().positive().optional(), widthCm: z.coerce.number().positive().optional(), gsm: z.coerce.number().positive().optional(),
  lotNo: z.string().trim().max(60).optional(), colorName: z.string().trim().max(120).optional(), colorCode: z.string().trim().max(60).optional(), designCode: z.string().trim().max(60).optional(), materialName: z.string().trim().max(200).optional(), locationId: z.string().uuid().optional() }).strict();
const lotIn = z.object({ weightKg: z.coerce.number().positive(), lotNo: z.string().trim().max(60).optional(), batchNo: z.string().trim().max(60).optional(), colorName: z.string().trim().max(120).optional(), colorCode: z.string().trim().max(60).optional(), designCode: z.string().trim().max(60).optional(), materialName: z.string().trim().max(200).optional(), packages: z.coerce.number().nonnegative().optional(), locationId: z.string().uuid().optional() }).strict();
const lineIn = z.object({
  invoiceLineId: z.string().uuid().nullable().optional(), description: z.string().trim().max(300).optional(), materialKind: z.enum(['FABRIC', 'YARN', 'OTHER']).optional(),
  unit: z.enum(['meter', 'yard', 'kg', 'package', 'piece']), quantity: z.coerce.number().positive().optional(), conversionFactor: z.coerce.number().positive().optional(), quantityInInvoiceUnit: z.coerce.number().nonnegative().optional(),
  packageCount: z.coerce.number().nonnegative().optional(), catalogItemId: z.string().uuid().nullable().optional(), operatingWarehouseId: z.string().uuid().nullable().optional(), locationId: z.string().uuid().nullable().optional(), rolls: z.array(rollIn).max(500).optional(), lots: z.array(lotIn).max(200).optional(),
}).strict();
export const receiptInput = z.object({ invoiceId: z.string().uuid().nullable().optional(), supplierId: z.string().uuid().nullable().optional(), warehouseId: z.string().uuid().nullable().optional(), notes: z.string().trim().max(500).optional(), lines: z.array(lineIn).min(1).max(100) }).strict();
export type ReceiptInput = z.infer<typeof receiptInput>;

interface InvRow { id: string; invoice_no: string; supplier_id: string; currency_code: string; receive_via_warehouse: boolean; document_status: string }
interface InvLineRow { id: string; invoice_id: string; line_no: number; unit: string; quantity: string; unit_cost: string; description: string; material_kind: string | null; metadata: Record<string, unknown>; warehouse_id: string | null; catalog_item_id?: string | null }

export async function createReceipt(client: PoolClient, companyId: string, userId: string, raw: unknown, opts: { warehouseScope?: string[] | null } = {}): Promise<{ id: string; receiptNo: string; status: string }> {
  const parsed = receiptInput.safeParse(raw);
  if (!parsed.success) throw fail('بيانات الاستلام غير صالحة');
  const d = parsed.data;
  // مواد تشغيلية فقط (OTHER) تُستلم في مستودع تشغيلي ولا تتطلب مستودع أقمشة
  const onlyOther = d.lines.every((l) => (l.materialKind ?? 'OTHER') === 'OTHER' && l.materialKind === 'OTHER');
  if (!d.warehouseId && !onlyOther) throw fail('اختر المخزن');
  if (d.warehouseId) {
    if (opts.warehouseScope && !opts.warehouseScope.includes(d.warehouseId)) throw fail('هذا المستودع خارج المستودعات المسموحة لك', 'FORBIDDEN');
    const wh = await client.query('SELECT 1 FROM warehouses WHERE id=$1 AND company_id=$2', [d.warehouseId, companyId]);
    if (!wh.rows.length) throw fail('المستودع غير موجود', 'NOT_FOUND');
  }

  let inv: InvRow | null = null;
  if (d.invoiceId) {
    inv = (await client.query<InvRow>('SELECT id, invoice_no, supplier_id, currency_code, receive_via_warehouse, document_status FROM purchase_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE', [d.invoiceId, companyId])).rows[0] ?? null;
    if (!inv) throw fail('فاتورة الشراء غير موجودة', 'NOT_FOUND');
    if (inv.document_status === 'VOIDED') throw fail('الفاتورة ملغاة');
  } else if (d.supplierId) {
    if (!(await client.query('SELECT 1 FROM suppliers WHERE id=$1 AND company_id=$2', [d.supplierId, companyId])).rows.length) throw fail('المورد غير موجود', 'NOT_FOUND');
  }

  const receiptNo = await generateSequentialDocumentNo(client, companyId, 'PURCHASE_RECEIPT');
  const rIns = await client.query<{ id: string }>(
    `INSERT INTO purchase_receipts (company_id, receipt_no, invoice_id, supplier_id, warehouse_id, status, notes, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, receiptNo, inv?.id ?? null, inv?.supplier_id ?? d.supplierId ?? null, d.warehouseId ?? null, inv ? 'RECEIVED' : 'PENDING_INVOICE', d.notes ?? null, userId]);
  const receiptId = rIns.rows[0].id;
  const supplierId = inv?.supplier_id ?? d.supplierId ?? null;

  for (const ln of d.lines) {
    let il: InvLineRow | null = null;
    if (ln.invoiceLineId) {
      if (!inv) throw fail('بند الفاتورة يتطلب تحديد الفاتورة');
      il = (await client.query<InvLineRow>('SELECT id, invoice_id, line_no, unit, quantity::text, unit_cost::text, description, material_kind, metadata, warehouse_id, catalog_item_id FROM purchase_invoice_lines WHERE id=$1 AND company_id=$2 AND invoice_id=$3 FOR UPDATE', [ln.invoiceLineId, companyId, inv.id])).rows[0] ?? null;
      if (!il) throw fail('بند الفاتورة غير موجود في هذه الفاتورة', 'NOT_FOUND');
      // فاتورة بالاستلام التلقائي: أتواب/دفعات سطورها أُنشئت عند التأكيد؛ لا نكرّر المخزون إلا لسطور الطرد/القطعة (تتبع كمية فقط)
      if (!inv.receive_via_warehouse && !['package', 'piece'].includes(il.unit)) throw fail('هذه الفاتورة بالاستلام التلقائي: مخزونها أُنشئ عند التأكيد ولا يُسجَّل لها استلام ثانٍ');
    }
    const meta = (il?.metadata ?? {}) as Record<string, unknown>;
    const kind = ln.materialKind ?? (il ? kindOf(il.unit, il.material_kind, true) : ln.unit === 'package' || ln.unit === 'piece' ? 'OTHER' : ln.unit === 'kg' ? 'YARN' : 'FABRIC');
    // القماش يُقاس بوحدة بند الفاتورة (متر/ياردة/كيلو) فلا يختلف الاستلام عن الفاتورة بسبب وحدة الإدخال
    const unit = kind === 'FABRIC' && il ? il.unit : ln.unit;
    const description = ln.description ?? il?.description ?? '';
    const lineUnitCost = il ? Number(il.unit_cost) : null;
    const ccy = inv?.currency_code ?? null;
    const rollIds: string[] = [], lotIds: string[] = [];
    let qty = ln.quantity ?? 0;

    if (kind === 'FABRIC') {
      if (!ln.rolls?.length) throw fail('سطر القماش يتطلب بيانات الأتواب (الباركود والطول أو الوزن)');
      let totalIn = 0;
      for (const r of ln.rolls) {
        const width = r.widthCm ?? num(meta.widthCm), gsm = r.gsm ?? num(meta.gsm);
        let lengthM = r.lengthM ?? 0;
        // الاستلام بالكيلو: الطول = الوزن × 1000 ÷ (العرض بالمتر × gsm)
        if (!(lengthM > 0) && r.weightKg && width && gsm) lengthM = (r.weightKg * 1000) / ((width / 100) * gsm);
        if (!(lengthM > 0)) throw fail('كل توب يتطلب الطول، أو الوزن مع العرض والوزن النوعي (gsm) لاشتقاق الطول');
        lengthM = Math.round(lengthM * 1000) / 1000;
        let costPerM: number | null = null;
        if (il && lineUnitCost && lineUnitCost > 0) {
          if (il.unit === 'meter') costPerM = lineUnitCost; else if (il.unit === 'yard') costPerM = lineUnitCost / YARD;
          else if (il.unit === 'kg' && r.weightKg) costPerM = (lineUnitCost * r.weightKg) / lengthM;
        }
        const made = await receiveFabricRoll(client, companyId, userId, {
          receiptId, receiptNo, invoiceNo: inv?.invoice_no ?? null, supplierId, warehouseId: d.warehouseId as string, locationId: r.locationId ?? ln.locationId ?? null,
          materialName: r.materialName ?? text(meta.materialName ?? meta.fabricName ?? description), designCode: r.designCode ?? text(meta.designCode ?? meta.dsamNumber), colorName: r.colorName ?? text(meta.colorName), colorCode: r.colorCode ?? text(meta.colorCode),
          widthCm: width, gsm, lengthM, weightKg: r.weightKg ?? null, barcode: r.barcode, lotNo: r.lotNo ?? text(meta.lotNo), unitCostPerMeter: costPerM, currency: ccy, note: description,
        });
        rollIds.push(made.rollId);
        if (unit === 'kg' && !r.weightKg) throw fail('بند الفاتورة بالكيلو: سجّل وزن كل توب');
        totalIn += unit === 'kg' ? (r.weightKg ?? 0) : unit === 'yard' ? lengthM / YARD : lengthM;
      }
      qty = Math.round(totalIn * 1000) / 1000;
      if (!(qty > 0)) throw fail('كمية الاستلام صفر');
    } else if (kind === 'YARN') {
      if (!ln.lots?.length) throw fail('سطر الخيط يتطلب بيانات الدفعات (الوزن الفعلي والوط)');
      let kg = 0, pk = 0;
      for (const l of ln.lots) {
        const made = await receiveYarnLot(client, companyId, userId, {
          receiptId, receiptNo, invoiceId: inv?.id ?? null, invoiceLineId: il?.id ?? null, invoiceNo: inv?.invoice_no ?? null, supplierId, warehouseId: d.warehouseId as string, locationId: l.locationId ?? ln.locationId ?? null,
          materialName: l.materialName ?? text(meta.materialName ?? description), designCode: l.designCode ?? text(meta.designCode), colorName: l.colorName ?? text(meta.colorName), colorCode: l.colorCode ?? text(meta.colorCode),
          weightKg: l.weightKg, lotNo: l.lotNo, batchNo: l.batchNo, unitCostPerKg: il && il.unit === 'kg' ? lineUnitCost : null, currency: ccy, note: description,
        });
        lotIds.push(made.lotId); kg += l.weightKg; pk += l.packages ?? 0;
      }
      qty = unit === 'package' ? (ln.quantity ?? pk) : kg;
      if (!(qty > 0)) throw fail('كمية الاستلام صفر');
    } else if (!(qty > 0)) throw fail('الكمية المستلمة مطلوبة');

    // المواد الأخرى: تدخل المستودع التشغيلي (منفصل عن مستودعات الأقمشة) إن حُدّد المستودع والبند المرجعي
    let catalogItemId: string | null = null, opWhId: string | null = null;
    if (kind === 'OTHER') {
      catalogItemId = ln.catalogItemId ?? il?.catalog_item_id ?? null;
      if (catalogItemId) {
        const ci = (await client.query<{ operating_warehouse_id: string | null }>('SELECT operating_warehouse_id FROM purchase_catalog_items WHERE id=$1 AND company_id=$2', [catalogItemId, companyId])).rows[0];
        if (!ci) throw fail('البند المرجعي غير موجود', 'NOT_FOUND');
        opWhId = ln.operatingWarehouseId ?? ci.operating_warehouse_id;
      }
      if (opWhId && catalogItemId) {
        if (!(await client.query('SELECT 1 FROM operating_warehouses WHERE id=$1 AND company_id=$2 AND is_active', [opWhId, companyId])).rows.length) throw fail('المستودع التشغيلي غير موجود أو غير فعّال', 'NOT_FOUND');
        await client.query(
          `INSERT INTO operating_stock (company_id, warehouse_id, catalog_item_id, quantity) VALUES ($1,$2,$3,$4)
           ON CONFLICT (warehouse_id, catalog_item_id) DO UPDATE SET quantity = operating_stock.quantity + EXCLUDED.quantity, updated_at = now()`, [companyId, opWhId, catalogItemId, qty]);
        await client.query(
          `INSERT INTO operating_stock_movements (company_id, warehouse_id, catalog_item_id, movement_type, quantity, unit, receipt_id, notes, created_by_user_id) VALUES ($1,$2,$3,'RECEIPT',$4,$5,$6,$7,$8)`,
          [companyId, opWhId, catalogItemId, qty, unit, receiptId, `استلام ${receiptNo}`, userId]);
        await client.query('UPDATE purchase_receipts SET operating_warehouse_id=COALESCE(operating_warehouse_id,$3) WHERE id=$1 AND company_id=$2', [receiptId, companyId, opWhId]);
      }
    }

    // مقارنة بوحدة الفاتورة (إن وُجد بند)
    const conv = il ? toInvoiceUnit(qty, unit, il.unit, ln.conversionFactor, ln.quantityInInvoiceUnit) : { qty, factor: null };
    await client.query(
      `INSERT INTO purchase_receipt_lines (company_id, receipt_id, invoice_line_id, description, material_kind, unit, quantity, quantity_in_invoice_unit, conversion_factor, package_count, location_id, details, roll_ids, yarn_lot_ids, catalog_item_id, operating_warehouse_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::uuid[],$14::uuid[],$15,$16)`,
      [companyId, receiptId, il?.id ?? null, description, kind, unit, qty, Math.round(conv.qty * 1000) / 1000, conv.factor, ln.packageCount ?? null, ln.locationId ?? null,
        JSON.stringify({ rolls: ln.rolls?.length ?? 0, lots: ln.lots?.length ?? 0, supplierSideUnit: il?.unit ?? null }), rollIds, lotIds, catalogItemId, opWhId]);
    if (il && !il.warehouse_id && d.warehouseId) await client.query('UPDATE purchase_invoice_lines SET warehouse_id=$3 WHERE id=$1 AND company_id=$2', [il.id, companyId, d.warehouseId]);
  }
  return { id: receiptId, receiptNo, status: inv ? 'RECEIVED' : 'PENDING_INVOICE' };
}

/** ربط استلام معلّق بفاتورة وصلت لاحقاً: لا قيد مالي؛ تُحدَّث تكلفة الأتواب/الدفعات من بند الفاتورة. */
export async function linkReceiptToInvoice(client: PoolClient, companyId: string, userId: string, receiptId: string, invoiceId: string, map: Array<{ receiptLineId: string; invoiceLineId: string; conversionFactor?: number; quantityInInvoiceUnit?: number }>): Promise<void> {
  const r = (await client.query<{ id: string; status: string; supplier_id: string | null }>('SELECT id, status, supplier_id FROM purchase_receipts WHERE id=$1 AND company_id=$2 FOR UPDATE', [receiptId, companyId])).rows[0];
  if (!r) throw fail('الاستلام غير موجود', 'NOT_FOUND');
  if (r.status !== 'PENDING_INVOICE') throw fail('هذا الاستلام مرتبط بفاتورة أصلاً أو ملغى');
  const inv = (await client.query<{ id: string; invoice_no: string; supplier_id: string; currency_code: string; receive_via_warehouse: boolean; document_status: string }>('SELECT id, invoice_no, supplier_id, currency_code, receive_via_warehouse, document_status FROM purchase_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE', [invoiceId, companyId])).rows[0];
  if (!inv) throw fail('الفاتورة غير موجودة', 'NOT_FOUND');
  if (inv.document_status === 'VOIDED') throw fail('الفاتورة ملغاة');
  if (!inv.receive_via_warehouse) throw fail('الربط يتطلب فاتورة بوضع «استلام عبر المخزن» (وإلا تكرر المخزون)');
  if (r.supplier_id && r.supplier_id !== inv.supplier_id) throw fail('مورد الفاتورة يخالف مورد الاستلام');
  const lines = (await client.query<{ id: string; unit: string; material_kind: string; quantity: string; roll_ids: string[]; yarn_lot_ids: string[] }>('SELECT id, unit, material_kind, quantity::text, roll_ids, yarn_lot_ids FROM purchase_receipt_lines WHERE receipt_id=$1 AND company_id=$2', [receiptId, companyId])).rows;
  if (!map.length || map.length !== lines.length) throw fail('اربط كل بنود الاستلام ببنود الفاتورة');
  for (const m of map) {
    const rl = lines.find((x) => x.id === m.receiptLineId);
    if (!rl) throw fail('بند استلام غير موجود', 'NOT_FOUND');
    const il = (await client.query<InvLineRow>('SELECT id, invoice_id, line_no, unit, quantity::text, unit_cost::text, description, material_kind, metadata, warehouse_id FROM purchase_invoice_lines WHERE id=$1 AND company_id=$2 AND invoice_id=$3', [m.invoiceLineId, companyId, invoiceId])).rows[0];
    if (!il) throw fail('بند الفاتورة غير موجود في الفاتورة المحددة', 'NOT_FOUND');
    const conv = toInvoiceUnit(Number(rl.quantity), rl.unit, il.unit, m.conversionFactor, m.quantityInInvoiceUnit);
    await client.query('UPDATE purchase_receipt_lines SET invoice_line_id=$3, quantity_in_invoice_unit=$4, conversion_factor=$5 WHERE id=$1 AND company_id=$2', [rl.id, companyId, il.id, Math.round(conv.qty * 1000) / 1000, conv.factor]);
    const cost = Number(il.unit_cost);
    if (cost > 0) {
      for (const rid of rl.roll_ids) {
        const roll = (await client.query<{ length_m: string; actual_weight_kg: string | null }>('SELECT length_m::text, actual_weight_kg::text FROM fabric_rolls WHERE id=$1 AND company_id=$2', [rid, companyId])).rows[0];
        if (!roll) continue;
        const len = Number(roll.length_m);
        const perM = il.unit === 'meter' ? cost : il.unit === 'yard' ? cost / YARD : il.unit === 'kg' && roll.actual_weight_kg && len > 0 ? (cost * Number(roll.actual_weight_kg)) / len : null;
        await client.query('UPDATE fabric_rolls SET unit_cost=COALESCE($3, unit_cost), currency_code=COALESCE(currency_code,$4), purchase_invoice_no=$5, updated_at=now() WHERE id=$1 AND company_id=$2', [rid, companyId, perM, inv.currency_code, inv.invoice_no]);
      }
      if (il.unit === 'kg') for (const lid of rl.yarn_lot_ids) await client.query('UPDATE yarn_lots SET unit_cost=$3, currency_code=$4, purchase_invoice_id=$5, purchase_invoice_line_id=$6, updated_at=now() WHERE id=$1 AND company_id=$2', [lid, companyId, cost, inv.currency_code, invoiceId, il.id]);
    }
  }
  await client.query(`UPDATE purchase_receipts SET invoice_id=$3, status='RECEIVED', linked_by_user_id=$4, linked_at=now() WHERE id=$1 AND company_id=$2`, [receiptId, companyId, invoiceId, userId]);
}
