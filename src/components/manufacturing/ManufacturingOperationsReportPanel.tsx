import {useEffect,useState} from 'react';
import {apiFetch} from '../../lib/api/client';
import {usePermissions} from '../../hooks/usePermissions';
import {openDocumentPrintWindow} from '../../lib/printing/documentPrint';
import {type AllStageOperationsReport,type Columns,type ReportRow,operationColumns,activityColumns,yarnColumns,stageSummaryColumns,yarnSummaryColumns,stageLabels,reportNotes,reportDisplay,reportIsTruncated,renderAllStageReport,exportAllStageReportCsv} from '../../lib/manufacturingOperationsReport';
type Row={id:string;production_date:string;work_order_no:string;run_no:string;specification_code:string;machine_code:string;employee_name:string|null;shift_name:string|null;customer_orders:string|null;counter_start:number;counter_end:number;produced_m:number;clean_m:number;rework_m:number;rejected_m:number;pending_m:number;received_m:number;downtime_minutes:number;downtime_reason:string|null};
type Report={rows:Row[];summary:{produced_m:number;planned_m:number;clean_m:number;rejected_m:number;rework_m:number;pending_m:number;received_m:number;downtime_minutes:number;row_count:number};truncated:boolean};
const fields=['production_date','work_order_no','run_no','customer_orders','specification_code','machine_code','employee_name','shift_name','counter_start','counter_end','produced_m','clean_m','rework_m','rejected_m','pending_m','received_m','downtime_minutes','downtime_reason'] as const;
const labels=['التاريخ','أمر الإنتاج','التشغيلة','أوردرات العملاء','المواصفة','الماكينة','الموظف','الوردية','العداد أول','العداد آخر','المنتج م','النظيف المعتمد','المعالجة','الهالك','المعلق','مستلم خام','التوقف دقائق','سبب التوقف'];
const esc=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function WeavingOperationsReportPanel(){
  const {has}=usePermissions(),[filters,setFilters]=useState({dateFrom:'',dateTo:'',search:'',machineId:'',employeeId:'',shiftId:''}),[data,setData]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [options,setOptions]=useState<Record<'machines'|'employees'|'shifts',Array<{id:string;name:string;code?:string}>>>({machines:[],employees:[],shifts:[]});
  useEffect(()=>{void apiFetch<{data:typeof options}>('/api/manufacturing/reference/operations-report/options').then(result=>setOptions(result.data)).catch(e=>setError(String(e)));},[]);
  const selectors=<>{([['machineId','machines','الماكينة'],['employeeId','employees','الموظف'],['shiftId','shifts','الوردية']] as const).map(([field,key,label])=><select key={field} aria-label={label} className="rounded border p-2" value={filters[field]} onChange={e=>setFilters({...filters,[field]:e.target.value})}><option value="">كل {label}</option>{options[key].map(o=><option key={o.id} value={o.id}>{o.code?o.code+' — ':''}{o.name}</option>)}</select>)}</>;
  const run=async(action:'view'|'print'|'export')=>{setBusy(true);setError('');try{const query=new URLSearchParams({action});for(const [key,value] of Object.entries(filters))if(value)query.set(key,value);const result=await apiFetch<{data:Report}>(`/api/manufacturing/reference/operations-report?${query}`);setData(result.data);
    if(action==='print'){
      const html=`<!doctype html><html dir="rtl"><meta charset="utf-8"><title>تقرير الإنتاج والجودة</title><style>@page{size:A4 landscape;margin:8mm}body{font:10px Arial}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:3px}thead{display:table-header-group}</style><h2>تقرير إنتاج الورديات والجودة واستلام الخام</h2><p>${esc(filters.dateFrom)} — ${esc(filters.dateTo)} | ${esc(filters.search)}</p><p>المنتج: ${result.data.summary.produced_m} م — النظيف المعتمد: ${result.data.summary.clean_m} م — التوقف: ${result.data.summary.downtime_minutes} دقيقة</p>${result.data.truncated?'<p>التفاصيل محددة بأول 500 سجل؛ ضيق الفترة لاستكمال الطباعة.</p>':''}<table><thead><tr>${labels.map(l=>`<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${result.data.rows.map(row=>`<tr>${fields.map(f=>`<td>${esc(row[f])}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`;
      if(!openDocumentPrintWindow(html,'تقرير الإنتاج والجودة'))throw new Error('اسمح بفتح نافذة الطباعة');
    }
    if(action==='export'){
      const csvCell=(value:unknown)=>{let s=String(value??'');if(typeof value==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
      const content='\uFEFF'+[labels,...result.data.rows.map(row=>fields.map(f=>row[f]))].map(row=>row.map(csvCell).join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='manufacturing-production.csv';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }catch(e){setError(e instanceof Error?e.message:'تعذر تحميل التقرير');}finally{setBusy(false);}};
  return <section className="space-y-4 p-4" dir="rtl"><h3 className="text-lg font-bold">تقرير إنتاج الورديات والجودة واستلام الخام</h3><div className="flex flex-wrap gap-2"><input aria-label="من تاريخ الإنتاج" type="date" className="rounded border p-2" value={filters.dateFrom} onChange={e=>setFilters({...filters,dateFrom:e.target.value})}/><input aria-label="إلى تاريخ الإنتاج" type="date" className="rounded border p-2" value={filters.dateTo} onChange={e=>setFilters({...filters,dateTo:e.target.value})}/><input aria-label="بحث تقرير الإنتاج" className="rounded border p-2" placeholder="أوردر العميل / أمر الإنتاج / المواصفة" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/>{selectors}<button disabled={busy} className="rounded bg-indigo-600 p-2 text-white" onClick={()=>void run('view')}>عرض التقرير</button>{has('manufacturing.reports.print')&&<button disabled={busy} className="rounded border p-2" onClick={()=>void run('print')}>طباعة</button>}{has('manufacturing.reports.export')&&<button disabled={busy} className="rounded border p-2" onClick={()=>void run('export')}>تصدير CSV</button>}</div>{error&&<p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p>}{data&&<><div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">{Object.entries({produced_m:'المنتج خلال الفترة',planned_m:'مخطط التشغيلات المحددة',clean_m:'النظيف المعتمد',rejected_m:'الهالك المعتمد',rework_m:'يحتاج معالجة',pending_m:'بانتظار الاعتماد',received_m:'المستلم بمستودع الخام',downtime_minutes:'دقائق التوقف'}).map(([key,label])=><div key={key} className="rounded bg-slate-50 p-3">{label}: <strong>{Number(data.summary[key as keyof Report['summary']]).toLocaleString()}</strong></div>)}</div><p className="text-sm text-slate-600">المخطط يحتسب مرة واحدة لكل تشغيلة، والإنتاج حسب فترة التقرير. ساعات التشغيل الفعلية لا تستنتج من الحضور أو من عدد الورديات. التقرير لا يتضمن أجوراً أو قيوداً مالية.</p>{data.truncated&&<p className="text-amber-700">الملخص يشمل النتائج المطابقة، والتفاصيل تعرض أول 500 سجل؛ ضيق الفترة لتصدير كامل التفاصيل.</p>}<div className="overflow-auto"><table className="w-full min-w-[1300px] text-right text-xs"><thead><tr>{labels.map(l=><th key={l} className="border p-2">{l}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row.id}>{fields.map(f=><td key={f} className="border p-2">{row[f]??'—'}</td>)}</tr>)}</tbody></table></div></>}</section>;
}

function StageReportTable({title,rows,columns}:{title:string;rows:ReportRow[];columns:Columns}){
  return <section className="space-y-2"><h4 className="font-bold">{title}</h4><div className="overflow-auto"><table className="w-full min-w-[1000px] text-right text-xs"><thead><tr>{columns.map(([key,label])=><th key={key} className="border bg-slate-50 p-2">{label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={String(row.id??row.stage??i)}>{columns.map(([key])=><td key={key} className="border p-2">{reportDisplay(key,row[key])}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="p-4 text-slate-500">لا توجد سجلات مطابقة</p>}</div></section>;
}
function AllStageReportPanel(){
  const {has}=usePermissions();
  const [filters,setFilters]=useState({stage:'ALL',dateFrom:'',dateTo:'',search:'',machineId:'',employeeId:'',shiftId:''});
  const [data,setData]=useState<AllStageOperationsReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [options,setOptions]=useState<Record<'machines'|'employees'|'shifts',Array<{id:string;name:string;code?:string}>>>({machines:[],employees:[],shifts:[]});
  useEffect(()=>{let active=true;void apiFetch<{data:typeof options}>('/api/manufacturing/reference/operations-report/options').then(r=>{if(active)setOptions(r.data);}).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));});return()=>{active=false;};},[]);
  const description=()=>[
    stageLabels[filters.stage],`الفترة: ${filters.dateFrom||'البداية'} — ${filters.dateTo||'النهاية'}`,filters.search,
    ...([['machineId','machines'],['employeeId','employees'],['shiftId','shifts']] as const).map(([f,k])=>options[k].find(o=>o.id===filters[f])?.name),
  ].filter(Boolean).join(' | ');
  const run=async(action:'view'|'print'|'export')=>{
    if(filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo){setError('فترة التقرير غير صالحة');return;}
    const popup=action==='print'?window.open('','_blank','width=1200,height=900'):null;
    if(action==='print'&&!popup){setError('اسمح بفتح نافذة الطباعة');return;}
    if(popup){popup.opener=null;popup.document.body.textContent='جارٍ تحميل التقرير…';}
    setBusy(true);setError('');
    try{
      const query=new URLSearchParams({action});for(const [key,value] of Object.entries(filters))if(value)query.set(key,value);
      const result=await apiFetch<{data:AllStageOperationsReport}>('/api/manufacturing/reference/operations-report/stages?'+query);
      setData(result.data);
      if(popup){if(popup.closed)throw new Error('تم إغلاق نافذة الطباعة');popup.document.open();popup.document.write(renderAllStageReport(result.data,description()));popup.document.close();await popup.document.fonts.ready;popup.focus();popup.print();}
      if(action==='export'){
        const url=URL.createObjectURL(new Blob([exportAllStageReportCsv(result.data,description())],{type:'text/csv;charset=utf-8'}));
        const a=document.createElement('a');a.href=url;a.download='manufacturing-all-stages.csv';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    }catch(e){popup?.close();setError(e instanceof Error?e.message:'تعذر تحميل التقرير');}finally{setBusy(false);}
  };
  return <section className="space-y-4 p-4" dir="rtl"><h3 className="text-lg font-bold">تقرير مراحل التصنيع والخيط والتنفيذ</h3>
    <fieldset disabled={busy} className="flex flex-wrap gap-2"><legend className="sr-only">فلاتر تقرير التصنيع</legend>
      <select aria-label="مرحلة التصنيع" className="rounded border p-2" value={filters.stage} onChange={e=>setFilters({...filters,stage:e.target.value})}>{Object.entries(stageLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <input aria-label="من تاريخ الإنتاج" type="date" className="rounded border p-2" value={filters.dateFrom} onChange={e=>setFilters({...filters,dateFrom:e.target.value})}/>
      <input aria-label="إلى تاريخ الإنتاج" type="date" className="rounded border p-2" value={filters.dateTo} onChange={e=>setFilters({...filters,dateTo:e.target.value})}/>
      <input aria-label="بحث تقرير المراحل" className="rounded border p-2" placeholder="أمر الإنتاج / المرحلة / أوردر العميل / المواصفة" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/>
      {([['machineId','machines','الماكينة'],['employeeId','employees','العامل'],['shiftId','shifts','الوردية']] as const).map(([field,key,label])=><select key={field} aria-label={label} className="rounded border p-2" value={filters[field]} onChange={e=>setFilters({...filters,[field]:e.target.value})}><option value="">كل {label}</option>{options[key].map(o=><option key={o.id} value={o.id}>{o.code?o.code+' — ':''}{o.name}</option>)}</select>)}
      {(has('manufacturing.reports.view')||has('reports.view'))&&<button className="rounded bg-indigo-600 p-2 text-white" onClick={()=>void run('view')}>عرض التقرير</button>}
      {has('manufacturing.reports.print')&&<button className="rounded border p-2" onClick={()=>void run('print')}>طباعة</button>}
      {has('manufacturing.reports.export')&&<button className="rounded border p-2" onClick={()=>void run('export')}>تصدير CSV</button>}
    </fieldset>
    <p className="rounded bg-slate-50 p-3 text-sm text-slate-600">{reportNotes}</p>
    {busy&&<p role="status">جارٍ تحميل التقرير…</p>}{error&&<p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p>}
    {data&&<><p className="text-xs text-slate-500">وقت الطلب: {data.generatedAt} — الأوامر: {data.counts.rows} — الأنشطة: {data.counts.activities} — سطور الصرف: {data.counts.yarn}</p>
      {reportIsTruncated(data)&&<p role="alert" className="text-amber-700">التفاصيل محددة بأول 500 سجل لكل قسم، والملخص يشمل جميع النتائج؛ ضيق الفلاتر لتصدير التفاصيل كاملة.</p>}
      <StageReportTable title="ملخص الأوامر حسب المرحلة" rows={data.stageSummary} columns={stageSummaryColumns}/>
      <StageReportTable title="ملخص المواد حسب المرحلة — الاستهلاك والعهدة المعلومان فقط" rows={data.yarnSummary} columns={yarnSummaryColumns}/>
      <StageReportTable title="المخطط والمخرج والمتبقي لكل أمر" rows={data.rows} columns={operationColumns}/>
      <StageReportTable title="سجلات التنفيذ والعمال والتوقفات" rows={data.activities} columns={activityColumns}/>
      <StageReportTable title="الخيط والمواد حسب السند واللوط واللون والأمر" rows={data.yarn} columns={yarnColumns}/>
    </>}
  </section>;
}
export function ManufacturingOperationsReportPanel(){
  const [mode,setMode]=useState<'all'|'weaving'>('all');
  return <div><div className="flex gap-2 border-b p-3" role="group" aria-label="نوع تقرير التصنيع"><button className="rounded border p-2" aria-pressed={mode==='all'} onClick={()=>setMode('all')}>جميع المراحل والخيط</button><button className="rounded border p-2" aria-pressed={mode==='weaving'} onClick={()=>setMode('weaving')}>تقرير النسيج والجودة واستلام الخام</button></div>{mode==='all'?<AllStageReportPanel/>:<WeavingOperationsReportPanel/>}</div>;
}
