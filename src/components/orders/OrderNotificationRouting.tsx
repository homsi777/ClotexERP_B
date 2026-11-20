import {useState} from 'react';
import {apiFetch} from '../../lib/api/client';
import {usePermissions} from '../../hooks/usePermissions';
type Routing={users:Array<{id:string;name:string}>;phases:Array<{phase:string;userId:string}>};
const phases={pending_supply:'بانتظار التوريد',partial_ready:'جاهز جزئياً',ready_pickup:'جاهز للتسليم'};
export function OrderNotificationRouting(){
  const {has}=usePermissions();
  const [data,setData]=useState<Routing|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{setBusy(true);try{const r=await apiFetch<{data:Routing}>('/api/customer-orders/notifications/routing');setData(r.data);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  if(!has('customers.manage'))return null;
  const save=async(phase:string,userId:string)=>{setBusy(true);try{await apiFetch('/api/customer-orders/notifications/routing',{method:'PUT',body:JSON.stringify({phase,userId:userId||null})});await load();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <details className="rounded-lg border bg-white p-3" onToggle={e=>{if(e.currentTarget.open&&!data&&!busy)void load();}}><summary className="cursor-pointer font-bold">مسؤولو تنبيهات مراحل الأوردر</summary><p className="my-2 text-sm text-slate-500">يتلقى مسؤول المرحلة التنبيه عند انتقال الأوردر إليها، بالإضافة إلى مسؤول متابعة الأوردر. يجب أن يملك المستخدم صلاحية عرض الأوردرات.</p>{error&&<p role="alert" className="text-rose-700">{error}</p>}<div className="grid gap-3 md:grid-cols-3">{data&&Object.entries(phases).map(([phase,label])=><label key={phase} className="text-sm">{label}<select aria-label={`مسؤول ${label}`} disabled={busy} value={data.phases.find(p=>p.phase===phase)?.userId??''} onChange={e=>void save(phase,e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">غير معين</option>{data.users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>)}</div><button disabled={busy} className="mt-2 text-sm text-indigo-700" onClick={()=>void load()}>تحديث الإعدادات</button></details>;
}
