import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const kg = z.number().finite().min(0).max(999999999).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001, 'دقة الوزن القصوى ثلاث منازل');
export const yarnReceiptSchema = z.object({
  ownerType: z.enum(['COMPANY', 'CUSTOMER']).default('COMPANY'),
  ownerCustomerId: z.string().uuid().nullable().optional(),
  yarnProperties: z.object({ fiber: z.string().max(100).optional(), spinningType: z.string().max(100).optional(), count: z.string().max(50).optional(), countSystem: z.enum(['Ne','Nm','Denier','Tex']).optional(), blend: z.array(z.object({ fiber: z.string().min(1).max(100), percent: z.number().positive().max(100) })).max(20).optional() }).refine(p => !p.blend?.length || Math.abs(p.blend.reduce((n,b) => n+b.percent,0)-100) <= 0.001, 'Blend percentages must total 100% within 0.001').default({}),
  receiptPackages: z.object({ count: z.number().int().positive().max(1000000), weightPerPackageKg: kg }).nullable().default(null),
});
export const stockOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADJUST'), targetWeightKg: kg, expectedWeightKg: kg, reason: z.string().trim().min(3).max(1000), approved: z.literal(true) }).strict(),
  z.object({ type: z.literal('TRANSFER'), weightKg: kg.refine(n => n > 0), warehouseId: z.string().uuid(), locationId: z.string().uuid().nullable().optional(), reason: z.string().trim().min(3).max(1000) }).strict(),
]);
function fail(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
export async function yarnStockOperation(pool: Pick<Pool, 'connect'>, companyId: string, userId: string, lotId: string, body: unknown) {
  const parsed = stockOperationSchema.safeParse(body);
  if (!parsed.success) fail('بيانات الحركة غير صالحة');
  const d = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM yarn_lots WHERE id=$1 AND company_id=$2 FOR UPDATE', [lotId, companyId]);
    const lot = result.rows[0];
    if (!lot) fail('لوط الخيط غير موجود',404);
    if (lot.status !== 'AVAILABLE' || lot.owner_type !== 'COMPANY') fail('الحركة متاحة لخيط الشركة المتاح فقط',409);
    const before = Math.round(Number(lot.weight_kg)*1000);
    const operationId = randomUUID();
    let targetLotId: string | null = null;
    let delta: number;
    if (d.type === 'ADJUST') {
      if (before !== Math.round(d.expectedWeightKg*1000)) fail('تغير الرصيد؛ أعد تحميله قبل التسوية',409);
      delta = (Math.round(d.targetWeightKg*1000)-before)/1000;
      if (!delta) fail('لا يوجد فرق لتسويته');
      await client.query('UPDATE yarn_lots SET weight_kg=$3, updated_at=now() WHERE id=$1 AND company_id=$2', [lotId, companyId, d.targetWeightKg]);
    } else {
      if (Math.round(d.weightKg*1000) > before) fail('الكمية تتجاوز الرصيد',409);
      if (lot.warehouse_id === d.warehouseId && (lot.location_id ?? null) === (d.locationId ?? null)) fail('المصدر والوجهة متطابقان');
      const wh = await client.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2', [d.warehouseId,companyId]);
      if (!wh.rows.length) fail('المستودع غير صالح');
      if (d.locationId) {
        const loc = await client.query('SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',[d.locationId,d.warehouseId,companyId]);
        if (!loc.rows.length) fail('الموقع لا يتبع المستودع');
      }
      // Serialize barcode allocation for all manual yarn receipts/transfers.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('YARN_BARCODE'))",[companyId]);
      const target = await client.query(`INSERT INTO yarn_lots (company_id,barcode,lot_no,item_id,color_id,supplier_id,warehouse_id,location_id,weight_kg,unit_cost,currency_code,batch_no,container_no,notes,created_by_user_id,owner_type,yarn_properties,parent_yarn_lot_id)
        SELECT company_id,(SELECT (GREATEST(COALESCE(MAX(barcode::bigint),999999),999999)+1)::text FROM yarn_lots WHERE company_id=$2 AND barcode ~ '^[0-9]{7}$'),lot_no,item_id,color_id,supplier_id,$3,$4,$5,unit_cost,currency_code,batch_no,container_no,$6,$7,owner_type,yarn_properties,id FROM yarn_lots WHERE id=$1 AND company_id=$2 RETURNING id,barcode`,[lotId,companyId,d.warehouseId,d.locationId ?? null,d.weightKg,d.reason,userId]);
      if (target.rows[0].barcode && !/^[0-9]{7}$/.test(target.rows[0].barcode)) fail('نفد نطاق باركود الخيط',409);
      targetLotId = target.rows[0].id;
      delta = -d.weightKg;
      await client.query('UPDATE yarn_lots SET weight_kg=weight_kg-$3,updated_at=now() WHERE id=$1 AND company_id=$2',[lotId,companyId,d.weightKg]);
      await client.query(`INSERT INTO yarn_lot_movements (company_id,yarn_lot_id,movement_type,weight_delta_kg,from_warehouse_id,to_warehouse_id,reference_type,reference_id,notes,created_by_user_id,owner_type) VALUES ($1,$2,'TRANSFER_IN',$3,$4,$5,'YARN_TRANSFER',$6,$7,$8,'COMPANY')`,[companyId,targetLotId,d.weightKg,lot.warehouse_id,d.warehouseId,operationId,d.reason,userId]);
    }
    await client.query(`INSERT INTO yarn_lot_movements (company_id,yarn_lot_id,movement_type,weight_delta_kg,from_warehouse_id,to_warehouse_id,reference_type,reference_id,notes,created_by_user_id,owner_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'COMPANY')`,[companyId,lotId,d.type === 'ADJUST' ? 'ADJUST' : 'TRANSFER_OUT',delta,lot.warehouse_id,d.type === 'TRANSFER' ? d.warehouseId : lot.warehouse_id,d.type === 'ADJUST' ? 'APPROVED_YARN_ADJUSTMENT' : 'YARN_TRANSFER',operationId,d.reason,userId]);
    await client.query('COMMIT');
    return { operationId, targetLotId };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
