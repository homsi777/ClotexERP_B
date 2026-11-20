import {useState} from 'react';
import {Link} from 'react-router-dom';
import {apiFetch} from '../../lib/api/client';
import {usePermissions} from '../../hooks/usePermissions';
type Receipt={id:string;voucher_no:string;status:string;voucher_date:string;amount:number;currency_code:string;purpose:string};
export function OrderReceiptsPanel({orderId}:{orderId:string}){
  const {has,user}=usePermissions(),[rows,setRows]=useState<Receipt[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!has('orders.price')&&user?.role!=='accountant')return null;
  const load=async()=>{setBusy(true);try{setRows((await apiFetch<{data:Receipt[]}>(`/api/customer-orders/${orderId}/receipts`)).data);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const totals=rows.filter(r=>r.status==='CONFIRMED').reduce<Record<string,number>>((sum,r)=>({...sum,[r.currency_code]:(sum[r.currency_code]??0)+r.amount}),{});
  return <details className="max-h-64 shrink-0 overflow-auto border-b bg-white px-4 py-2 text-sm" onToggle={e=>{if(e.currentTarget.open)void load();}}><summary className="cursor-pointer font-bold">سندات القبض المرتبطة بالأوردر</summary><p className="my-2 text-slate-500">القبض يتم من <Link className="text-indigo-700 underline" to="/bonds/collection">سند القبض المعتاد</Link> بإدخال رقم الأوردر. قيمة الدفعة في بيانات الأوردر مرجع، ولا تنشئ قبضاً إضافياً.</p>{error&&<p role="alert" className="text-rose-700">{error}</p>}{Object.entries(totals).map(([currency,total])=><p key={currency}>المقبوض المؤكد: {total.toLocaleString()} {currency}</p>)}<table className="w-full"><thead><tr><th>السند</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.voucher_no}</td><td>{r.voucher_date}</td><td>{r.amount} {r.currency_code}</td><td>{({DRAFT:'مسودة',CONFIRMED:'مؤكد',CANCELLED:'ملغى'} as Record<string,string>)[r.status]??r.status}</td></tr>)}</tbody></table>{!busy&&!rows.length&&<p>لا توجد سندات مرتبطة</p>}<button disabled={busy} className="my-2 text-indigo-700" onClick={()=>void load()}>تحديث السندات</button></details>;
}
