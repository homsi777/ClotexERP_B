import { DateInput } from '../common/DateInput';
import React, { useEffect, useState } from 'react';
import type { CustomerOrderMetadata } from '../../types';
import { createOrderOffice, listOrderMetadataOptions, type OrderMetadataOptions } from '../../lib/api/customerOrdersApi';

export const orderMetadataLabels = {
 receivedOfficeId: 'المكتب / الفرع المستلم', takenByEmployeeId: 'الموظف الآخذ للطلب',
 followUpEmployeeId: 'موظف المتابعة', followUpUserId: 'مستخدم المتابعة (الإشعارات)',
 sampleKind: 'نوع العينة', sampleStatus: 'حالة العينة', sampleRequestedDate: 'تاريخ طلب العينة',
 sampleReceivedDate: 'تاريخ استلام العينة', sampleApprovedDate: 'تاريخ اعتماد العينة',
} as const;
export const sampleStatusLabels: Record<string,string> = {requested:'مطلوبة',received:'مستلمة',approved:'معتمدة',rejected:'مرفوضة'};
export function OrderMetadataFields({value,onChange}:{value:CustomerOrderMetadata;onChange:(value:CustomerOrderMetadata)=>void}) {
 const [options,setOptions] = useState<OrderMetadataOptions>({offices:[],employees:[],users:[],takers:[]});
 const [error,setError] = useState('');
 const [officeDraft,setOfficeDraft] = useState({code:'',name:''});
 const [addingOffice,setAddingOffice] = useState(false);
 const addOffice = async () => {
  setAddingOffice(true); setError('');
  try {
   const office=await createOrderOffice(officeDraft.code,officeDraft.name);
   setOptions(previous=>({...previous,offices:[...previous.offices,office]}));
   onChange({...value,receivedOfficeId:office.id}); setOfficeDraft({code:'',name:''});
  } catch(error) {setError(error instanceof Error ? error.message : 'تعذر إنشاء المكتب');}
  finally {setAddingOffice(false);}
 };

 useEffect(()=>{ let active=true; listOrderMetadataOptions().then(data=>{if(active)setOptions(data);}).catch(()=>{if(active)setError('تعذر تحميل دليل المسؤوليات');}); return ()=>{active=false;}; },[]);
 const directories = {receivedOfficeId:options.offices,takenByEmployeeId:options.employees,followUpEmployeeId:options.employees,followUpUserId:options.users};
 return <fieldset className="col-span-full grid grid-cols-1 md:grid-cols-3 gap-3 border rounded-xl p-3">
  <legend className="px-2 font-bold text-sm">استلام الطلب والمسؤوليات والعينة الاختيارية</legend>
  {error && <p role="alert" className="col-span-full text-rose-600">{error}</p>}
  {Object.entries(orderMetadataLabels).map(([key,label])=>{
   const field=key as keyof typeof orderMetadataLabels;
   const directory=directories[field as keyof typeof directories];
   if (field==='takenByEmployeeId') return <label key={key} className="text-xs font-bold text-slate-700">{label}
    <input className="block w-full border rounded-lg p-2" list="order-takers" maxLength={120} placeholder="اكتب الاسم — يُحفظ ويظهر في الاقتراحات"
     value={value.takenByName ?? value.takenByEmployeeName ?? ''}
     onChange={e=>onChange({...value,takenByName:e.target.value,takenByEmployeeId:undefined})}/>
    <datalist id="order-takers">{(options.takers??[]).map(n=><option key={n} value={n}/>)}</datalist>
   </label>;
   return <label key={key} className="text-xs font-bold text-slate-700">{label}
    {directory ? <select className="block w-full border rounded-lg p-2" value={value[field] || ''} onChange={e=>onChange({...value,[field]:e.target.value || null})}>
     <option value="">—</option>
     {directory.filter(o=>o.isActive || o.id===value[field]).map(o=><option key={o.id} value={o.id}>{o.name}{o.isActive?'':' (غير فعال)'}</option>)}
    </select> : field==='sampleStatus' ? <select className="block w-full border rounded-lg p-2" value={value.sampleStatus || ''} onChange={e=>onChange({...value,sampleStatus:(e.target.value || null) as CustomerOrderMetadata['sampleStatus']})}>
     <option value="">—</option>{Object.entries(sampleStatusLabels).map(([id,name])=><option key={id} value={id}>{name}</option>)}
    </select> : field.endsWith('Date') ? <DateInput className="block w-full border rounded-lg p-2" value={value[field] || ''} onChange={e=>onChange({...value,[field]:e.target.value || null})}/> : <input className="block w-full border rounded-lg p-2" type="text" maxLength={120} value={value[field] || ''} onChange={e=>onChange({...value,[field]:e.target.value || null})}/>}
   </label>;
  })}
  <details className="col-span-full text-xs"><summary className="cursor-pointer">إضافة مكتب / فرع إلى الدليل</summary>
   <div className="flex flex-wrap gap-2 mt-2">
    <input aria-label="رمز المكتب" placeholder="رمز المكتب" maxLength={40} value={officeDraft.code} onChange={e=>setOfficeDraft({...officeDraft,code:e.target.value})} className="border rounded p-2"/>
    <input aria-label="اسم المكتب" placeholder="اسم المكتب" maxLength={120} value={officeDraft.name} onChange={e=>setOfficeDraft({...officeDraft,name:e.target.value})} className="border rounded p-2"/>
    <button type="button" disabled={addingOffice || !officeDraft.code.trim() || !officeDraft.name.trim()} onClick={()=>void addOffice()} className="border rounded p-2 disabled:opacity-50">إضافة المكتب</button>
   </div>
  </details>
  <p className="col-span-full text-xs text-slate-500">العينة اختيارية واعتمادها مستقل عن بدء الإنتاج. دليل المكاتب مستقل عن المستودعات والعملاء.</p>
 </fieldset>;
}
export function OrderMetadataSummary({order}:{order:CustomerOrderMetadata}) {
 return <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 text-xs" dir="rtl">
 {Object.entries(orderMetadataLabels).map(([key,label])=>{
  const field=key as keyof typeof orderMetadataLabels;
  const display=field.endsWith('Id') ? order[field.replace(/Id$/,'Name') as keyof CustomerOrderMetadata] : field==='sampleStatus' ? sampleStatusLabels[order.sampleStatus || ''] : order[field];
  return <div key={key}><dt className="text-slate-500">{label}</dt><dd className="font-bold">{display || '—'}</dd></div>;
 })}</dl>;
}
