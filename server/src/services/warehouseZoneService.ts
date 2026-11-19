import type { PoolClient } from 'pg';
import { z } from 'zod';

/**
 * عنابر المستودع (TASK 024): العنبر = warehouse_locations، وموقع التوب = fabric_rolls.location_id (NULL = غير محدد).
 * تغيير الموقع يمسّ location_id فقط ويُسجَّل بحركة LOCATION_MOVE (delta=0): لا أمتار ولا حالة ولا تكلفة ولا حجز ولا رصيد.
 * كل كتابة داخل معاملة يملكها المستدعي.
 */

type Db = Pick<PoolClient, 'query'>;

export class ZoneError extends Error {
  constructor(message: string, public code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT', public barcodes?: string[]) {
    super(message);
  }
}

/** حالات الأتواب القابلة للتوزيع (المباعة/التالفة/غير الفعّالة لا تُوزَّع). */
const ASSIGNABLE = `('AVAILABLE','RESERVED')`;

const ROLL_SELECT = `
  SELECT fr.id, fr.barcode, fr.item_id, fi.name AS item_name, fr.color_id, fc.name_ar AS color_name, fc.color_code,
         fr.warehouse_id, wh.name AS warehouse_name,
         fr.length_m::float AS length_m, COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg)::float AS weight_kg,
         fr.created_at, fr.location_id, wl.name AS zone_name, fr.status
    FROM fabric_rolls fr
    JOIN fabric_items fi ON fi.id = fr.item_id
    JOIN warehouses wh ON wh.id=fr.warehouse_id AND wh.company_id=fr.company_id
    LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
    LEFT JOIN warehouse_locations wl ON wl.id = fr.location_id`;

export type ZoneRoll = {
  warehouse_id: string; warehouse_name: string;
  id: string; barcode: string; item_id: string; item_name: string; color_id: string | null; color_name: string | null; color_code: string | null;
  length_m: number; weight_kg: number | null; created_at: string; location_id: string | null; zone_name: string | null; status: string;
};

export function totalsOf(rolls: Pick<ZoneRoll, 'length_m' | 'weight_kg'>[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    count: rolls.length,
    meters: r2(rolls.reduce((s, r) => s + Number(r.length_m ?? 0), 0)),
    weightKg: r2(rolls.reduce((s, r) => s + Number(r.weight_kg ?? 0), 0)),
  };
}

async function loadWarehouse(db: Db, companyId: string, warehouseId: string) {
  const r = await db.query(`SELECT id, name, zones_enabled FROM warehouses WHERE id = $1 AND company_id = $2`, [warehouseId, companyId]);
  if (!r.rows.length) throw new ZoneError('المستودع غير موجود', 'NOT_FOUND');
  return r.rows[0] as { id: string; name: string; zones_enabled: boolean };
}

export async function setZonesEnabled(db: Db, companyId: string, warehouseId: string, enabled: boolean) {
  await loadWarehouse(db, companyId, warehouseId);
  await db.query(`UPDATE warehouses SET zones_enabled = $3, updated_at = now() WHERE id = $1 AND company_id = $2`, [warehouseId, companyId, enabled]);
  return { warehouseId, zonesEnabled: enabled };
}

/** ملخص المستودع: العنابر مع عدد الأتواب/الأمتار، وعدد «غير محدد». */
export async function zoneSummary(db: Db, companyId: string, warehouseId: string) {
  const wh = await loadWarehouse(db, companyId, warehouseId);
  const zones = await db.query(
    `SELECT wl.id, wl.code, wl.name, wl.is_active,
            COUNT(fr.id) FILTER (WHERE fr.status IN ${ASSIGNABLE})::int AS rolls,
            COALESCE(SUM(fr.length_m) FILTER (WHERE fr.status IN ${ASSIGNABLE}), 0)::float AS meters
       FROM warehouse_locations wl
       LEFT JOIN fabric_rolls fr ON fr.location_id = wl.id AND fr.company_id = wl.company_id
      WHERE wl.warehouse_id = $1 AND wl.company_id = $2
      GROUP BY wl.id ORDER BY wl.name`,
    [warehouseId, companyId],
  );
  const un = await db.query(
    `SELECT COUNT(*)::int AS rolls, COALESCE(SUM(length_m),0)::float AS meters FROM fabric_rolls
      WHERE company_id = $1 AND warehouse_id = $2 AND location_id IS NULL AND status IN ${ASSIGNABLE}`,
    [companyId, warehouseId],
  );
  return { warehouseId, warehouseName: wh.name, zonesEnabled: wh.zones_enabled, zones: zones.rows, unassigned: un.rows[0] as { rolls: number; meters: number } };
}

/** تنبيه المتابعة: المستودعات المفعَّلة فيها أتواب بلا عنبر (لا يوقف أي عملية). */
export async function pendingAlerts(db: Db, companyId: string) {
  const r = await db.query(
    `SELECT w.id AS warehouse_id, w.name, COUNT(fr.id)::int AS pending
       FROM warehouses w
       JOIN fabric_rolls fr ON fr.warehouse_id = w.id AND fr.company_id = w.company_id
      WHERE w.company_id = $1 AND w.zones_enabled = true AND fr.location_id IS NULL AND fr.status IN ${ASSIGNABLE}
      GROUP BY w.id, w.name HAVING COUNT(fr.id) > 0 ORDER BY w.name`,
    [companyId],
  );
  return r.rows as { warehouse_id: string; name: string; pending: number }[];
}

export const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PENDING') }),
  z.object({ type: z.literal('ZONE'), zoneId: z.string().uuid() }),
  z.object({ type: z.literal('REFERENCE'), referenceId: z.string().uuid() }),
]);
export const pickSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ALL') }),
  z.object({ mode: z.literal('ITEM'), itemId: z.string().uuid() }),
  z.object({ mode: z.literal('COLOR'), itemId: z.string().uuid(), colorId: z.string().uuid().nullable() }),
  z.object({ mode: z.literal('ROLLS'), barcodes: z.array(z.string().min(1)).max(2000) }),
]);
export type Scope = z.infer<typeof scopeSchema>;
export type Pick_ = z.infer<typeof pickSchema>;

/** كل أتواب النطاق (بلا ترقيم صفحات) — أساس التحديد الجماعي. */
export async function listScopeRolls(db: Db, companyId: string, warehouseId: string, scope: Scope): Promise<ZoneRoll[]> {
  const params: unknown[] = [companyId, warehouseId];
  let where = `fr.company_id = $1 AND fr.warehouse_id = $2 AND fr.status IN ${ASSIGNABLE}`;
  if (scope.type === 'PENDING') {
    where += ' AND fr.location_id IS NULL';
  } else if (scope.type === 'ZONE') {
    params.push(scope.zoneId);
    where += ` AND fr.location_id = $${params.length}`;
  } else {
    params.push(scope.referenceId);
    where += ` AND EXISTS (SELECT 1 FROM inventory_movements m WHERE m.roll_id = fr.id AND m.company_id = fr.company_id
                 AND m.reference_id = $${params.length} AND m.movement_type IN ('PURCHASE_RECEIPT','MANUAL_CREATE','OPENING'))`;
  }
  const r = await db.query(`${ROLL_SELECT} WHERE ${where} ORDER BY fi.name, fc.name_ar, fr.barcode`, params);
  return r.rows as ZoneRoll[];
}

/** يطبّق طريقة التحديد (خامة كاملة / لون من خامة / توب توب) على أتواب النطاق فقط، وكل توب مرة واحدة. */
export async function pickRolls(db: Db, companyId: string, warehouseId: string, scope: Scope, pick: Pick_) {
  const all = await listScopeRolls(db, companyId, warehouseId, scope);
  let rolls: ZoneRoll[];
  let rejected: string[] = [];
  if (pick.mode === 'ALL') rolls = all;
  else if (pick.mode === 'ITEM') rolls = all.filter((r) => r.item_id === pick.itemId);
  else if (pick.mode === 'COLOR') rolls = all.filter((r) => r.item_id === pick.itemId && (r.color_id ?? null) === pick.colorId);
  else {
    const byBarcode = new Map(all.map((r) => [r.barcode.toUpperCase(), r]));
    const seen = new Set<string>();
    rolls = [];
    for (const b of pick.barcodes) {
      const k = b.trim().toUpperCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const hit = byBarcode.get(k);
      if (hit) rolls.push(hit); else rejected.push(b.trim());
    }
  }
  return { rolls, rejected, totals: totalsOf(rolls) };
}

export const assignSchema = z.object({
  warehouseId: z.string().uuid(),
  toZoneId: z.string().uuid(),
  rollIds: z.array(z.string().uuid()).min(1, 'حدّد توباً واحداً على الأقل').max(5000),
  /** مصدر التحديد: PENDING | ANY | معرّف عنبر — يتحقق النظام أن الأتواب ما زالت فيه. */
  expectedFrom: z.union([z.literal('PENDING'), z.literal('ANY'), z.string().uuid()]),
  notes: z.string().max(300).optional().nullable(),
});

/** توزيع/نقل أتواب إلى عنبر: يتحقق من بقائها بمصدرها، ويسجّل حركة موقع لكل توب. ذرّية. */
export async function assignRolls(db: Db, companyId: string, userId: string | null, raw: unknown) {
  const p = assignSchema.safeParse(raw);
  if (!p.success) throw new ZoneError(p.error.issues[0]?.message ?? 'بيانات غير صالحة', 'VALIDATION');
  const d = p.data;
  const wh = await loadWarehouse(db, companyId, d.warehouseId);
  if (!wh.zones_enabled) throw new ZoneError('إدارة العنابر غير مفعّلة لهذا المستودع', 'VALIDATION');
  const zone = await db.query(`SELECT id, name, is_active FROM warehouse_locations WHERE id = $1 AND warehouse_id = $2 AND company_id = $3`, [d.toZoneId, d.warehouseId, companyId]);
  if (!zone.rows.length) throw new ZoneError('العنبر الوجهة غير موجود في هذا المستودع', 'NOT_FOUND');
  if (!zone.rows[0].is_active) throw new ZoneError('العنبر الوجهة غير فعّال', 'VALIDATION');
  if (d.expectedFrom === d.toZoneId) throw new ZoneError('العنبر المصدر هو نفسه الوجهة', 'VALIDATION');

  const ids = [...new Set(d.rollIds)].sort();
  const locked = await db.query(
    `SELECT id, barcode, warehouse_id, location_id, status FROM fabric_rolls
      WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [companyId, ids],
  );
  if (locked.rows.length !== ids.length) throw new ZoneError('بعض الأتواب غير موجودة', 'NOT_FOUND');

  const stale: string[] = [];
  for (const r of locked.rows) {
    const inWarehouse = r.warehouse_id === d.warehouseId;
    const statusOk = r.status === 'AVAILABLE' || r.status === 'RESERVED';
    const sourceOk =
      d.expectedFrom === 'ANY' ? true : d.expectedFrom === 'PENDING' ? r.location_id == null : r.location_id === d.expectedFrom;
    if (!inWarehouse || !statusOk || !sourceOk) stale.push(r.barcode);
  }
  if (stale.length) {
    throw new ZoneError(`تغيّر مكان/حالة ${stale.length} توب منذ التحديد — حدّث التحديد قبل الحفظ: ${stale.slice(0, 20).join('، ')}`, 'CONFLICT', stale);
  }

  const moved: { id: string; barcode: string; length_m: number }[] = [];
  for (const r of locked.rows) {
    if (r.location_id === d.toZoneId) continue; // موجود أصلاً بالوجهة: لا حركة
    await db.query(`UPDATE fabric_rolls SET location_id = $3, updated_at = now() WHERE id = $1 AND company_id = $2`, [r.id, companyId, d.toZoneId]);
    await db.query(
      `INSERT INTO inventory_movements
         (company_id, roll_id, movement_type, from_warehouse_id, to_warehouse_id, from_location_id, to_location_id,
          length_delta_m, reference_type, notes, created_by_user_id)
       VALUES ($1,$2,'LOCATION_MOVE',$3,$3,$4,$5,0,'ZONE_ASSIGN',$6,$7)`,
      [companyId, r.id, d.warehouseId, r.location_id, d.toZoneId, d.notes ?? null, userId],
    );
    moved.push({ id: r.id, barcode: r.barcode, length_m: 0 });
  }
  return { movedCount: moved.length, unchangedCount: ids.length - moved.length, toZone: zone.rows[0].name as string };
}

/** محتويات عنبر (أو «غير محدد» إن zoneId=null) مجمّعة حسب الخامة واللون مع تفاصيل الأتواب. */
export async function zoneContents(db: Db, companyId: string, warehouseId: string, zoneId: string | null) {
  await loadWarehouse(db, companyId, warehouseId);
  const rolls = await listScopeRolls(db, companyId, warehouseId, zoneId ? { type: 'ZONE', zoneId } : { type: 'PENDING' });
  const groups = new Map<string, { itemId: string; itemName: string; colorId: string | null; colorName: string | null; colorCode: string | null; rolls: ZoneRoll[] }>();
  for (const r of rolls) {
    const k = `${r.item_id}|${r.color_id ?? ''}`;
    let g = groups.get(k);
    if (!g) { g = { itemId: r.item_id, itemName: r.item_name, colorId: r.color_id, colorName: r.color_name, colorCode: r.color_code, rolls: [] }; groups.set(k, g); }
    g.rolls.push(r);
  }
  return { totals: totalsOf(rolls), groups: [...groups.values()].map((g) => ({ ...g, totals: totalsOf(g.rolls) })) };
}

/** توزيع خامة على عنابر المستودع (مع «غير محدد»). */
export async function itemDistribution(db: Db, companyId: string, warehouseId: string, itemId: string) {
  const r = await db.query(
    `SELECT wl.id AS zone_id, COALESCE(wl.name, 'غير محدد') AS zone_name, fr.color_id, fc.name_ar AS color_name, fc.color_code,
            COUNT(*)::int AS rolls, COALESCE(SUM(fr.length_m),0)::float AS meters
       FROM fabric_rolls fr
       LEFT JOIN warehouse_locations wl ON wl.id = fr.location_id
       LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
      WHERE fr.company_id = $1 AND fr.warehouse_id = $2 AND fr.item_id = $3 AND fr.status IN ${ASSIGNABLE}
      GROUP BY wl.id, wl.name, fr.color_id, fc.name_ar, fc.color_code ORDER BY zone_name, color_name`,
    [companyId, warehouseId, itemId],
  );
  return r.rows;
}

/** لقائمة العزل/الطباعة: أتواب معيّنة مجمّعة حسب العنبر («عنبر غير محدد» لمن بلا عنبر). */
export async function groupRollsByZone(db: Db, companyId: string, rollIds: string[]) {
  if (!rollIds.length) return [];
  const r = await db.query(`${ROLL_SELECT} WHERE fr.company_id = $1 AND fr.id = ANY($2::uuid[]) ORDER BY wh.name, wl.name NULLS LAST, fi.name, fr.barcode`, [companyId, [...new Set(rollIds)]]);
  const groups = new Map<string, { warehouseId: string; warehouseName: string; zoneId: string | null; zoneName: string; rolls: ZoneRoll[] }>();
  for (const row of r.rows as ZoneRoll[]) {
    const k = `${row.warehouse_id}:${row.location_id ?? 'none'}`;
    let g = groups.get(k);
    if (!g) { g = { warehouseId:row.warehouse_id,warehouseName:row.warehouse_name,zoneId: row.location_id, zoneName: row.zone_name ?? 'عنبر غير محدد', rolls: [] }; groups.set(k, g); }
    g.rolls.push(row);
  }
  return [...groups.values()].map((g) => ({ ...g, totals: totalsOf(g.rolls) }));
}
