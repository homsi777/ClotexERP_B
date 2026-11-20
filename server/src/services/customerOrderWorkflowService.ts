import {generateManufacturingWorkOrderNo} from './manufacturingWorkOrderService.js';
import {externalOrderLineSummaries} from './externalOrderTraceabilitySummary.js';
import type {PoolClient} from 'pg';
import {getOrderLineFulfilledMeters} from './customerOrderFulfillmentService.js';
import {reserveRoll,releaseRollReservation} from './rollReservationService.js';

const fail=(message:string,code='VALIDATION'):never=>{throw Object.assign(new Error(message),{code});};
export async function orderInventoryWorkflow(db:PoolClient,company:string,orderId:string){
  const order=(await db.query('SELECT id,order_no,status,follow_up_user_name,follow_up_employee_name FROM customer_orders WHERE company_id=$1 AND id=$2',[company,orderId])).rows[0];
  if(!order)fail('الأوردر غير موجود','NOT_FOUND');
  const lines=(await db.query('SELECT * FROM customer_order_lines WHERE company_id=$1 AND order_id=$2 ORDER BY line_no',[company,orderId])).rows;
  const externalByLine=await externalOrderLineSummaries(db,company,orderId);
  const result=[];
  for(const line of lines){
    const rolls=(await db.query(`SELECT r.id,r.barcode,r.length_m::float,w.id AS warehouse_id,w.name AS warehouse_name,w.fabric_stage,
      r.status,c.color_code,c.name_ar AS color_name,f.name AS material_name,r.created_at,
      own.reference_type,own.reference_id,
      EXISTS(SELECT 1 FROM external_job_return_lines q WHERE q.company_id=r.company_id AND q.result_roll_id=r.id AND q.defective AND q.resolution IS NULL) AS quality_hold,
      EXISTS(SELECT 1 FROM external_job_lines e WHERE e.company_id=r.company_id AND e.roll_id=r.id AND e.line_status='SENT') AS external_pending
      FROM fabric_rolls r JOIN fabric_items f ON f.company_id=r.company_id AND f.id=r.item_id
      JOIN warehouses w ON w.company_id=r.company_id AND w.id=r.warehouse_id
      LEFT JOIN fabric_colors c ON c.id=r.color_id AND c.company_id=r.company_id
      LEFT JOIN inventory_roll_reservations own ON own.company_id=r.company_id AND own.roll_id=r.id AND own.released_at IS NULL
      WHERE r.company_id=$1 AND r.length_m>0 AND r.status IN ('AVAILABLE','RESERVED','TRANSFERRED','DAMAGED')
      AND ((NULLIF($2,'') IS NOT NULL AND f.internal_code=$2) OR (NULLIF($3,'') IS NOT NULL AND f.internal_code=$3)
        OR ($2='' AND $3='' AND f.name=$4 AND (SELECT COUNT(*) FROM fabric_items fi WHERE fi.company_id=$1 AND fi.name=$4)=1))
      AND ((NULLIF($5,'') IS NOT NULL AND c.color_code=$5) OR ($5='' AND NULLIF($6,'') IS NOT NULL AND c.name_ar=$6)
        OR ($5='' AND $6='' AND r.color_id IS NULL)) ORDER BY r.created_at,r.id`,
      [company,line.roll_no??'',line.dsam_number??'',line.material_name,line.color_code??'',line.color_name??''])).rows;
    const sum=(filter:(r:typeof rolls[number])=>boolean)=>Math.round(rolls.filter(filter).reduce((n,r)=>n+Number(r.length_m),0)*1000)/1000;
    const ready=(r:typeof rolls[number])=>!r.quality_hold&&!r.external_pending&&r.fabric_stage==='FINISHED';
    const available=sum(r=>ready(r)&&r.status==='AVAILABLE'&&!r.reference_id);
    const reserved=sum(r=>ready(r)&&r.status==='RESERVED'&&r.reference_type==='CUSTOMER_ORDER_LINE'&&r.reference_id===line.id);
    const ordered=Number(line.length)*(line.unit_type==='yard'?0.9144:1);
    const fulfilled=await getOrderLineFulfilledMeters(db,company,line.id);
    const production=(await db.query(`SELECT a.allocated_length_m::float,w.id,w.work_order_no,w.status,w.updated_at AS last_update,
      (SELECT COUNT(*)>1 FROM manufacturing_work_order_allocations shared WHERE shared.company_id=w.company_id AND shared.work_order_id=w.id AND shared.is_active) AS shared,
      CASE WHEN EXISTS(SELECT 1 FROM manufacturing_raw_roll_outputs ro JOIN manufacturing_weaving_runs run ON run.id=ro.weaving_run_id AND run.company_id=ro.company_id WHERE run.company_id=w.company_id AND run.work_order_id=w.id AND ro.result_fabric_roll_id IS NOT NULL) THEN 'RAW_STORED'
      WHEN EXISTS(SELECT 1 FROM manufacturing_production_batches b JOIN manufacturing_weaving_runs run ON run.id=b.weaving_run_id AND run.company_id=b.company_id WHERE run.company_id=w.company_id AND run.work_order_id=w.id) THEN 'QUALITY'
      WHEN EXISTS(SELECT 1 FROM manufacturing_weaving_runs run WHERE run.company_id=w.company_id AND run.work_order_id=w.id) THEN 'WEAVING'
      WHEN EXISTS(SELECT 1 FROM manufacturing_sizing_orders s JOIN manufacturing_warp_beams beam ON beam.id=s.input_beam_id AND beam.company_id=s.company_id JOIN manufacturing_warping_orders warp ON warp.id=beam.warping_order_id AND warp.company_id=beam.company_id WHERE warp.company_id=w.company_id AND warp.work_order_id=w.id) THEN 'SIZING'
      WHEN EXISTS(SELECT 1 FROM manufacturing_warping_orders warp WHERE warp.company_id=w.company_id AND warp.work_order_id=w.id) THEN 'WARPING' ELSE 'PLANNING' END AS phase
      FROM manufacturing_work_order_allocations a
      JOIN manufacturing_work_orders w ON w.company_id=a.company_id AND w.id=a.work_order_id WHERE a.company_id=$1 AND a.customer_order_line_id=$2 AND a.is_active AND w.status<>'CANCELLED' ORDER BY w.created_at`,[company,line.id])).rows;
    const defaultSpecification=await resolveOrderItemSpecification(db,company,line);
    const externalJobs=externalByLine.get(line.id)??[];
    const remaining=Math.max(0,ordered-fulfilled),shortage=Math.max(0,remaining-available-reserved);
    const phases=[...new Set(production.map(p=>String(p.phase)))];
    const phase=remaining<=0.0005?'DELIVERED':reserved>=remaining?'READY':externalJobs.some(j=>j.pending>0)?'EXTERNAL_PROCESSING':externalJobs.some(j=>j.qualityPending>0)?'QUALITY':phases.length>1?'MULTIPLE':phases[0]??(available>=remaining?'READY':'STOCK_CHECK');
    result.push({id:line.id,materialName:line.material_name,designCode:line.roll_no||line.dsam_number,colorCode:line.color_code,colorName:line.color_name,
      defaultSpecification,phase,orderedMeters:ordered,fulfilledMeters:fulfilled,remainingMeters:remaining,availableMeters:available,reservedMeters:reserved,shortageMeters:shortage,
      rawMeters:sum(r=>!r.quality_hold&&!r.external_pending&&r.fabric_stage==='RAW'&&r.status==='AVAILABLE'),
      externalJobs,externalMeters:Math.round(externalJobs.reduce((n,j)=>n+j.pending,0)*1000)/1000,qualityPendingMeters:sum(r=>r.quality_hold),
      unclassifiedMeters:sum(r=>!r.quality_hold&&!r.external_pending&&!r.fabric_stage&&r.status==='AVAILABLE'),
      availability:remaining<=available+reserved+0.0005?'READY':available+reserved>0?'PARTIAL':'PRODUCTION_REQUIRED',production,
      rolls:rolls.map(r=>({...r,eligible:ready(r)&&r.status==='AVAILABLE'&&!r.reference_id,owned:ready(r)&&r.status==='RESERVED'&&r.reference_type==='CUSTOMER_ORDER_LINE'&&r.reference_id===line.id}))});
  }
  const phases=[...new Set(result.map(line=>line.phase))];
  return {order:{...order,currentStage:phases.length===1?phases[0]:'MULTIPLE'},lines:result};
}

export async function reserveOrderLine(db:PoolClient,company:string,user:string,orderId:string,lineId:string,rollIds?:string[]){
  const order=(await db.query('SELECT status FROM customer_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,orderId])).rows[0];
  if(!order)fail('الأوردر غير موجود','NOT_FOUND');
  if(['draft','completed','cancelled'].includes(order.status))fail('يجب تأكيد الأوردر وأن يكون مفتوحاً قبل الحجز');
  const workflow=await orderInventoryWorkflow(db,company,orderId);
  const line=workflow.lines.find(l=>l.id===lineId);
  if(!line)fail('السطر لا يتبع الأوردر');
  let room=Math.max(0,line!.remainingMeters-line!.reservedMeters);
  const candidates=line!.rolls.filter(r=>r.eligible);
  const chosen=rollIds ? rollIds.map(id=>{const row=line!.rolls.find(r=>r.id===id);if(!row||(!row.eligible&&!row.owned))fail('أحد الرولات لا يطابق الخامة واللون أو غير مؤهل للحجز');return row!;}) : candidates.filter(r=>{if(Number(r.length_m)>room+0.0005)return false;room-=Number(r.length_m);return true;});
  if(!chosen.length)fail('لا يوجد رول كامل مؤهل ضمن المتبقي؛ استخدم آلية القص الحالية إذا احتجت جزءاً من رول');
  const newly=chosen.filter(r=>!r.owned);
  if(newly.reduce((n,r)=>n+Number(r.length_m),0)>line!.remainingMeters-line!.reservedMeters+0.0005)fail('الرولات المحددة تتجاوز المتبقي غير المحجوز');
  for(const r of [...chosen].sort((a,b)=>a.id.localeCompare(b.id)))await reserveRoll(db,company,user,r.id,{type:'CUSTOMER_ORDER_LINE',id:lineId,number:workflow.order.order_no});
  return orderInventoryWorkflow(db,company,orderId);
}

export async function releaseOrderLine(db:PoolClient,company:string,user:string,orderId:string,lineId:string){
  const order=(await db.query('SELECT order_no FROM customer_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,orderId])).rows[0];
  if(!order)fail('الأوردر غير موجود','NOT_FOUND');
  if(!(await db.query('SELECT id FROM customer_order_lines WHERE company_id=$1 AND order_id=$2 AND id=$3',[company,orderId,lineId])).rows.length)fail('السطر لا يتبع الأوردر');
  const held=(await db.query(`SELECT roll_id FROM inventory_roll_reservations WHERE company_id=$1 AND reference_type='CUSTOMER_ORDER_LINE' AND reference_id=$2 AND released_at IS NULL ORDER BY roll_id`,[company,lineId])).rows;
  for(const r of held){
    if((await db.query(`SELECT 1 FROM sales_invoice_lines l JOIN sales_invoices i ON i.company_id=l.company_id AND i.id=l.invoice_id WHERE l.company_id=$1 AND l.fabric_roll_id=$2 AND i.document_status='DRAFT' LIMIT 1`,[company,r.roll_id])).rows.length)fail('الرول مرتبط بمسودة فاتورة؛ عدّل المسودة أولاً');
    await releaseRollReservation(db,company,user,r.roll_id,{type:'CUSTOMER_ORDER_LINE',id:lineId,number:order.order_no});
  }
  return orderInventoryWorkflow(db,company,orderId);
}

// A code collision is deliberately unresolved; names are used only when both codes are absent.
export async function resolveOrderItemSpecification(db:PoolClient,company:string,line:{roll_no?:string;dsam_number?:string;material_name:string}) {
 const items=(await db.query(`SELECT id,internal_code,name FROM fabric_items WHERE company_id=$1 AND is_active AND
 ((NULLIF($2,'') IS NOT NULL AND internal_code=$2) OR (NULLIF($3,'') IS NOT NULL AND internal_code=$3)
 OR ($2='' AND $3='' AND name=$4)) ORDER BY id`,[company,line.roll_no??'',line.dsam_number??'',line.material_name])).rows;
 if(items.length!==1)return {state:items.length?'AMBIGUOUS_ITEM':'ITEM_NOT_FOUND',mapping:null};
 const mapping=(await db.query(`SELECT m.id,m.revision,m.item_id,m.specification_version_id,v.version_no,s.code,s.name,
 (v.status='APPROVED' AND s.is_active) AS usable FROM manufacturing_item_specifications m
 JOIN manufacturing_specification_versions v ON v.company_id=m.company_id AND v.specification_id=m.specification_id AND v.id=m.specification_version_id
 JOIN manufacturing_specifications s ON s.company_id=m.company_id AND s.id=m.specification_id
 WHERE m.company_id=$1 AND m.item_id=$2 AND m.superseded_at IS NULL`,[company,items[0].id])).rows[0]??null;
 return {state:!mapping?'UNMAPPED':mapping.usable?'READY':'STALE',item:items[0],mapping};
}

export async function setItemSpecification(db:PoolClient,company:string,user:string,itemId:string,input:{specificationVersionId:string|null;expectedRevision:number;reason:string}) {
 const item=(await db.query('SELECT id FROM fabric_items WHERE company_id=$1 AND id=$2 AND is_active FOR UPDATE',[company,itemId])).rows[0];
 if(!item)fail('الخامة غير موجودة','NOT_FOUND');
 const previous=(await db.query('SELECT * FROM manufacturing_item_specifications WHERE company_id=$1 AND item_id=$2 ORDER BY revision DESC LIMIT 1',[company,itemId])).rows[0];
 if((previous?.revision??0)!==input.expectedRevision)fail('تغير الربط؛ أعد التحميل','CONFLICT');
 let spec:{specification_id:string}|null=null;
 if(input.specificationVersionId){
 spec=(await db.query(`SELECT v.specification_id FROM manufacturing_specification_versions v JOIN manufacturing_specifications s ON s.company_id=v.company_id AND s.id=v.specification_id WHERE v.company_id=$1 AND v.id=$2 AND v.status='APPROVED' AND s.is_active FOR SHARE OF v,s`,[company,input.specificationVersionId])).rows[0];
 if(!spec)fail('يجب اختيار إصدار معتمد وفعال من الشركة نفسها');
 }
 if(previous&&!previous.superseded_at)await db.query('UPDATE manufacturing_item_specifications SET superseded_at=now() WHERE company_id=$1 AND id=$2',[company,previous.id]);
 let next=null;
 next=(await db.query(`INSERT INTO manufacturing_item_specifications(company_id,item_id,specification_id,specification_version_id,revision,reason,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[company,itemId,spec?.specification_id??null,input.specificationVersionId,(previous?.revision??0)+1,input.reason,user])).rows[0];
 await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'SET_ITEM_SPECIFICATION','fabric_item',$3,$4::jsonb)`,[company,user,itemId,JSON.stringify({previous,next,reason:input.reason})]);
 return next;
}

export async function confirmOrderLineProduction(db:PoolClient,company:string,user:string,orderId:string,lineId:string,input:{confirmed:boolean;specificationVersionId:string;mappingId:string|null;targetLengthM:number}) {
 if(input.confirmed!==true)fail('يلزم تأكيد الإنتاج صراحة');
 const order=(await db.query('SELECT status FROM customer_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,orderId])).rows[0];
 if(!order)fail('الأوردر غير موجود','NOT_FOUND');
 if(['draft','completed','cancelled'].includes(order.status))fail('الأوردر غير مفتوح للإنتاج');
 const line=(await db.query('SELECT * FROM customer_order_lines WHERE company_id=$1 AND order_id=$2 AND id=$3 FOR UPDATE',[company,orderId,lineId])).rows[0];
 if(!line)fail('السطر غير موجود','NOT_FOUND');
 // Lock the directory identity before resolving the mapping, matching mapping-update lock order.
 await db.query(`SELECT id FROM fabric_items WHERE company_id=$1 AND is_active AND (internal_code=ANY($2::text[]) OR name=$3) ORDER BY id FOR SHARE`,[company,[line.roll_no??'',line.dsam_number??''],line.material_name]);
 const resolved=await resolveOrderItemSpecification(db,company,line);
 if(input.mappingId&&(resolved.state!=='READY'||resolved.mapping.id!==input.mappingId||resolved.mapping.specification_version_id!==input.specificationVersionId))fail('تغير الربط الافتراضي؛ أعد مراجعة المواصفة','CONFLICT');
 const spec=(await db.query(`SELECT v.specification_id FROM manufacturing_specification_versions v JOIN manufacturing_specifications s ON s.company_id=v.company_id AND s.id=v.specification_id WHERE v.company_id=$1 AND v.id=$2 AND v.status='APPROVED' AND s.is_active FOR SHARE OF v,s`,[company,input.specificationVersionId])).rows[0];
 if(!spec)fail('الإصدار غير معتمد أو غير فعال');
 const workflow=await orderInventoryWorkflow(db,company,orderId);
 const current=workflow.lines.find(l=>l.id===lineId)!;
 const remaining=Math.max(0,current.shortageMeters-current.production.reduce((n,p)=>n+Number(p.allocated_length_m),0));
 if(!Number.isFinite(input.targetLengthM)||input.targetLengthM<=0||input.targetLengthM>remaining+0.0005)fail('الكمية تتجاوز العجز المتبقي','CONFLICT');
 const number=await generateManufacturingWorkOrderNo(db,company);
 const created=(await db.query(`INSERT INTO manufacturing_work_orders(company_id,work_order_no,specification_id,specification_version_id,target_length_m,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id`,[company,number,spec.specification_id,input.specificationVersionId,input.targetLengthM,user])).rows[0];
 await db.query(`INSERT INTO manufacturing_work_order_allocations(company_id,work_order_id,customer_order_id,customer_order_line_id,allocated_length_m,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[company,created.id,orderId,lineId,input.targetLengthM,user]);
 const details=JSON.stringify({...input,lineId,workOrderId:created.id,workOrderNo:number});
 await db.query(`INSERT INTO manufacturing_work_order_events(company_id,work_order_id,event_type,new_status,details,created_by_user_id) VALUES($1,$2,'CREATED','DRAFT',$3::jsonb,$4)`,[company,created.id,details,user]);
 await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'CONFIRM_PRODUCTION','customer_order',$3,$4::jsonb)`,[company,user,orderId,details]);
 return {id:created.id,workOrderNo:number,status:'DRAFT'};
}
