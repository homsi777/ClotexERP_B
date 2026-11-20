import {useEffect,useState} from 'react';
import {usePermissions} from '../../hooks/usePermissions';
import {getItemSpecificationHistory,listItemSpecifications,saveItemSpecification,type ItemSpecificationRow,type ItemSpecificationHistory} from '../../lib/api/orderWorkflowApi';
import {listManufacturingSpecifications,type ManufacturingSpecificationSummary} from '../../lib/api/manufacturingReferenceApi';

/** Parent integration: mount in the manufacturing specification library. */
export function ManufacturingItemSpecificationMapping(){
  const {has}=usePermissions();
  const [items,setItems]=useState<ItemSpecificationRow[]>([]),[specs,setSpecs]=useState<ManufacturingSpecificationSummary[]>([]);
  const [itemId,setItemId]=useState(''),[version,setVersion]=useState(''),[reason,setReason]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [history,setHistory]=useState<ItemSpecificationHistory[]>([]);
  const item=items.find(i=>i.id===itemId);
  const load=async()=>{
    const [rows,definitions]=await Promise.all([listItemSpecifications(),listManufacturingSpecifications()]);
    setItems(rows);setSpecs(definitions);
  };
  const canView=has('manufacturing.specifications.view');
  useEffect(()=>{if(canView)void load().catch(e=>setError(e.message));},[canView]);
  useEffect(()=>{
    let active=true;setHistory([]);
    if(itemId)void getItemSpecificationHistory(itemId).then(rows=>{if(active)setHistory(rows);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[itemId,items]);
  if(!canView)return null;
  const save=async()=>{
    if(!item)return;
    setBusy(true);setError('');
    try{await saveItemSpecification(item.id,{specificationVersionId:version||null,expectedRevision:Number(item.revision),reason});await load();setReason('');}
    catch(e){setError(e instanceof Error?e.message:'تعذر حفظ الربط؛ أعد تحميل القائمة عند تعارض التعديل');}
    finally{setBusy(false);}
  };
  return <fieldset dir="rtl" className="space-y-3 rounded-xl border bg-white p-4">
    <legend className="font-bold">المواصفة الافتراضية لخامة الدليل</legend>
    <p className="text-sm">الربط مثبت بإصدار معتمد. تغييره لا يعدل أوامر الإنتاج أو اللقطات السابقة. الإنتاج يحتاج تأكيداً مستقلاً.</p>
    {error&&<p role="alert" className="text-rose-700">{error}</p>}
    <button type="button" disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))} className="rounded border p-2">تحديث القائمة</button>
    <label className="block">الخامة <select className="max-w-full rounded border p-2" disabled={busy} value={itemId} onChange={e=>{setItemId(e.target.value);setVersion(items.find(i=>i.id===e.target.value)?.specification_version_id??'');setReason('');}}>
      <option value="">اختر من دليل الخامات</option>{items.map(i=><option key={i.id} value={i.id}>{i.internal_code} — {i.name}</option>)}
    </select></label>
    {item&&<>
      <p>مراجعة الربط: {item.revision} — {item.specification_code??'غير مربوط'} — {item.specification_status??''}</p>
      <label className="block">الإصدار المعتمد <select className="max-w-full rounded border p-2" disabled={busy||!has('manufacturing.specifications.approve')} value={version} onChange={e=>setVersion(e.target.value)}>
        <option value="">إلغاء الربط الافتراضي</option>
        {item.specification_version_id&&!specs.some(s=>s.is_active&&s.approved_version_id===item.specification_version_id)&&<option disabled value={item.specification_version_id}>إصدار سابق غير متاح للإنتاج</option>}
        {specs.filter(s=>s.is_active&&s.approved_version_id).map(s=><option key={s.id} value={s.approved_version_id!}>{s.code} — {s.name}</option>)}
      </select></label>
      <label className="block">سبب التغيير <input className="rounded border p-2" disabled={busy} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button type="button" className="rounded bg-indigo-600 p-2 text-white" disabled={busy||!reason.trim()||!has('manufacturing.specifications.approve')} onClick={()=>void save()}>حفظ الربط مع سجل تدقيق</button>
      <details><summary>تاريخ الربط</summary>{history.map(row=><p key={row.id} className="border-t py-2 text-sm">مراجعة {row.revision} — {row.specification_version_id??'إلغاء الربط'} — {row.reason} — {row.username??'—'} — {new Date(row.created_at).toLocaleString()}</p>)}</details>
    </>}
  </fieldset>;
}
