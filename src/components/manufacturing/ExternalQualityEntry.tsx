import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFinishedQualityReport, finishedQualityAction, type FinishedQualityDetail } from '../../lib/api/manufacturingQualityApi';
import type { QualityDefect } from '../../lib/api/manufacturingReferenceApi';
import { QualityChecklist, type ChecklistRow } from './QualityChecklist';
export function ExternalQualityEntry({id,defects,canInspect,canApprove,onChanged}:{id:string;defects:QualityDefect[];canInspect:boolean;canApprove:boolean;onChanged:()=>void}) {
 const [detail,setDetail]=useState<FinishedQualityDetail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [checklist,setChecklist]=useState<ChecklistRow[]>([]),[notes,setNotes]=useState(''),[decisionNotes,setDecisionNotes]=useState('');
 const [images,setImages]=useState('');
 const [evidence,setEvidence]=useState<FinishedQualityDetail['quality_defects']>([]);
 useEffect(()=>{let active=true;setDetail(null);getFinishedQualityReport(id).then(d=>{if(active){setDetail(d);setChecklist(d.quality_checklist);setNotes(d.quality_notes??'');setEvidence(d.quality_defects);setImages((d.quality_images??[]).join('\n'));setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
 const run=async(action:'inspection'|'decision',body:unknown)=>{setBusy(true);setError('');try{await finishedQualityAction(id,action,body);setDetail(await getFinishedQualityReport(id));onChanged();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 if(!detail)return <p role="status">{error||"تحميل سجل الجودة…"}</p>;
 const imageList=(value:string)=>value.split('\n').map(v=>v.trim()).filter(Boolean);
 const editable=canInspect&&!detail.resolution&&['RESERVED','AVAILABLE'].includes(detail.roll_status);
 return <article dir="rtl" className="space-y-3 rounded-xl border p-4">
  <h3 className="font-bold">جودة الجاهز — {detail.job_no} / {detail.dye_paper_no}</h3>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  <div className="flex flex-wrap gap-3 text-indigo-700">
   <Link to={`/purchases/external-jobs/${detail.job_id}?from=manufacturing&quality=1`}>مستند المصدر وتقارير الدفعات</Link>
   <Link to={`/inventory/create?externalJobId=${detail.job_id}`}>استلام المستودع الحالي</Link>
   <a href={`/api/manufacturing/quality/finished/${id}/report`} onClick={e=>{e.preventDefault();void getFinishedQualityReport(id).then(d=>{const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`quality-${id}.json`;a.click();URL.revokeObjectURL(url);}).catch(e=>setError(String(e.message)));}}>تنزيل تقرير المصدر</a>
  </div>
  <p>الرول: {detail.sent_barcode} ← {detail.barcode} — {detail.length_m} م — {detail.roll_status}</p>
  <p>الطلب / السطر: {detail.order_no??"مخزون"} / {detail.line_no??"—"} <span className="text-xs">{detail.customer_order_line_id}</span></p>
  <p>المستلم: {detail.receiver_name??"غير مسجل"} — الفاحص: {detail.inspector_name??"لم يفحص"} {detail.inspected_at} — المعتمد: {detail.approver_name??"لم يعتمد"} {detail.resolved_at}</p>
  <p>نتيجة الجودة: {detail.quality_decision} — {detail.defective?'حفظ الفحص لا يفك الحجز؛ يلزم قرار معتمد.':'الاستلام السليم لا يحتاج قرار فض حجز؛ حفظ الفحص يوثق القبول.'}</p>
  {(detail.quality_images??[]).map((url,i)=><a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block text-indigo-700">صورة الفحص {i+1}</a>)}
  <p>العيب: {detail.defect_reason??"لا يوجد"} — المسؤول: {detail.responsible_party??"—"} — القرار: {detail.resolution??"لم يحسم"} {detail.resolution_notes}</p>
  <fieldset disabled={busy||!editable} className="space-y-2">
   <QualityChecklist value={checklist} onChange={setChecklist}/>
   <label>ملاحظات الفحص<textarea className="w-full rounded border p-2" value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   <label className="block">روابط صور الفحص (اختيارية؛ رابط HTTPS أو /uploads/ في كل سطر)<textarea aria-label="صور الفحص" className="w-full rounded border p-2" value={images} onChange={e=>setImages(e.target.value)}/></label>
   <h4>تفاصيل العيوب</h4>
   {evidence.map((d,i)=><div key={i} className="grid gap-2 sm:grid-cols-3">
    <select aria-label="نوع العيب" value={d.defectId} onChange={e=>setEvidence(a=>a.map((v,j)=>j===i?{...v,defectId:e.target.value}:v))}><option value="">اختر العيب</option>{defects.filter(d=>d.is_active&&['ALL','FINISHED_FABRIC'].includes(d.inspection_type)).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
    <input aria-label="موقع العيب بالمتر" type="number" min="0" max={Number(detail.length_m)} step="0.001" value={d.positionM??''} onChange={e=>setEvidence(a=>a.map((v,j)=>j===i?{...v,positionM:e.target.value===''?null:Number(e.target.value)}:v))}/>
    <textarea aria-label="صور العيب" placeholder="روابط صور العيب؛ رابط في كل سطر" value={(d.imageUrls??[]).join('\n')} onChange={e=>setEvidence(a=>a.map((v,j)=>j===i?{...v,imageUrls:imageList(e.target.value)}:v))}/>
    <input aria-label="عدد العيوب" type="number" min="1" value={d.quantity} onChange={e=>setEvidence(a=>a.map((v,j)=>j===i?{...v,quantity:Number(e.target.value)}:v))}/>
    <select aria-label="شدة العيب" value={d.severity} onChange={e=>setEvidence(a=>a.map((v,j)=>j===i?{...v,severity:e.target.value as typeof d.severity}:v))}><option value="MINOR">بسيط</option><option value="MAJOR">جسيم</option><option value="CRITICAL">حرج</option></select>
    <input aria-label="ملاحظات العيب" value={d.notes} onChange={e=>setEvidence(a=>a.map((v,j)=>j===i?{...v,notes:e.target.value}:v))}/>
    <button onClick={()=>setEvidence(a=>a.filter((_,j)=>j!==i))}>حذف</button>
   </div>)}
   {detail.defective&&<button className="rounded border p-2" onClick={()=>setEvidence(a=>[...a,{defectId:'',quantity:1,severity:'MINOR',notes:''}])}>إضافة عيب</button>}
   {editable&&<button className="rounded bg-indigo-600 p-2 text-white" disabled={evidence.some(d=>!d.defectId||d.quantity<1)} onClick={()=>void run('inspection',{checklist,notes,defects:evidence,images:imageList(images)})}>حفظ الفحص</button>}
  </fieldset>
  {detail.defective&&!detail.resolution&&canApprove&&<fieldset disabled={busy} className="space-y-2"><legend>قرار الجودة المعتمد</legend>
   <textarea aria-label="سبب القرار" className="w-full rounded border p-2" value={decisionNotes} onChange={e=>setDecisionNotes(e.target.value)} placeholder="سبب القرار مطلوب"/>
   {(['ACCEPT','REWORK','WRITE_OFF'] as const).map((decision,i)=><button className="ms-2 rounded border p-2 disabled:opacity-50" key={decision} disabled={!decisionNotes.trim()} onClick={()=>void run('decision',{decision,notes:decisionNotes})}>{['قبول','إعادة معالجة','إعدام'][i]}</button>)}
  </fieldset>}
  {detail.resolution==='REWORK'&&<Link className="text-indigo-700" to={`/purchases/external-jobs/processing/new?previousJobId=${detail.job_id}&from=manufacturing`}>إنشاء إعادة معالجة مرتبطة</Link>}
 </article>;
}
