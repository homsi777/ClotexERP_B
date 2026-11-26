import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

type Db = Pool | PoolClient;
const fail = (message: string, code = 'VALIDATION') => Object.assign(new Error(message), { code });

/** كتالوج بنود المشتريات: مرجع ثابت للخامات/الخيوط/المواد يمنع تكرار البند بأسماء مختلفة. لا يحمل أي بيانات مالية. */
export const catalogInput = z.object({
  materialKind: z.enum(['FABRIC', 'YARN', 'OTHER']),
  name: z.string().trim().min(1, 'اسم البند مطلوب').max(200),
  defaultUnit: z.enum(['meter', 'yard', 'kg', 'package', 'piece']).default('meter'),
  designCode: z.string().trim().max(60).optional().nullable(),
  colorName: z.string().trim().max(120).optional().nullable(),
  colorCode: z.string().trim().max(60).optional().nullable(),
  widthCm: z.coerce.number().positive().optional().nullable(),
  gsm: z.coerce.number().positive().optional().nullable(),
  operatingWarehouseId: z.string().uuid().optional().nullable(),
}).strict();

export interface CatalogItem {
  id: string; materialKind: 'FABRIC' | 'YARN' | 'OTHER'; name: string; defaultUnit: string; designCode: string | null; colorName: string | null; colorCode: string | null;
  widthCm: number | null; gsm: number | null; operatingWarehouseId: string | null; operatingWarehouseName: string | null; isActive: boolean;
}

const map = (r: Record<string, unknown>): CatalogItem => ({
  id: String(r.id), materialKind: r.material_kind as CatalogItem['materialKind'], name: String(r.name), defaultUnit: String(r.default_unit),
  designCode: (r.design_code as string | null) ?? null, colorName: (r.color_name as string | null) ?? null, colorCode: (r.color_code as string | null) ?? null,
  widthCm: r.width_cm == null ? null : Number(r.width_cm), gsm: r.gsm == null ? null : Number(r.gsm),
  operatingWarehouseId: (r.operating_warehouse_id as string | null) ?? null, operatingWarehouseName: (r.operating_warehouse_name as string | null) ?? null, isActive: Boolean(r.is_active),
});

export async function listCatalog(db: Db, companyId: string, f: { kind?: string; search?: string; includeInactive?: boolean } = {}): Promise<CatalogItem[]> {
  const rs = await db.query(
    `SELECT c.*, ow.name AS operating_warehouse_name FROM purchase_catalog_items c LEFT JOIN operating_warehouses ow ON ow.id=c.operating_warehouse_id
      WHERE c.company_id=$1 AND ($2::text IS NULL OR c.material_kind=$2) AND ($3::boolean OR c.is_active)
        AND ($4::text IS NULL OR c.name ILIKE '%'||$4||'%' OR c.design_code ILIKE '%'||$4||'%' OR c.color_code ILIKE '%'||$4||'%')
      ORDER BY c.material_kind, c.name, c.color_code LIMIT 1000`,
    [companyId, f.kind ?? null, f.includeInactive === true, f.search?.trim() || null]);
  return rs.rows.map(map);
}

async function assertOperatingWarehouse(db: Db, companyId: string, id: string | null | undefined) {
  if (!id) return;
  if (!(await db.query('SELECT 1 FROM operating_warehouses WHERE id=$1 AND company_id=$2', [id, companyId])).rows.length) throw fail('المستودع التشغيلي غير موجود', 'NOT_FOUND');
}

export async function createCatalogItem(db: Db, companyId: string, userId: string, raw: unknown): Promise<CatalogItem> {
  const p = catalogInput.safeParse(raw);
  if (!p.success) throw fail(p.error.issues[0]?.message || 'بيانات البند غير صالحة');
  const d = p.data;
  await assertOperatingWarehouse(db, companyId, d.operatingWarehouseId);
  const dup = await db.query(
    `SELECT id FROM purchase_catalog_items WHERE company_id=$1 AND material_kind=$2 AND lower(name)=lower($3) AND lower(coalesce(design_code,''))=lower($4) AND lower(coalesce(color_code,''))=lower($5)`,
    [companyId, d.materialKind, d.name, d.designCode ?? '', d.colorCode ?? '']);
  if (dup.rows.length) throw fail('هذا البند موجود مسبقاً في القائمة المرجعية — اخترْه منها', 'DUPLICATE');
  const ins = await db.query<{ id: string }>(
    `INSERT INTO purchase_catalog_items (company_id, material_kind, name, default_unit, design_code, color_name, color_code, width_cm, gsm, operating_warehouse_id, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [companyId, d.materialKind, d.name, d.defaultUnit, d.designCode || null, d.colorName || null, d.colorCode || null, d.widthCm ?? null, d.gsm ?? null, d.operatingWarehouseId ?? null, userId]);
  return (await listCatalogById(db, companyId, ins.rows[0].id))!;
}

async function listCatalogById(db: Db, companyId: string, id: string) {
  const rs = await db.query(`SELECT c.*, ow.name AS operating_warehouse_name FROM purchase_catalog_items c LEFT JOIN operating_warehouses ow ON ow.id=c.operating_warehouse_id WHERE c.id=$1 AND c.company_id=$2`, [id, companyId]);
  return rs.rows[0] ? map(rs.rows[0]) : null;
}

/** تعديل المستودع التشغيلي الافتراضي أو الإخفاء فقط (الاسم والنوع ثابتان كمرجع). */
export async function updateCatalogItem(db: Db, companyId: string, id: string, raw: unknown): Promise<CatalogItem> {
  const p = z.object({ operatingWarehouseId: z.string().uuid().nullable().optional(), isActive: z.boolean().optional() }).strict().safeParse(raw);
  if (!p.success) throw fail('بيانات غير صالحة');
  await assertOperatingWarehouse(db, companyId, p.data.operatingWarehouseId);
  const r = await db.query(
    `UPDATE purchase_catalog_items SET operating_warehouse_id = CASE WHEN $3::boolean THEN $4::uuid ELSE operating_warehouse_id END, is_active = COALESCE($5, is_active), updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING id`,
    [id, companyId, p.data.operatingWarehouseId !== undefined, p.data.operatingWarehouseId ?? null, p.data.isActive ?? null]);
  if (!r.rows.length) throw fail('البند غير موجود', 'NOT_FOUND');
  return (await listCatalogById(db, companyId, id))!;
}

// ───────────── المستودعات التشغيلية ─────────────
export async function listOperatingWarehouses(db: Db, companyId: string, includeInactive = false) {
  const rs = await db.query(
    `SELECT w.id, w.name, w.notes, w.is_active, COALESCE((SELECT count(*) FROM operating_stock s WHERE s.warehouse_id=w.id AND s.quantity>0),0)::int AS items
       FROM operating_warehouses w WHERE w.company_id=$1 AND ($2::boolean OR w.is_active) ORDER BY w.name`, [companyId, includeInactive]);
  return rs.rows.map((r) => ({ id: String(r.id), name: String(r.name), notes: (r.notes as string | null) ?? null, isActive: Boolean(r.is_active), items: Number(r.items) }));
}

export async function createOperatingWarehouse(db: Db, companyId: string, raw: unknown) {
  const p = z.object({ name: z.string().trim().min(1, 'اسم المستودع مطلوب').max(120), notes: z.string().trim().max(300).optional().nullable() }).strict().safeParse(raw);
  if (!p.success) throw fail(p.error.issues[0]?.message || 'بيانات غير صالحة');
  if ((await db.query('SELECT 1 FROM operating_warehouses WHERE company_id=$1 AND lower(name)=lower($2)', [companyId, p.data.name])).rows.length) throw fail('يوجد مستودع تشغيلي بهذا الاسم', 'DUPLICATE');
  const r = await db.query<{ id: string }>('INSERT INTO operating_warehouses (company_id, name, notes) VALUES ($1,$2,$3) RETURNING id', [companyId, p.data.name, p.data.notes || null]);
  return { id: r.rows[0].id, name: p.data.name };
}

export async function listOperatingStock(db: Db, companyId: string, warehouseId: string) {
  const rs = await db.query(
    `SELECT s.catalog_item_id, s.quantity::float AS quantity, c.name, c.default_unit, c.design_code, c.color_name, c.color_code,
            COALESCE((SELECT sum(m.quantity) FROM operating_stock_movements m WHERE m.warehouse_id=s.warehouse_id AND m.catalog_item_id=s.catalog_item_id AND m.movement_type='RECEIPT'),0)::float AS received,
            COALESCE((SELECT sum(m.quantity) FROM operating_stock_movements m WHERE m.warehouse_id=s.warehouse_id AND m.catalog_item_id=s.catalog_item_id AND m.movement_type NOT IN ('RECEIPT','ADJUST_IN')),0)::float AS disposed
       FROM operating_stock s JOIN purchase_catalog_items c ON c.id=s.catalog_item_id
      WHERE s.company_id=$1 AND s.warehouse_id=$2 ORDER BY c.name`, [companyId, warehouseId]);
  return rs.rows.map((r) => ({ catalogItemId: String(r.catalog_item_id), name: String(r.name), unit: String(r.default_unit), designCode: (r.design_code as string | null) ?? null, colorName: (r.color_name as string | null) ?? null, colorCode: (r.color_code as string | null) ?? null, quantity: Number(r.quantity), received: Number(r.received), disposed: Number(r.disposed) }));
}

export async function listOperatingMovements(db: Db, companyId: string, warehouseId: string, catalogItemId?: string) {
  const rs = await db.query(
    `SELECT m.id, m.movement_type, m.quantity::float AS quantity, m.unit, m.notes, m.created_at, c.name, COALESCE(u.full_name,u.username) AS by
       FROM operating_stock_movements m JOIN purchase_catalog_items c ON c.id=m.catalog_item_id LEFT JOIN users u ON u.id=m.created_by_user_id
      WHERE m.company_id=$1 AND m.warehouse_id=$2 AND ($3::uuid IS NULL OR m.catalog_item_id=$3) ORDER BY m.created_at DESC LIMIT 300`, [companyId, warehouseId, catalogItemId ?? null]);
  return rs.rows.map((r) => ({ id: String(r.id), type: String(r.movement_type), quantity: Number(r.quantity), unit: String(r.unit), notes: (r.notes as string | null) ?? null, createdAt: String(r.created_at), itemName: String(r.name), by: (r.by as string | null) ?? null }));
}

/** تصريف من المستودع التشغيلي (استهلاك/تالف/إهداء/أخرى): لا يهبط الرصيد دون الصفر. */
export async function disposeOperatingStock(client: PoolClient, companyId: string, userId: string, raw: unknown) {
  const p = z.object({
    warehouseId: z.string().uuid(), catalogItemId: z.string().uuid(), quantity: z.coerce.number().positive('الكمية مطلوبة'),
    type: z.enum(['CONSUMPTION', 'WASTE', 'GIFT', 'OTHER_OUT']), notes: z.string().trim().max(300).optional(),
  }).strict().safeParse(raw);
  if (!p.success) throw fail(p.error.issues[0]?.message || 'بيانات غير صالحة');
  const d = p.data;
  const row = (await client.query<{ quantity: string; unit: string }>(
    `SELECT s.quantity::text, c.default_unit AS unit FROM operating_stock s JOIN purchase_catalog_items c ON c.id=s.catalog_item_id WHERE s.warehouse_id=$1 AND s.catalog_item_id=$2 AND s.company_id=$3 FOR UPDATE OF s`,
    [d.warehouseId, d.catalogItemId, companyId])).rows[0];
  if (!row) throw fail('هذه المادة غير موجودة في هذا المستودع', 'NOT_FOUND');
  if (Number(row.quantity) + 1e-9 < d.quantity) throw fail(`الرصيد المتاح ${Number(row.quantity)} فقط`);
  await client.query('UPDATE operating_stock SET quantity = quantity - $3, updated_at=now() WHERE warehouse_id=$1 AND catalog_item_id=$2', [d.warehouseId, d.catalogItemId, d.quantity]);
  await client.query(
    `INSERT INTO operating_stock_movements (company_id, warehouse_id, catalog_item_id, movement_type, quantity, unit, notes, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [companyId, d.warehouseId, d.catalogItemId, d.type, d.quantity, row.unit, d.notes ?? null, userId]);
  return { remaining: Math.round((Number(row.quantity) - d.quantity) * 1000) / 1000 };
}
