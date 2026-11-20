import type {PoolClient} from 'pg';
export async function validateCustomerOrderVoucherLink(db:PoolClient,company:string,input:{referenceDocumentType?:string|null;referenceDocumentNo?:string|null;voucherType:string;partyType?:string|null;partyId?:string|null}){
  if(input.referenceDocumentType?.trim().toUpperCase()!=='CUSTOMER_ORDER')return;
  const no=input.referenceDocumentNo?.trim();
  if(!no||input.voucherType!=='RECEIPT'||input.partyType!=='CUSTOMER'||!input.partyId)throw Object.assign(new Error('ربط الأوردر يتطلب سند قبض لعميل محدد ورقم أوردر صحيح'),{code:'VALIDATION'});
  const order=(await db.query('SELECT id,customer_id,status FROM customer_orders WHERE company_id=$1 AND order_no=$2 FOR SHARE',[company,no])).rows[0];
  if(!order||order.customer_id!==input.partyId||['draft','cancelled'].includes(order.status))throw Object.assign(new Error('الأوردر غير مؤكد أو ملغى أو لا يتبع العميل المحدد'),{code:'VALIDATION'});
}
