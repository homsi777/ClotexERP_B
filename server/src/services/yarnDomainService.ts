import type { Pool, PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const yarnKg = z.number().finite().min(0).max(999999999)
  .refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001, 'دقة الوزن ثلاث منازل عشرية');
export const yarnPropertiesSchema = z.object({
  fiber: z.string().trim().max(100).optional(),
  spinningType: z.string().trim().max(100).optional(),
  count: z.string().trim().max(50).optional(),
  countSystem: z.enum(['Ne', 'Nm', 'Denier', 'Tex']).optional(),
  blend: z.array(z.object({ fiber: z.string().trim().min(1).max(100), percent: z.number().positive().max(100) }).strict()).max(20).optional(),
}).strict().refine(p => !p.blend?.length || Math.abs(p.blend.reduce((n,b) => n + b.percent, 0) - 100) <= 0.001,
  'مجموع نسب الخليط يجب أن يساوي 100% بتسامح 0.001 نقطة مئوية');
export type YarnProperties = z.infer<typeof yarnPropertiesSchema>;
export const yarnReceiveSchema = z.object({
  receiptKey: z.string().uuid().optional(),
  barcode: z.string().regex(/^\d{7}$/, 'الباركود سبعة أرقام').optional(),
  lotNo: z.string().trim().max(100).optional(),
  itemId: z.string().uuid(), colorId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid(), locationId: z.string().uuid().nullable().optional(),
  weightKg: yarnKg,
  grossWeightKg:yarnKg.optional(),tareWeightKg:yarnKg.optional(),
  unitCost: z.number().finite().min(0).max(9999999999).nullable().optional(),
  currencyCode: z.string().max(10).nullable().optional(),
  batchNo: z.string().max(100).nullable().optional(), containerNo: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  ownerType: z.enum(['COMPANY','CUSTOMER']).default('COMPANY'),
  ownerCustomerId: z.string().uuid().nullable().optional(),
  yarnProperties: yarnPropertiesSchema.optional(),
  receiptPackages: z.object({ count: z.number().int().positive().max(1000), weightPerPackageKg: yarnKg.refine(n => n > 0) }).strict().nullable().optional(),
}).strict().refine(d => d.ownerType === 'CUSTOMER' ? !!d.ownerCustomerId : !d.ownerCustomerId, 'تحقق من مالك الخيط')
  .refine(d=>d.grossWeightKg==null&&d.tareWeightKg==null||d.grossWeightKg!=null&&d.tareWeightKg!=null&&d.grossWeightKg>=d.tareWeightKg&&Math.abs(d.grossWeightKg-d.tareWeightKg-d.weightKg)<.0005,'الصافي لا يطابق القائم والفوارغ')
  .refine(d => !d.receiptPackages || Math.abs(d.weightKg - d.receiptPackages.count * d.receiptPackages.weightPerPackageKg) < 0.0005, 'صافي الطرود لا يطابق وزن الاستلام');
export type YarnReceive = z.infer<typeof yarnReceiveSchema>;
export function yarnFail(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
export async function yarnTransaction<T>(pool: Pick<Pool,'connect'>, work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await work(db); await db.query('COMMIT'); return result; }
  catch (e) { await db.query('ROLLBACK').catch(() => undefined); throw e; }
  finally { db.release(); }
}
export async function yarnBarcode(db: PoolClient, company: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('YARN_BARCODE'))", [company]);
  const r = await db.query(`SELECT GREATEST(COALESCE(MAX(barcode::bigint),999999),999999)+1 AS next FROM yarn_lots WHERE company_id=$1 AND barcode ~ '^[0-9]{7}$'`, [company]);
  const next = Number(r.rows[0].next);
  if (next > 9999999) yarnFail('نفد نطاق باركود الخيط', 409);
  return String(next);
}
export async function yarnReference(db: PoolClient, company: string, table: 'fabric_items'|'warehouses'|'suppliers'|'customers'|'fabric_colors', id: string | null | undefined) {
  if (!id) return;
  const r = await db.query(`SELECT id ${table === 'fabric_items' ? ',unit' : ''} FROM ${table} WHERE id=$1 AND ${table === 'fabric_colors' ? '(company_id=$2 OR company_id IS NULL)' : 'company_id=$2'}`, [id, company]);
  if (!r.rows.length || (table === 'fabric_items' && r.rows[0].unit !== 'kg')) yarnFail(`مرجع غير صالح: ${table}`);
}
export async function yarnDestination(db: PoolClient, company: string, warehouse: string, location?: string | null) {
  await yarnReference(db, company, 'warehouses', warehouse);
  if (location) {
    const r = await db.query('SELECT id FROM warehouse_locations WHERE id=$1 AND company_id=$2 AND warehouse_id=$3', [location, company, warehouse]);
    if (!r.rows.length) yarnFail('الموقع لا يتبع المستودع');
  }
}
export async function validateYarnReceipt(db: PoolClient, company: string, d: YarnReceive) {
  for (const [table,id] of [['fabric_items',d.itemId],['fabric_colors',d.colorId],['suppliers',d.supplierId],['customers',d.ownerCustomerId]] as const)
    await yarnReference(db, company, table, id);
  await yarnDestination(db, company, d.warehouseId, d.locationId);
  if (!(await db.query('SELECT code FROM currencies WHERE code=$1', [d.currencyCode || 'USD'])).rows.length) yarnFail('عملة غير صالحة');
}
type Lot={id:string;owner_type:'COMPANY'|'CUSTOMER';owner_customer_id:string|null;warehouse_id:string;status:string;weight_kg:string;lot_no:string|null;item_id:string;color_id:string|null;supplier_id:string|null;currency_code:string;unit_cost:string|null;batch_no:string|null;yarn_properties:Record<string,unknown>};
export async function yarnMovement(db: PoolClient, company: string, user: string, lot: Lot, type: string, delta: number, referenceType: string, reference: string, notes: string, from?: string | null, to?: string | null) {
  await db.query(`INSERT INTO yarn_lot_movements(company_id,yarn_lot_id,movement_type,weight_delta_kg,from_warehouse_id,to_warehouse_id,reference_type,reference_id,notes,created_by_user_id,owner_type,owner_customer_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [company,lot.id,type,delta,from ?? null,to ?? null,referenceType,reference,notes,user,lot.owner_type,lot.owner_customer_id]);
}
export async function insertYarnReceipt(db: PoolClient, company: string, user: string, d: YarnReceive, referenceType = 'MANUAL_RECEIVE', reference:string = randomUUID()) {
  await validateYarnReceipt(db, company, d);
  const profile = (await db.query('SELECT properties FROM yarn_item_profiles WHERE company_id=$1 AND item_id=$2', [company,d.itemId])).rows[0];
  const barcode = d.barcode || await yarnBarcode(db, company);
  const r = await db.query(`INSERT INTO yarn_lots(company_id,lot_no,barcode,item_id,color_id,supplier_id,warehouse_id,location_id,weight_kg,unit_cost,currency_code,batch_no,container_no,notes,created_by_user_id,owner_type,owner_customer_id,yarn_properties,receipt_packages,status,receipt_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21) RETURNING *`,
    [company,d.lotNo || null,barcode,d.itemId,d.colorId ?? null,d.supplierId ?? null,d.warehouseId,d.locationId ?? null,d.weightKg,d.unitCost ?? null,d.currencyCode || 'USD',d.batchNo ?? null,d.containerNo ?? null,d.notes ?? null,user,d.ownerType,d.ownerCustomerId ?? null,JSON.stringify(d.yarnProperties ?? profile?.properties ?? {}),JSON.stringify(d.receiptPackages ?? null),d.ownerType === 'CUSTOMER' ? 'RESERVED' : 'AVAILABLE',d.receiptKey ?? null]);
  await yarnMovement(db,company,user,r.rows[0],'RECEIVE',d.weightKg,referenceType,reference,d.notes || '',null,d.warehouseId);
  await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'YARN_RECEIVED','yarn_lot',$3,$4::jsonb)`,[company,user,r.rows[0].id,JSON.stringify(d)]);
  return r.rows[0];
}
export async function receiveYarn(pool: Pool, company: string, user: string, body: unknown) {
  const d = yarnReceiveSchema.parse(body);
  return yarnTransaction(pool, async db => {
    if (d.receiptKey) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [company,d.receiptKey]);
      if ((await db.query('SELECT id FROM yarn_lots WHERE company_id=$1 AND receipt_key=$2',[company,d.receiptKey])).rows.length) yarnFail('تم تسجيل هذا الاستلام مسبقاً',409);
    }
    return insertYarnReceipt(db,company,user,d);
  });
}
export async function receiveYarnBatch(pool:Pool,company:string,user:string,raw:unknown){
  const d=z.object({batchKey:z.string().uuid(),rows:z.array(yarnReceiveSchema).min(1).max(100)}).strict().parse(raw);
  const fingerprint=hash(JSON.stringify(d));
  return yarnTransaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[company,d.batchKey]);
    const prior=(await db.query("SELECT details FROM audit_logs WHERE company_id=$1 AND action='YARN_BATCH_RECEIVED' AND details->>'batchKey'=$2",[company,d.batchKey])).rows[0];
    if(prior){if(prior.details.fingerprint!==fingerprint)yarnFail('معرف الدفعة مستخدم بمحتوى مختلف',409);return prior.details.result;}
    const rows=[];for(const row of d.rows)rows.push(await insertYarnReceipt(db,company,user,row,'BATCH_RECEIVE',d.batchKey));
    const result={lotIds:rows.map(row=>row.id),count:rows.length};
    await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,details) VALUES($1,$2,'YARN_BATCH_RECEIVED','yarn_batch',$3::jsonb)`,[company,user,JSON.stringify({batchKey:d.batchKey,fingerprint,result})]);return result;
  });
}
export async function saveYarnProfile(pool: Pool, company: string, user: string, item: string, body: unknown) {
  const d = z.object({ expectedVersion: z.number().int().min(0), properties: yarnPropertiesSchema }).strict().parse(body);
  return yarnTransaction(pool, async db => {
    // The item row serializes first insert as well as subsequent updates.
    const locked = await db.query("SELECT id FROM fabric_items WHERE company_id=$1 AND id=$2 AND unit='kg' FOR UPDATE",[company,item]);
    if (!locked.rows.length) yarnFail('صنف الخيط غير موجود',404);
    const old = (await db.query('SELECT version FROM yarn_item_profiles WHERE company_id=$1 AND item_id=$2',[company,item])).rows[0];
    if ((old?.version ?? 0) !== d.expectedVersion) yarnFail('تغير تصنيف الصنف؛ أعد التحميل',409);
    const next = d.expectedVersion + 1;
    const r = await db.query(`INSERT INTO yarn_item_profiles(company_id,item_id,properties,version,updated_by_user_id) VALUES($1,$2,$3::jsonb,$4,$5)
      ON CONFLICT(company_id,item_id) DO UPDATE SET properties=EXCLUDED.properties,version=EXCLUDED.version,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now() RETURNING *`,[company,item,JSON.stringify(d.properties),next,user]);
    await db.query('INSERT INTO yarn_profile_history(company_id,item_id,properties,version,created_by_user_id) VALUES($1,$2,$3::jsonb,$4,$5)',[company,item,JSON.stringify(d.properties),next,user]);
    return r.rows[0];
  });
}

const dispatchSchema = z.object({ requestKey: z.string().uuid(), lotId: z.string().uuid(), supplierId: z.string().uuid(), weightKg: yarnKg.refine(n => n > 0), notes: z.string().trim().min(3).max(2000) }).strict();
const returnSchema = z.object({ requestKey: z.string().uuid(), returnedKg: yarnKg, shortageKg: yarnKg.default(0), approvedShortage: z.boolean().default(false), warehouseId: z.string().uuid(), locationId: z.string().uuid().nullable().optional(), colorId: z.string().uuid().nullable().optional(), notes: z.string().trim().min(3).max(2000) }).strict()
  .refine(d => d.returnedKg + d.shortageKg > 0 && (!d.shortageKg || d.approvedShortage), 'اعتمد الفاقد وأدخل كمية صحيحة');
export async function dispatchYarn(pool: Pool, company: string, user: string, body: unknown) {
  const d = dispatchSchema.parse(body);
  return yarnTransaction(pool, async db => {
    const lot = (await db.query('SELECT * FROM yarn_lots WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,d.lotId])).rows[0];
    if (!lot) yarnFail('لوط الخيط غير موجود',404);
    if ((lot.owner_type === 'COMPANY' ? lot.status !== 'AVAILABLE' : lot.status !== 'RESERVED') || Number(lot.weight_kg) < d.weightKg) yarnFail('رصيد اللوط غير متاح للإرسال',409);
    await yarnReference(db,company,'suppliers',d.supplierId);
    const dispatch = (await db.query(`INSERT INTO yarn_external_dispatches(company_id,source_lot_id,supplier_id,owner_type,owner_customer_id,dispatched_kg,request_key,notes,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[company,lot.id,d.supplierId,lot.owner_type,lot.owner_customer_id,d.weightKg,d.requestKey,d.notes,user])).rows[0];
    await db.query('UPDATE yarn_lots SET weight_kg=weight_kg-$3,updated_at=now() WHERE company_id=$1 AND id=$2',[company,lot.id,d.weightKg]);
    await yarnMovement(db,company,user,lot,'EXTERNAL_DISPATCH',-d.weightKg,'YARN_EXTERNAL',dispatch.id,d.notes,lot.warehouse_id,null);
    return dispatch;
  });
}
export async function returnExternalYarn(pool: Pool, company: string, user: string, dispatchId: string, body: unknown) {
  const d = returnSchema.parse(body);
  return yarnTransaction(pool, async db => {
    const dispatch = (await db.query('SELECT * FROM yarn_external_dispatches WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,dispatchId])).rows[0];
    if (!dispatch) yarnFail('إرسالية الخيط غير موجودة',404);
    const remaining = Math.round(Number(dispatch.dispatched_kg)*1000) - Math.round(Number(dispatch.returned_kg)*1000) - Math.round(Number(dispatch.shortage_kg)*1000);
    if (Math.round(d.returnedKg*1000) + Math.round(d.shortageKg*1000) > remaining) yarnFail('المستلم والفاقد يتجاوزان الرصيد الخارجي',409);
    await yarnDestination(db,company,d.warehouseId,d.locationId);
    await yarnReference(db,company,'fabric_colors',d.colorId);
    const source = (await db.query('SELECT * FROM yarn_lots WHERE company_id=$1 AND id=$2',[company,dispatch.source_lot_id])).rows[0];
    if (source.owner_type !== dispatch.owner_type || source.owner_customer_id !== dispatch.owner_customer_id) yarnFail('تغيرت ملكية الأصل؛ يلزم مراجعة الإرسالية',409);
    const returnId = randomUUID();
    let lot: Lot | null = null;
    if (d.returnedKg) {
      const barcode = await yarnBarcode(db,company);
      lot = (await db.query(`INSERT INTO yarn_lots(company_id,lot_no,barcode,item_id,color_id,supplier_id,warehouse_id,location_id,weight_kg,unit_cost,currency_code,batch_no,notes,created_by_user_id,owner_type,owner_customer_id,yarn_properties,status,parent_yarn_lot_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19) RETURNING *`,
        [company,source.lot_no,barcode,source.item_id,d.colorId === undefined ? source.color_id : d.colorId,source.supplier_id,d.warehouseId,d.locationId ?? null,d.returnedKg,source.unit_cost,source.currency_code,source.batch_no,d.notes,user,dispatch.owner_type,dispatch.owner_customer_id,JSON.stringify(source.yarn_properties),dispatch.owner_type === 'CUSTOMER' ? 'RESERVED' : 'AVAILABLE',source.id])).rows[0];
      await yarnMovement(db,company,user,lot!,'EXTERNAL_RETURN',d.returnedKg,'YARN_EXTERNAL',dispatchId,d.notes,null,d.warehouseId);
    }
    await db.query(`INSERT INTO yarn_external_returns(id,company_id,dispatch_id,result_lot_id,returned_kg,shortage_kg,request_key,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[returnId,company,dispatchId,lot?.id ?? null,d.returnedKg,d.shortageKg,d.requestKey,d.notes,user]);
    // Shortage is an external settlement: zero warehouse delta avoids subtracting stock twice.
    if (d.shortageKg) await yarnMovement(db,company,user,source,'EXTERNAL_SHORTAGE',0,'YARN_EXTERNAL',dispatchId,JSON.stringify({ shortageKg:d.shortageKg,approved:true,notes:d.notes }),null,null);
    await db.query('UPDATE yarn_external_dispatches SET returned_kg=returned_kg+$3,shortage_kg=shortage_kg+$4 WHERE company_id=$1 AND id=$2',[company,dispatchId,d.returnedKg,d.shortageKg]);
    return { id:returnId, resultLotId:lot?.id ?? null, remainingKg:(remaining-Math.round((d.returnedKg+d.shortageKg)*1000))/1000 };
  });
}

// Strict, bounded RFC4180-style CSV parser. Codes are matched exactly, never auto-created.
export function parseYarnCsv(source: string): string[][] {
  if (Buffer.byteLength(source,'utf8') > 1024*1024) yarnFail('أقصى حجم للملف 1MB');
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  const csv = source.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  for (let i=0; i<csv.length; i++) {
    const c=csv[i];
    if (quoted) { if (c==='"') { if (csv[i+1]==='"') {field+='"'; i++;} else {quoted=false; closed=true;} } else field+=c; }
    else if (c===',' || c==='\n') {
      row.push(field.trim()); field=''; closed=false;
      if (c==='\n') { if (row.some(Boolean)) rows.push(row); row=[]; }
    } else if (c==='"') { if (field || closed) yarnFail('اقتباس CSV غير صالح'); quoted=true; }
    else { if (closed && c.trim()) yarnFail('نص غير صالح بعد اقتباس CSV'); if (!closed) field+=c; }
  }
  if (quoted) yarnFail('اقتباس CSV غير مغلق');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows.length > 501) yarnFail('الملف يجب أن يحتوي 1 إلى 500 سطر بيانات');
  return rows;
}
const csvHeaders = ['itemCode','warehouseCode','lotNo','weightKg','ownerType','ownerCustomerCode','supplierCode','barcode','unitCost','currencyCode','locationCode'];
const hash = (s:string) => createHash('sha256').update(s,'utf8').digest('hex');
export async function previewYarnOpening(db: PoolClient, company: string, csv: string) {
  const parsed=parseYarnCsv(csv), headers=parsed.shift();
  if(!headers||!parsed.length||parsed.length>1000)yarnFail('ملف الجرد يجب أن يتضمن رأساً ومن 1 إلى 1000 سطر');
  if (new Set(headers).size!==headers.length || headers.some(h=>!csvHeaders.includes(h)) || !['itemCode','warehouseCode','weightKg','ownerType'].every(h=>headers.includes(h))) yarnFail('رؤوس CSV غير صالحة؛ استخدم القالب');
  const fileSha256=hash(csv);
  const canonicalRows=parsed.map(row => Object.fromEntries(csvHeaders.map(h=>[h, row[headers.indexOf(h)] ?? ''])));
  const contentSha256=hash(JSON.stringify(canonicalRows.map(r=>JSON.stringify(r)).sort()));
  const duplicate=(await db.query('SELECT id FROM yarn_opening_imports WHERE company_id=$1 AND (file_sha256=$2 OR content_sha256=$3)',[company,fileSha256,contentSha256])).rows.length>0;
  const rows: { line:number; values:Record<string,string>; payload?:YarnReceive; errors:string[] }[]=[];
  const seen=new Set<string>();
  for (let index=0;index<parsed.length;index++) {
    const values=canonicalRows[index], errors:string[]=[];
    try {
      if (parsed[index].length!==headers.length) yarnFail('عدد الأعمدة لا يطابق الرأس');
      const resolve=async(table:'fabric_items'|'warehouses'|'customers'|'suppliers',code:string,optional=false) => {
        if (!code && optional) return null;
        const col=table==='fabric_items'?'internal_code':'code';
        const r=await db.query(`SELECT id FROM ${table} WHERE company_id=$1 AND ${col}=$2`,[company,code]);
        if(r.rows.length!==1) yarnFail(`كود غير معروف أو ملتبس: ${table} / ${code}`);
        return r.rows[0].id as string;
      };
      const itemId=(await resolve('fabric_items',values.itemCode))!, warehouseId=(await resolve('warehouses',values.warehouseCode))!;
      let locationId: string | null=null;
      if (values.locationCode) {
        const r=await db.query('SELECT id FROM warehouse_locations WHERE company_id=$1 AND warehouse_id=$2 AND code=$3',[company,warehouseId,values.locationCode]);
        if(r.rows.length!==1) yarnFail('كود الموقع غير معروف أو ملتبس'); locationId=r.rows[0].id;
      }
      if(!values.weightKg || !/^\d+(\.\d{1,3})?$/.test(values.weightKg)) yarnFail('وزن غير صالح');
      if(values.unitCost && !/^\d+(\.\d{1,4})?$/.test(values.unitCost)) yarnFail('تكلفة غير صالحة');
      const payload=yarnReceiveSchema.parse({itemId,warehouseId,locationId,lotNo:values.lotNo || undefined,weightKg:Number(values.weightKg),ownerType:values.ownerType,ownerCustomerId:await resolve('customers',values.ownerCustomerCode,true),supplierId:await resolve('suppliers',values.supplierCode,true),barcode:values.barcode || undefined,unitCost:values.unitCost ? Number(values.unitCost) : null,currencyCode:values.currencyCode || 'USD'});
      await validateYarnReceipt(db,company,payload);
      if(payload.barcode) {
        if(seen.has(payload.barcode) || (await db.query('SELECT id FROM yarn_lots WHERE company_id=$1 AND barcode=$2',[company,payload.barcode])).rows.length) yarnFail('باركود مكرر');
        seen.add(payload.barcode);
      }
      rows.push({line:index+2,values,payload,errors});
    } catch(e) { errors.push(e instanceof z.ZodError ? e.issues.map(i=>i.message).join('; ') : String((e as Error).message)); rows.push({line:index+2,values,errors}); }
  }
  return { fileSha256,contentSha256,duplicate,rows,totalKg:rows.reduce((n,r)=>n+Math.round((r.payload?.weightKg ?? 0)*1000),0)/1000,canCommit:!duplicate && rows.every(r=>!r.errors.length) };
}
export async function importYarnOpening(pool: Pool, company: string, user: string, body: unknown, commit: boolean) {
  const d=z.object({csv:z.string().min(1).max(1024*1024),fileName:z.string().trim().min(1).max(200),expectedFileSha256:z.string().length(64).optional()}).strict().parse(body);
  return yarnTransaction(pool,async db=>{
    if(commit) await db.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('YARN_OPENING_IMPORT'))",[company]);
    const preview=await previewYarnOpening(db,company,d.csv);
    if(!commit) return preview;
    if(d.expectedFileSha256!==preview.fileSha256) yarnFail('يجب معاينة الملف نفسه قبل الترحيل',409);
    if(!preview.canCommit) yarnFail(preview.duplicate ? 'تم استيراد الملف مسبقاً' : 'صحح أخطاء المعاينة قبل الترحيل',409);
    const id=randomUUID();
    await db.query('INSERT INTO yarn_opening_imports(id,company_id,file_name,file_sha256,content_sha256,source_csv,row_count,total_kg,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,company,d.fileName,preview.fileSha256,preview.contentSha256,d.csv,preview.rows.length,preview.totalKg,user]);
    // Reserve explicit labels before auto-numbering to avoid colliding with later CSV rows.
    const ordered=[...preview.rows].sort((a,b)=>Number(!!b.payload!.barcode)-Number(!!a.payload!.barcode));
    const lots=[];
    for(const row of ordered) lots.push((await insertYarnReceipt(db,company,user,row.payload!,'YARN_OPENING_IMPORT',id)).id);
    return {id,lotIds:lots,rowCount:lots.length,totalKg:preview.totalKg};
  });
}
