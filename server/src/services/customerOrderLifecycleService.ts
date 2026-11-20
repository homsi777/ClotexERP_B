import type {PoolClient} from 'pg';
import type {JwtPayload} from '../middleware/auth.js';
import {getOrderLineFulfilledMeters} from './customerOrderFulfillmentService.js';
import {releaseOrderLine} from './customerOrderWorkflowService.js';

const fail=(message:string,code='CONFLICT'):never=>{throw Object.assign(new Error(message),{code});};
export async function changeCustomerOrderStatus(db:PoolClient,user:JwtPayload,id:string,status:string,reason?:string){
  const previous=(await db.query('SELECT * FROM customer_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[user.companyId,id])).rows[0];
  if(!previous)fail('الأوردر غير موجود','NOT_FOUND');
  if(previous.status===status)return;
  if(['cancelled','completed'].includes(previous.status)&&status!=='pending_supply')fail('إعادة الفتح تكون إلى قيد المتابعة فقط');
  if(['cancelled','completed'].includes(previous.status)&&(user.role!=='admin'||!reason?.trim()))fail('إعادة الفتح تتطلب مسؤولاً وسبباً مسجلاً');
  if(previous.status==='draft'&&!['pending_supply','cancelled'].includes(status))fail('أكد المسودة قبل تغيير مراحلها');
  if(status==='draft')fail('لا يمكن إعادة الأوردر الرسمي إلى مسودة');
  const production=await db.query(`SELECT w.status FROM manufacturing_work_order_allocations a JOIN manufacturing_work_orders w ON w.company_id=a.company_id AND w.id=a.work_order_id
    WHERE a.company_id=$1 AND a.customer_order_id=$2 AND a.is_active AND w.status<>'CANCELLED'`,[user.companyId,id]);
  const started=production.rows.some(p=>p.status!=='DRAFT');
  if(status==='cancelled'&&started&&(!(user.role==='admin'||user.permissions.includes('manufacturing.work_orders.release'))||!reason?.trim()))fail('إلغاء أوردر بدأ إنتاجه يتطلب صلاحية اعتماد وسبباً');
  const lines=(await db.query('SELECT id,length,unit_type FROM customer_order_lines WHERE company_id=$1 AND order_id=$2 ORDER BY id',[user.companyId,id])).rows;
  if(status==='completed'){
    if(production.rows.some(p=>p.status!=='COMPLETED'))fail('توجد أوامر إنتاج غير مغلقة');
    for(const line of lines)if(await getOrderLineFulfilledMeters(db,user.companyId,line.id)+0.0005<Number(line.length)*(line.unit_type==='yard'?0.9144:1))fail('لم تسلّم الكمية كاملة؛ يبقى الأوردر مفتوحاً');
  }
  if(status==='cancelled'||status==='completed')for(const line of lines)await releaseOrderLine(db,user.companyId,user.sub,id,line.id);
  await db.query('UPDATE customer_orders SET status=$3,updated_at=clock_timestamp(),updated_by_user_id=$4 WHERE company_id=$1 AND id=$2',[user.companyId,id,status,user.sub]);
  await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'STATUS_CHANGE','customer_order',$3,$4::jsonb)`,[user.companyId,user.sub,id,JSON.stringify({before:previous.status,after:status,reason:reason??null})]);
}

export async function deleteUnusedOrderDraft(db:PoolClient,company:string,id:string){
  const order=(await db.query('SELECT status FROM customer_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,id])).rows[0];
  if(!order)fail('الأوردر غير موجود','NOT_FOUND');
  if(order.status!=='draft')fail('حذف المسودات غير المستخدمة فقط؛ استخدم الإلغاء للأوردر الرسمي');
  const refs=await db.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM sales_invoices WHERE company_id=$1 AND customer_order_id=$2)
    OR EXISTS(SELECT 1 FROM manufacturing_work_order_allocations WHERE company_id=$1 AND customer_order_id=$2)
    OR EXISTS(SELECT 1 FROM external_job_lines WHERE company_id=$1 AND customer_order_id=$2)
    OR EXISTS(SELECT 1 FROM inventory_roll_reservations r JOIN customer_order_lines l ON l.company_id=r.company_id AND l.id=r.reference_id WHERE l.company_id=$1 AND l.order_id=$2 AND r.reference_type='CUSTOMER_ORDER_LINE')`,[company,id]);
  if(refs.rows.length)fail('لا يمكن حذف مسودة لها سجل حجز أو فاتورة أو تصنيع');
  await db.query('DELETE FROM customer_orders WHERE company_id=$1 AND id=$2',[company,id]);
}
