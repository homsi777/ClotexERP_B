/**
 * دفعات الخيط/الغزل — مواز لـ fabricRollRoutes.ts لكن بالوزن (kg) كالكمية
 * الأساسية بدل الطول. لا علاقة له بجدول fabric_rolls ولا يعدّله بأي شكل.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { yarnStockOperation } from '../services/yarnStockService.js';
import { receiveYarn, receiveYarnBatch, saveYarnMinimumStock,saveYarnProfile, dispatchYarn, returnExternalYarn, importYarnOpening } from '../services/yarnDomainService.js';
import { canYarn, yarnMutationActions } from '../services/yarnPermissions.js';
import { ArabicErrors } from '../utils/arabicErrors.js';

const updateYarnLotSchema = z.object({
  itemId: z.string().uuid().optional(),
  colorId: z.string().uuid().nullable().optional(),
  lotNo: z.string().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  weightKg: z.never().optional(),
  unitCost: z.number().min(0).nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  batchNo: z.string().nullable().optional(),
  containerNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'SOLD', 'DAMAGED', 'TRANSFERRED', 'INACTIVE']),
  notes: z.string().nullable().optional(),
});

function normalizeSevenDigitBarcode(value: string | undefined): string | undefined {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 7);
  return digits || undefined;
}

/** نفس أسلوب generateBarcode بـ rollHelpers.ts، على جدول yarn_lots بدل fabric_rolls. */
export async function generateYarnLotBarcode(companyId: string): Promise<string> {
  const pool = getPool();
  const maxExisting = await pool.query<{ max_barcode: string | null }>(
    `SELECT MAX(barcode)::text AS max_barcode FROM yarn_lots
     WHERE company_id=$1 AND barcode ~ '^[0-9]{7}$'`,
    [companyId],
  );
  const current = Number(maxExisting.rows[0]?.max_barcode ?? 999999);
  for (let offset = 1; offset <= 100; offset++) {
    const next = current + offset;
    if (next > 9999999) break;
    const barcode = String(next).padStart(7, '0');
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM yarn_lots WHERE company_id=$1 AND barcode=$2',
      [companyId, barcode],
    );
    if (!rows.length) return barcode;
  }
  throw new Error('تعذّر توليد باركود فريد لدفعة الخيط');
}

const YARN_LOT_COLUMNS = `
  yl.id, yl.company_id, yl.lot_no, yl.barcode, yl.item_id, yl.color_id,
  yl.supplier_id, yl.warehouse_id, yl.location_id, yl.weight_kg,
  yl.unit_cost, yl.currency_code, yl.batch_no, yl.container_no,
  yl.purchase_invoice_id, yl.purchase_invoice_line_id, yl.status, yl.notes,
  yl.created_at, yl.updated_at, yl.owner_type, yl.owner_customer_id, yl.yarn_properties, yl.receipt_packages, yl.parent_yarn_lot_id,
  fi.name AS item_name, fi.internal_code AS item_internal_code, fi.weight_material_kind,
  fc.name_ar AS color_name_ar, fc.color_code, wl.name AS location_name, wl.code AS location_code, s.name AS supplier_name, w.name AS warehouse_name
`;

const YARN_LOT_JOINS = `
  FROM yarn_lots yl
  LEFT JOIN fabric_items fi ON fi.id = yl.item_id
  LEFT JOIN fabric_colors fc ON fc.id = yl.color_id
  LEFT JOIN suppliers s ON s.id = yl.supplier_id
  LEFT JOIN warehouse_locations wl ON wl.id=yl.location_id AND wl.company_id=yl.company_id
  LEFT JOIN warehouses w ON w.id = yl.warehouse_id
`;

export const yarnLotRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preSerialization',async(req,_reply,payload)=>{
    const u=req.user;if(u&&(u.role==='admin'||u.role==='accountant'||u.permissions.includes('inventory.yarn.cost.view')||u.permissions.includes('manufacturing.cost.view')))return payload;
    const redact=(value:unknown):unknown=>{
      if(Array.isArray(value))return value.map(redact);
      if(value instanceof Date)return value;
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['unit_cost','unitCost'].includes(key)).map(([key,child])=>[key,redact(child)]));
      return value;
    };return redact(payload);
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError) return sendError(reply, 400, error.issues.map(i => i.message).join('؛ '), 'VALIDATION');
    const failure=error as {code?:string;statusCode?:number;message?:string};
    if (failure.code === '23505') return sendError(reply, 409, 'المرجع أو الباركود مسجل مسبقاً', 'DUPLICATE');
    if (typeof failure.statusCode==='number' && failure.statusCode>=400 && failure.statusCode<500) return sendError(reply,failure.statusCode,failure.message??'بيانات غير صالحة','VALIDATION');
    app.log.error(error);
    return sendError(reply,500,'تعذر إتمام عملية الخيط','INTERNAL_ERROR');
  });
  app.addHook('preHandler', async (req, reply) => {
    await authenticateRequest(req, reply);
    if (reply.sent) return;
    const path = req.routeOptions.url ?? '';
    const permitted = req.method === 'GET'
      ? req.user?.role === 'admin' || req.user?.permissions.includes('inventory.view')
      : yarnMutationActions(path,req.body).every(action=>canYarn(req.user,action));
    if (!permitted)
      return sendError(reply, 403, 'لا تملك صلاحية العملية', 'FORBIDDEN');
  });
  app.get('/shortages', async (req, reply) => {
    const result = await getPool().query(`SELECT m.item_id,i.name AS item_name,i.internal_code,m.minimum_kg,
      COALESCE(SUM(y.weight_kg) FILTER (WHERE y.owner_type='COMPANY' AND y.status='AVAILABLE'),0) AS available_kg,
      GREATEST(m.minimum_kg-COALESCE(SUM(y.weight_kg) FILTER (WHERE y.owner_type='COMPANY' AND y.status='AVAILABLE'),0),0) AS shortage_kg
      FROM yarn_minimum_stock m JOIN fabric_items i ON i.id=m.item_id AND i.company_id=m.company_id
      LEFT JOIN yarn_lots y ON y.item_id=m.item_id AND y.company_id=m.company_id
      WHERE m.company_id=$1 GROUP BY m.item_id,i.name,i.internal_code,m.minimum_kg ORDER BY i.name`, [req.user!.companyId]);
    return reply.send({ok:true,data:result.rows});
  });
  app.put('/minimum-stock/:itemId', async (req, reply) => {
    const {itemId}=z.object({itemId:z.string().uuid()}).parse(req.params);
    return reply.send({ok:true,data:await saveYarnMinimumStock(getPool(),req.user!.companyId,req.user!.sub,itemId,req.body)});
  });
  app.get('/:id/packages', async(req,reply)=>{
    const {id}=z.object({id:z.string().uuid()}).parse(req.params);
    return reply.send({ok:true,data:(await getPool().query('SELECT id,barcode,package_number,nominal_weight_kg FROM yarn_package_labels WHERE company_id=$1 AND yarn_lot_id=$2 ORDER BY package_number',[req.user!.companyId,id])).rows});
  });
  app.get('/profiles', async (req, reply) => {
    const rows = await getPool().query(`SELECT p.*,i.name AS item_name,i.internal_code,i.weight_material_kind FROM yarn_item_profiles p JOIN fabric_items i ON i.id=p.item_id AND i.company_id=p.company_id WHERE p.company_id=$1 ORDER BY i.name`,[req.user!.companyId]);
    return reply.send({ok:true,data:rows.rows});
  });
  app.put('/profiles/:itemId', async (req, reply) => {
    const {itemId}=z.object({itemId:z.string().uuid()}).parse(req.params);
    return reply.send({ok:true,data:await saveYarnProfile(getPool(),req.user!.companyId,req.user!.sub,itemId,req.body)});
  });
  app.get('/material-options',async(req,reply)=>reply.send({ok:true,data:(await getPool().query("SELECT i.id,i.name,i.internal_code,i.unit,i.weight_material_kind,p.version,p.properties FROM fabric_items i LEFT JOIN yarn_item_profiles p ON p.company_id=i.company_id AND p.item_id=i.id WHERE i.company_id=$1 AND i.unit='kg' ORDER BY i.name",[req.user!.companyId])).rows}));
  app.get('/external/order-options',async(req,reply)=>{
    const query=z.object({search:z.string().trim().max(100).default(''),ownerCustomerId:z.string().uuid().optional()}).parse(req.query);
    const result=await getPool().query(`SELECT id,order_no,customer_id FROM customer_orders WHERE company_id=$1 AND status IN ('pending_supply','partial_ready','ready_pickup') AND ($2::uuid IS NULL OR customer_id=$2) AND order_no ILIKE $3 ORDER BY order_date DESC LIMIT 100`,[req.user!.companyId,query.ownerCustomerId??null,`%${query.search}%`]);
    return reply.send({ok:true,data:result.rows});
  });
  app.get('/external', async (req, reply) => {
    const q=z.object({ownerType:z.enum(['COMPANY','CUSTOMER']).optional(),ownerCustomerId:z.string().uuid().optional(),openOnly:z.enum(['true','false']).optional(),page:z.coerce.number().int().positive().default(1)}).parse(req.query);
    const params:unknown[]=[req.user!.companyId]; const filters=['d.company_id=$1'];
    if(q.ownerType) {params.push(q.ownerType);filters.push(`d.owner_type=$${params.length}`);}
    if(q.ownerCustomerId) {params.push(q.ownerCustomerId);filters.push(`d.owner_customer_id=$${params.length}`);}
    if(q.openOnly==='true') filters.push('d.dispatched_kg>d.returned_kg+d.shortage_kg');
    const r=await getPool().query(`SELECT d.*,o.order_no AS customer_order_no,y.barcode,y.lot_no,i.name AS item_name,s.name AS supplier_name,c.name AS owner_name,d.dispatched_kg-d.returned_kg-d.shortage_kg AS remaining_kg,count(*) OVER()::int AS total
      FROM yarn_external_dispatches d LEFT JOIN customer_orders o ON o.id=d.customer_order_id AND o.company_id=d.company_id JOIN yarn_lots y ON y.id=d.source_lot_id AND y.company_id=d.company_id JOIN fabric_items i ON i.id=y.item_id LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN customers c ON c.id=d.owner_customer_id WHERE ${filters.join(' AND ')} ORDER BY d.created_at DESC LIMIT 100 OFFSET $${params.length+1}`,[...params,(q.page-1)*100]);
    return reply.send({ok:true,data:r.rows,total:r.rows[0]?.total ?? 0});
  });
  app.post('/external/dispatch', async (req, reply) => reply.status(201).send({ok:true,data:await dispatchYarn(getPool(),req.user!.companyId,req.user!.sub,req.body)}));
  app.post('/external/:id/return', async (req, reply) => {
    const {id}=z.object({id:z.string().uuid()}).parse(req.params);
    return reply.send({ok:true,data:await returnExternalYarn(getPool(),req.user!.companyId,req.user!.sub,id,req.body)});
  });
  app.get('/external/:id/returns', async (req, reply) => {
    const {id}=z.object({id:z.string().uuid()}).parse(req.params);
    const r=await getPool().query(`SELECT r.*,y.barcode,y.color_id FROM yarn_external_returns r LEFT JOIN yarn_lots y ON y.id=r.result_lot_id AND y.company_id=r.company_id WHERE r.company_id=$1 AND r.dispatch_id=$2 ORDER BY r.created_at`,[req.user!.companyId,id]);
    return reply.send({ok:true,data:r.rows});
  });
  app.post('/opening/preview', async (req, reply) => reply.send({ok:true,data:await importYarnOpening(getPool(),req.user!.companyId,req.user!.sub,req.body,false)}));
  app.post('/opening/commit', async (req, reply) => reply.status(201).send({ok:true,data:await importYarnOpening(getPool(),req.user!.companyId,req.user!.sub,req.body,true)}));
  app.get('/:id/genealogy', async (req, reply) => {
    const {id}=z.object({id:z.string().uuid()}).parse(req.params);
    const r=await getPool().query(`WITH RECURSIVE ancestors AS (
      SELECT id,parent_yarn_lot_id,barcode,weight_kg,owner_type,owner_customer_id,0 AS depth FROM yarn_lots WHERE company_id=$1 AND id=$2
      UNION ALL SELECT y.id,y.parent_yarn_lot_id,y.barcode,y.weight_kg,y.owner_type,y.owner_customer_id,a.depth+1 FROM yarn_lots y JOIN ancestors a ON y.id=a.parent_yarn_lot_id WHERE y.company_id=$1 AND a.depth<50
    ) SELECT * FROM ancestors ORDER BY depth`,[req.user!.companyId,id]);
    const children=await getPool().query('SELECT id,barcode,weight_kg,owner_type,owner_customer_id FROM yarn_lots WHERE company_id=$1 AND parent_yarn_lot_id=$2 ORDER BY created_at',[req.user!.companyId,id]);
    return reply.send({ok:true,data:{ancestors:r.rows,children:children.rows}});
  });
  app.get('/:id/movements', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await getPool().query(`SELECT m.* FROM yarn_lot_movements m WHERE m.company_id=$1 AND m.yarn_lot_id=$2 ORDER BY m.created_at DESC LIMIT 200`, [req.user!.companyId, id]);
    return reply.send({ ok: true, data: rows.rows });
  });
  app.post('/:id/stock-operation', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const data = await yarnStockOperation(getPool(), req.user!.companyId, req.user!.sub, id, req.body);
      return reply.send({ ok: true, data });
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) return sendError(reply, Number(error.statusCode), error.message, 'VALIDATION');
      throw error;
    }
  });
  app.get('/', {}, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['yl.company_id=$1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (q.ownerType) { conditions.push(`yl.owner_type=$${p++}`); params.push(q.ownerType); }
    if (q.ownerCustomerId) { conditions.push(`yl.owner_customer_id=$${p++}`); params.push(q.ownerCustomerId); }
    if(q.materialKind==='YARN'||q.materialKind==='CONSUMABLE'){conditions.push(`(fi.weight_material_kind=$${p++} OR fi.weight_material_kind IS NULL)`);params.push(q.materialKind);}
    if (q.itemId) { conditions.push(`yl.item_id=$${p}`); params.push(q.itemId); p++; }
    if (q.status) { conditions.push(`yl.status=$${p}`); params.push(q.status); p++; }
    if (q.warehouseId) { conditions.push(`yl.warehouse_id=$${p}`); params.push(q.warehouseId); p++; }
    if (q.onlyAvailable === 'true') { conditions.push(`yl.status='AVAILABLE' AND yl.weight_kg > 0 AND yl.owner_type='COMPANY'`); }
    if (q.search) {
      conditions.push(`(yl.barcode ILIKE $${p} OR yl.lot_no ILIKE $${p} OR fi.name ILIKE $${p} OR yl.batch_no ILIKE $${p})`);
      params.push(`%${q.search.trim()}%`); p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT ${YARN_LOT_COLUMNS} ${YARN_LOT_JOINS}
         WHERE ${where} ORDER BY yl.created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total ${YARN_LOT_JOINS} WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', {}, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT ${YARN_LOT_COLUMNS} ${YARN_LOT_JOINS} WHERE yl.id=$1 AND yl.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'دفعة الخيط غير موجودة', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', async (req, reply) => {
    const lot = await receiveYarn(getPool(), req.user!.companyId, req.user!.sub, req.body);
    return reply.status(201).send({ ok: true, data: lot });
  });
  app.post('/receipts/batch',async(req,reply)=>reply.status(201).send({ok:true,data:await receiveYarnBatch(getPool(),req.user!.companyId,req.user!.sub,req.body)}));

  app.put('/:id', {}, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = updateYarnLotSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();

    const existing = await pool.query('SELECT id FROM yarn_lots WHERE id=$1 AND company_id=$2', [id, companyId]);
    if (!existing.rows.length) return sendError(reply, 404, 'دفعة الخيط غير موجودة', 'NOT_FOUND');

    const fields = { lotNo: 'lot_no', batchNo: 'batch_no', containerNo: 'container_no', notes: 'notes' } as const;
    if (Object.keys(req.body as object).some(key => !(key in fields)))
      return sendError(reply, 400, 'التعديل الوصفي فقط؛ استخدم مسار المخزون لتغيير الرصيد أو الموقع', 'VALIDATION');
    const entries = Object.entries(d).filter(([key]) => key in fields);
    if (!entries.length) return sendError(reply, 400, 'لا توجد تعديلات', 'VALIDATION');
    await pool.query(`UPDATE yarn_lots SET ${entries.map(([key], i) => `${fields[key as keyof typeof fields]}=$${i+3}`).join(',')}, updated_at=now() WHERE id=$1 AND company_id=$2`, [id, companyId, ...entries.map(([,v]) => v)]);
    const full = await pool.query(`SELECT ${YARN_LOT_COLUMNS} ${YARN_LOT_JOINS} WHERE yl.id=$1 AND yl.company_id=$2`, [id, companyId]);
    return reply.send({ ok: true, data: full.rows[0] });
  });

  app.patch('/:id/status', {}, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    return sendError(reply, 400, 'تغيير الحالة المباشر غير مسموح', 'VALIDATION');
  });
};
