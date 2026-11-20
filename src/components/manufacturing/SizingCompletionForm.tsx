import {useState} from 'react';
import {completeSizingOrder,type SizingOrder} from '../../lib/api/manufacturingSizingApi';

const cls='mt-1 w-full rounded-lg border px-3 py-2 text-sm';
const fields=[['actualLengthM','الطول الفعلي بعد التصميغ (م)',true],['inputWeightKg','الوزن قبل التصميغ (كغ)',false],['outputWeightKg','الوزن بعد التصميغ (كغ)',false],['wasteWeightKg','هالك الوزن (كغ)',false],['moisturePercent','الرطوبة (%)',false],['stretchPercent','الاستطالة (%)',false]] as const;
export function SizingCompletionForm({order,onSaved,onCancel}:{order:SizingOrder;onSaved:()=>Promise<void>;onCancel:()=>void}){
  const [values,setValues]=useState<Record<string,string>>({actualLengthM:String(order.planned_length_m),inputWeightKg:'',outputWeightKg:'',wasteWeightKg:'',moisturePercent:'',stretchPercent:''});
  const [quality,setQuality]=useState<'ACCEPTED'|'CONDITIONAL'|'REJECTED'|''>(''),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();setError('');
    if(!quality){setError('اختر نتيجة الفحص صراحةً');return;}
    if(quality!=='ACCEPTED'&&notes.trim().length<3){setError('سجل سبب المعالجة أو الرفض');return;}
    const body:Record<string,unknown>={qualityStatus:quality,qualityNotes:notes.trim()||null};
    for(const [key,,required] of fields){const raw=values[key].trim();if(!raw){if(required){setError('الطول الفعلي مطلوب');return;}continue;}const n=Number(raw);if(!Number.isFinite(n)||n<0||(key==='moisturePercent'&&n>100)){setError('تحقق من القياسات المدخلة');return;}body[key]=n;}
    if(quality==='ACCEPTED'&&Number(body.actualLengthM)<=0){setError('الطول المقبول يجب أن يكون أكبر من صفر');return;}
    setBusy(true);try{await completeSizingOrder(order.id,body);await onSaved();}catch(e){setError(e instanceof Error?e.message:'تعذر حفظ الفحص');}finally{setBusy(false);}
  };
  return <form onSubmit={e=>void submit(e)} className="mb-4 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4" dir="rtl" data-sizing-completion={order.id}><h3 className="font-bold">فحص وقياسات التصميغ — {order.sizing_order_no}</h3><p className="text-sm text-slate-600">سجل القياسات التي قرأتها فعلياً. الحقول الاختيارية الفارغة تبقى غير مقاسة.</p>{error&&<p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p>}<fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key,label,required])=><label key={key} className="text-sm">{label}<input aria-label={label} type="number" min="0" max={key==='moisturePercent'?100:undefined} step="0.001" required={required} className={cls} value={values[key]} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}<label className="text-sm">نتيجة الفحص<select aria-label="نتيجة فحص التصميغ" required className={cls} value={quality} onChange={e=>setQuality(e.target.value as typeof quality)}><option value="">اختر نتيجة الفحص</option><option value="ACCEPTED">جاهزة للنسج</option><option value="CONDITIONAL">تحتاج معالجة وإعادة فحص</option><option value="REJECTED">مرفوضة</option></select></label><label className="text-sm sm:col-span-2">سبب القرار وملاحظات الفحص<textarea aria-label="ملاحظات فحص التصميغ" maxLength={2000} required={quality==='CONDITIONAL'||quality==='REJECTED'} className={cls} value={notes} onChange={e=>setNotes(e.target.value)}/></label><div className="flex items-end gap-2"><button type="submit" disabled={!quality} className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">اعتماد نتيجة التصميغ</button><button type="button" className="rounded-lg border px-4 py-2" onClick={onCancel}>إلغاء</button></div></fieldset></form>;
}
