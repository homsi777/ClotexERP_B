import {orderPhaseLabels} from './OrderNotificationRouting';
import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {apiFetch} from '../../lib/api/client';
type Notice={id:string;entityId:string;kind:string;readAt:string|null;payload:{orderNumber:string;expectedDate:string|null;materialName?:string;phase?:string}};
export function OrderNotificationInbox(){
  const [items,setItems]=useState<Notice[]>([]),[unread,setUnread]=useState(0),[error,setError]=useState('');
  const load=async()=>{try{const result=await apiFetch<{data:{items:Notice[];unread:number}}>('/api/customer-orders/notifications');setItems(result.data.items);setUnread(result.data.unread);setError('');}catch(e){setError(e instanceof Error?e.message:'تعذر تحميل التنبيهات');}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(timer);},[]);
  const labels:Record<string,string>={due_soon:'موعد التسليم خلال ثلاثة أيام',due_today:'التسليم مستحق اليوم',overdue:'تأخر موعد التسليم',stock_available:'توفر مخزون جاهز',phase_changed:'تحديث مرحلة الأوردر'};
  return <section className="border-b p-3 text-right" dir="rtl"><div className="flex justify-between gap-2"><strong className="text-sm">تنبيهات الأوردرات {unread>0?`(${unread})`:''}</strong><button className="text-xs text-indigo-700" onClick={()=>void load()}>تحديث</button></div>{error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}<div className="max-h-64 overflow-auto">{items.map(item=><article key={item.id} className={`border-b py-2 text-xs ${item.readAt?'text-slate-500':'font-bold text-slate-900'}`}><Link to={`/orders?order=${item.entityId}`}>{item.payload.orderNumber} — {labels[item.kind]??item.kind} {item.payload.materialName??''} {item.payload.phase?(orderPhaseLabels[item.payload.phase]??item.payload.phase):''} {item.payload.expectedDate??''}</Link><button className="mr-2 text-indigo-700" onClick={()=>void apiFetch(`/api/customer-orders/notifications/${item.id}/read`,{method:'POST',body:JSON.stringify({read:!item.readAt})}).then(load).catch(e=>setError(String(e)))}>{item.readAt?'كغير مقروء':'تمت القراءة'}</button></article>)}{!items.length&&!error&&<p className="py-2 text-xs text-slate-500">لا توجد تنبيهات موجهة إليك</p>}</div></section>;
}
