import { DateInput } from '../common/DateInput';
import {useEffect,useRef,useState} from 'react';
import {getExecutionTracking,saveExecutionTracking,type ExecutionStage,type ExecutionData,type ExecutionOption} from '../../lib/api/manufacturingExecutionApi';

/** Mount with key={stage + subjectId} when switching orders. onChanged refreshes the parent version. */
type Props={stage:ExecutionStage;subjectId:string;canManage:boolean;onChanged?:()=>void|Promise<void>};
export function ExecutionTrackingPanel({stage,subjectId,canManage,onChanged}:Props){
 const [data,setData]=useState<ExecutionData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [date,setDate]=useState(new Date().toLocaleDateString('en-CA')),[shift,setShift]=useState(''),[machine,setMachine]=useState(''),[length,setLength]=useState('0'),[shiftLog,setShiftLog]=useState('');
 const [workers,setWorkers]=useState([{employeeId:'',minutes:480}]),[downtimes,setDowntimes]=useState<Array<{reasonId:string;minutes:number}>>([]);
 const [startedAt,setStartedAt]=useState(''),[endedAt,setEndedAt]=useState('');
 const [scan,setScan]=useState(''),[sender,setSender]=useState(''),[recipient,setRecipient]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[notes,setNotes]=useState(''),[threads,setThreads]=useState('0'),[yarn,setYarn]=useState('');
 const request=useRef<{serialized:string;id:string}|null>(null);
 const beam=stage==='WARP'||stage==='SIZED';
 useEffect(()=>{let active=true;setData(null);setError('');request.current=null;getExecutionTracking(stage,subjectId).then(d=>{if(active){setData(d);setFrom(d.subject.custody_location??'');setSender(d.subject.custody_employee_id??'');}}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[stage,subjectId]);
 const save=async(operation:string)=>{
  if(!data)return;setBusy(true);setError('');
  const body:Record<string,unknown>={version:data.subject.version,operation,notes,...(operation==='HANDOVER'?{barcode:scan,senderEmployeeId:sender,recipientEmployeeId:recipient,fromLocation:from,toLocation:to}:operation==='SELVEDGE_OVERRIDE'?{threadCount:Number(threads),yarnDescription:yarn}:{productionDate:date,shiftTypeId:shift,machineId:machine,lengthM:Number(length),workers,downtimes,...(stage==='WEAVING'?{shiftLogId:shiftLog}:{})})};
  if(operation==='DAILY_LOG'){
   if(startedAt)body.startedAt=`${date}T${startedAt}`;
   if(endedAt)body.endedAt=`${date}T${endedAt}`;
  }
  const serialized=JSON.stringify(body);if(request.current?.serialized!==serialized)request.current={serialized,id:crypto.randomUUID()};
  try{await saveExecutionTracking(stage,subjectId,{...body,requestId:request.current.id});request.current=null;setData(await getExecutionTracking(stage,subjectId));setNotes('');await onChanged?.();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 const select=(label:string,value:string,change:(v:string)=>void,options:ExecutionOption[])=><label className="grid gap-1 text-sm">{label}<select aria-label={label} value={value} onChange={e=>change(e.target.value)} className="rounded border p-2"><option value="">اختر</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
 const input=(label:string,value:string,change:(v:string)=>void,type='text')=><label className="grid gap-1 text-sm">{label}{type==='date' ? <DateInput aria-label={label} value={value} onChange={e=>change(e.target.value)} className="rounded border p-2"/> : <input aria-label={label} type={type} value={value} onChange={e=>change(e.target.value)} className="rounded border p-2"/>}</label>;
 return <section dir="rtl" className="space-y-3 rounded-xl border bg-white p-4" aria-busy={busy}><h3 className="font-bold">تتبع التنفيذ التشغيلي</h3>{error&&<p role="alert" className="text-red-700">{error}</p>}{!data?<p>جار تحميل بيانات التشغيل…</p>:<>
 <p>الحالة: {data.subject.status} / الإصدار: {data.subject.version}</p>
 {canManage&&<fieldset disabled={busy} className="space-y-3">
 {beam?<div className="grid gap-2 md:grid-cols-2">{input('مسح باركود المطواة',scan,setScan)}{select('المرسل الفعلي',sender,setSender,data.employees)}{select('المستلم الفعلي',recipient,setRecipient,data.employees)}{input('من الموقع',from,setFrom)}{input('إلى الموقع',to,setTo)}</div>:<>
 {stage==='WEAVING'&&select('وردية الإنتاج المسجلة',shiftLog,v=>{setShiftLog(v);const s=data.shiftLogs.find(s=>s.id===v);if(s){setDate(s.production_date.slice(0,10));setShift(s.shift_type_id);setLength(String(s.produced_length_m));}},data.shiftLogs.map(s=>({id:s.id,name:`${s.production_date.slice(0,10)} / ${s.produced_length_m} / / ${s.downtime_minutes} دقيقة توقف`})))}
 <div className="grid gap-2 md:grid-cols-3">{input('تاريخ التشغيل',date,setDate,'date')}{select('الوردية',shift,setShift,data.shifts)}{select('الماكينة',machine,setMachine,data.machines.filter(m=>m.machine_type===(stage==='WEAVING'?'LOOM':stage)))}{input('الطول المنفذ بالمتر',length,setLength,'number')}</div>
 <div className="grid gap-2 md:grid-cols-2">{input('بداية التشغيل الفعلية (اختياري)',startedAt,setStartedAt,'time')}{input('نهاية التشغيل الفعلية (اختياري)',endedAt,setEndedAt,'time')}</div>
 <p className="text-sm text-slate-600">أدخل الوقتين معاً بتوقيت المصنع وفي يوم الإنتاج نفسه. عند تركهما فارغين لا تُحتسب مدة للماكينة. دقائق العمال تمثل وقت العمل البشري.</p>
 <h4>العمال</h4>{workers.map((w,i)=><div key={i} className="flex items-end gap-2">{select(`العامل ${i+1}`,w.employeeId,v=>setWorkers(workers.map((x,n)=>n===i?{...x,employeeId:v}:x)),data.employees)}{input(`دقائق العمل ${i+1}`,String(w.minutes),v=>setWorkers(workers.map((x,n)=>n===i?{...x,minutes:Number(v)}:x)),'number')}<button type="button" onClick={()=>setWorkers(workers.filter((_,n)=>n!==i))}>إزالة</button></div>)}<button type="button" onClick={()=>setWorkers([...workers,{employeeId:'',minutes:480}])}>إضافة عامل</button>
 <h4>التوقفات</h4>{downtimes.map((d,i)=><div key={i} className="flex items-end gap-2">{select(`سبب التوقف ${i+1}`,d.reasonId,v=>setDowntimes(downtimes.map((x,n)=>n===i?{...x,reasonId:v}:x)),data.reasons.filter(r=>r.stage==='ALL'||r.stage===stage))}{input(`دقائق التوقف ${i+1}`,String(d.minutes),v=>setDowntimes(downtimes.map((x,n)=>n===i?{...x,minutes:Number(v)}:x)),'number')}<button type="button" onClick={()=>setDowntimes(downtimes.filter((_,n)=>n!==i))}>إزالة</button></div>)}<button type="button" onClick={()=>setDowntimes([...downtimes,{reasonId:'',minutes:1}])}>إضافة توقف</button>
 </>}
 {input('ملاحظات / سبب العملية',notes,setNotes)}<button type="button" className="rounded bg-indigo-700 px-4 py-2 text-white" onClick={()=>void save(beam?'HANDOVER':'DAILY_LOG')}>حفظ {beam?'التسليم':'سجل التشغيل'}</button>
 {stage==='WARPING'&&<div className="space-y-2 border-t pt-3"><h4>تجاوز خيط الحاشية التشغيلي</h4><p className="text-sm">تُحفظ المواصفة الأصلية دون تعديل.</p>{input('عدد خيوط الحاشية',threads,setThreads,'number')}{input('وصف خيط الحاشية البديل',yarn,setYarn)}<button type="button" onClick={()=>void save('SELVEDGE_OVERRIDE')}>حفظ تجاوز الحاشية</button>{data.subject.selvedge_override&&<pre className="whitespace-pre-wrap">{JSON.stringify(data.subject.selvedge_override,null,2)}</pre>}</div>}
 </fieldset>}
 <h4 className="font-semibold">سجل العمليات</h4>{data.history.length===0&&<p>لا توجد عمليات مسجلة.</p>}{data.history.map(h=><details key={h.id} className="rounded border p-2"><summary>{h.operation} / {new Date(h.created_at).toLocaleString('ar')} / {h.created_by_user_id}</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(h.details,null,2)}</pre></details>)}
 </>}</section>;
}
