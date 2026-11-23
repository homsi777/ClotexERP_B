import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import * as XLSX from 'xlsx';
import {LayoutGrid,Loader2,Pencil,Plus,Printer,Table2,Trash2,FileSpreadsheet,FileDown,ArrowLeft,Upload} from 'lucide-react';
import {WorkbookSheetGrid,type SheetGrid} from './WorkbookSheetGrid';
import {archiveSpecCard,createSpecCard,getSpecCard,listSpecCards,parseSpecWorkbook,updateSpecCard,type SpecCard,type SpecCardSummary,type SpecIllustration} from '../../lib/api/specCardsApi';
import {listFabricItems,type ApiFabricItem} from '../../lib/api/fabricItemsApi';
import {renderSpecCardHtml} from '../../lib/printing/renderSpecCard';
import {exportHtmlDocumentToPdf} from '../../lib/pdfExport';

type Perms={canCreate:boolean;canEdit:boolean;canDelete:boolean;canPrint:boolean;canExport:boolean};
type Draft={id:string|null;materialName:string;materialCode:string;fabricItemId:string|null;fabricLabel:string;notes:string;sheets:SheetGrid[];illustrations:SpecIllustration[];sourceFileName:string|null};
const emptyDraft:Draft={id:null,materialName:'',materialCode:'',fabricItemId:null,fabricLabel:'',notes:'',sheets:[],illustrations:[],sourceFileName:null};
const fmt=(d:string)=>{try{return new Date(d).toLocaleDateString('en-GB');}catch{return d;}};
const fileToBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]??'');r.onerror=()=>reject(new Error('تعذر قراءة الملف'));r.readAsDataURL(file);});

/** M-0001 — مكتبة بطاقات المواصفات: مرجع للعرض والتعديل والطباعة والتصدير؛ أرقامها لا تدخل في أي حساب أو حركة مخزون. */
export function SpecCardsPanel({canCreate,canEdit,canDelete,canPrint,canExport}:Perms){
  const [rows,setRows]=useState<SpecCardSummary[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [search,setSearch]=useState(''),[sort,setSort]=useState<'material_name'|'material_code'|'updated_at'>('material_name'),[dir,setDir]=useState<'asc'|'desc'>('asc');
  const [view,setView]=useState<'table'|'cards'>('table');
  const [open,setOpen]=useState<SpecCard|null>(null),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false);
  const [itemQuery,setItemQuery]=useState(''),[itemOptions,setItemOptions]=useState<ApiFabricItem[]>([]);
  const fileRef=useRef<HTMLInputElement>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{setRows(await listSpecCards({search:search.trim()||undefined,sort,dir}));}
    catch(e){setError(e instanceof Error?e.message:'تعذر تحميل المكتبة');}
    finally{setLoading(false);}
  },[search,sort,dir]);
  useEffect(()=>{const h=setTimeout(()=>void load(),250);return ()=>clearTimeout(h);},[load]);

  useEffect(()=>{
    if(!draft||itemQuery.trim().length<2){setItemOptions([]);return;}
    let active=true;
    const h=setTimeout(()=>{void listFabricItems({search:itemQuery.trim(),status:'active',pageSize:12}).then(r=>{if(active)setItemOptions(r.data);}).catch(()=>{if(active)setItemOptions([]);});},250);
    return ()=>{active=false;clearTimeout(h);};
  },[itemQuery,draft]);

  const openCard=async(id:string)=>{setError('');try{setOpen(await getSpecCard(id));}catch(e){setError(e instanceof Error?e.message:'تعذر فتح البطاقة');}};
  const startEdit=(c:SpecCard)=>{setDraft({id:c.id,materialName:c.material_name,materialCode:c.material_code,fabricItemId:c.fabric_item_id,fabricLabel:c.fabric_item_name?`${c.fabric_item_name}${c.fabric_item_code?` (${c.fabric_item_code})`:''}`:'',notes:c.notes??'',sheets:c.sheets,illustrations:c.illustrations,sourceFileName:c.source_file_name});setItemQuery('');};
  const uploadWorkbook=async(file:File|undefined)=>{
    if(!file||!draft)return;setBusy(true);setError('');
    try{const parsed=await parseSpecWorkbook(await fileToBase64(file));setDraft({...draft,sheets:parsed.sheets,illustrations:parsed.illustrations,sourceFileName:file.name});}
    catch(e){setError(e instanceof Error?e.message:'تعذر قراءة الملف');}
    finally{setBusy(false);if(fileRef.current)fileRef.current.value='';}
  };
  const save=async()=>{
    if(!draft)return;
    if(!draft.materialName.trim()||!draft.materialCode.trim()){setError('الخامة وكود الخامة مطلوبان');return;}
    setBusy(true);setError('');
    try{
      const input={materialName:draft.materialName.trim(),materialCode:draft.materialCode.trim(),fabricItemId:draft.fabricItemId,notes:draft.notes.trim()||null,sheets:draft.sheets,illustrations:draft.illustrations,sourceFileName:draft.sourceFileName};
      const saved=draft.id?await updateSpecCard(draft.id,input):await createSpecCard(input);
      setDraft(null);setOpen(saved);await load();
    }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ البطاقة');}
    finally{setBusy(false);}
  };
  const remove=async(c:SpecCard)=>{
    if(!window.confirm('إخفاء هذه البطاقة من المكتبة؟'))return;
    setBusy(true);try{await archiveSpecCard(c.id);setOpen(null);await load();}catch(e){setError(e instanceof Error?e.message:'تعذر الإخفاء');}finally{setBusy(false);}
  };

  const html=(c:SpecCard)=>renderSpecCardHtml({material_name:c.material_name,material_code:c.material_code,fabric_item_name:c.fabric_item_name,fabric_item_code:c.fabric_item_code,notes:c.notes,sheets:c.sheets,illustrations:c.illustrations});
  const print=(c:SpecCard)=>{
    const w=window.open('','_blank','width=980,height=900');if(!w){setError('اسمح بالنوافذ المنبثقة للطباعة');return;}
    w.document.open();w.document.write(html(c));w.document.close();w.focus();setTimeout(()=>w.print(),300);
  };
  const exportPdf=async(c:SpecCard)=>{setBusy(true);try{await exportHtmlDocumentToPdf(html(c),`spec-card-${c.material_code}`);}catch(e){setError(e instanceof Error?e.message:'تعذر تصدير PDF');}finally{setBusy(false);}};
  const exportExcel=(c:SpecCard)=>{
    const wb=XLSX.utils.book_new();
    const sheets=c.sheets.length?c.sheets:[{name:'بطاقة',range:'A1',cells:[],merges:[]} as SheetGrid];
    for(const s of sheets){
      const ws:XLSX.WorkSheet={};let maxR=0,maxC=0;
      for(const cell of s.cells){if(cell.value===null||cell.value===undefined)continue;ws[XLSX.utils.encode_cell({r:cell.row,c:cell.col})]={t:typeof cell.value==='number'?'n':typeof cell.value==='boolean'?'b':'s',v:cell.value};maxR=Math.max(maxR,cell.row);maxC=Math.max(maxC,cell.col);}
      ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:maxR,c:maxC}});
      ws['!merges']=s.merges.map(m=>({s:{r:m.startRow,c:m.startCol},e:{r:m.endRow,c:m.endCol}}));
      XLSX.utils.book_append_sheet(wb,ws,s.name.replace(/[\\/?*[\]:]/g,' ').slice(0,31)||'ورقة');
    }
    XLSX.writeFile(wb,`spec-card-${c.material_code}.xlsx`);
  };

  const sortedLabel=useMemo(()=>({material_name:'الخامة',material_code:'كود الخامة',updated_at:'آخر تعديل'}),[]);

  // ───── محرر البطاقة (جديدة/تعديل) ─────
  if(draft)return <section className="space-y-4 rounded-xl border bg-white p-4" dir="rtl">
    <div className="flex items-center justify-between"><h3 className="text-lg font-bold">{draft.id?'تعديل بطاقة مواصفات':'بطاقة مواصفات جديدة'}</h3><button type="button" className="inline-flex items-center gap-1 text-sm text-slate-600" onClick={()=>setDraft(null)}><ArrowLeft className="h-4 w-4"/>رجوع</button></div>
    {error&&<p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm font-bold">الخامة *<input className="w-full rounded border p-2 font-normal" value={draft.materialName} onChange={e=>setDraft({...draft,materialName:e.target.value})}/></label>
      <label className="space-y-1 text-sm font-bold">كود الخامة *<input dir="ltr" className="w-full rounded border p-2 font-mono font-normal" value={draft.materialCode} onChange={e=>setDraft({...draft,materialCode:e.target.value})}/></label>
    </div>
    <div className="space-y-1 text-sm"><b>الخامة المرتبطة من دليل الخامات (اختياري)</b>
      {draft.fabricItemId?<div className="flex items-center gap-2 rounded border bg-slate-50 p-2"><span>{draft.fabricLabel||draft.fabricItemId}</span><button type="button" className="text-rose-700" onClick={()=>setDraft({...draft,fabricItemId:null,fabricLabel:''})}>إزالة الربط</button></div>
      :<div className="relative"><input className="w-full rounded border p-2" placeholder="ابحث باسم الخامة أو كودها لربطها…" value={itemQuery} onChange={e=>setItemQuery(e.target.value)}/>
        {itemOptions.length>0&&<ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border bg-white shadow">{itemOptions.map(i=><li key={i.id}><button type="button" className="w-full p-2 text-right hover:bg-indigo-50" onClick={()=>{setDraft({...draft,fabricItemId:i.id,fabricLabel:`${i.name}${i.internal_code?` (${i.internal_code})`:''}`});setItemQuery('');setItemOptions([]);}}>{i.name} <span className="font-mono text-xs text-slate-500" dir="ltr">{i.internal_code}</span></button></li>)}</ul>}</div>}
      <p className="text-xs text-slate-500">يمكن حفظ البطاقة واستخدامها بدون ربط.</p>
    </div>
    <label className="block space-y-1 text-sm font-bold">ملاحظات<textarea className="w-full rounded border p-2 font-normal" rows={2} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
    <div className="flex flex-wrap items-center gap-2">
      <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={e=>void uploadWorkbook(e.target.files?.[0])}/>
      <button type="button" disabled={busy} onClick={()=>fileRef.current?.click()} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm font-bold"><Upload className="h-4 w-4"/>{draft.sheets.length?'استبدال المحتوى من ملف Excel':'تحميل المحتوى من ملف Excel'}</button>
      {draft.sourceFileName&&<span className="text-xs text-slate-500">{draft.sourceFileName}</span>}
    </div>
    {draft.sheets.length>0&&<WorkbookSheetGrid sheets={draft.sheets} illustrations={draft.illustrations} onChange={sheets=>setDraft({...draft,sheets})}/>}
    <p className="text-xs text-slate-500">البطاقة مرجع للعرض والتعديل والطباعة والتصدير فقط؛ أرقامها لا تُستخدم لحساب استهلاك أو صرف خيط أو أي حركة مخزون.</p>
    <div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>void save()} className="rounded bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy?'جارٍ الحفظ…':'حفظ البطاقة'}</button><button type="button" disabled={busy} onClick={()=>setDraft(null)} className="rounded border px-4 py-2 text-sm">إلغاء</button></div>
  </section>;

  // ───── عرض بطاقة ─────
  if(open)return <section className="space-y-4 rounded-xl border bg-white p-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className="inline-flex items-center gap-1 text-sm text-slate-600" onClick={()=>setOpen(null)}><ArrowLeft className="h-4 w-4"/>المكتبة</button>
      <div className="flex flex-wrap gap-2">
        {canEdit&&<button type="button" onClick={()=>startEdit(open)} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm font-bold"><Pencil className="h-4 w-4"/>تعديل</button>}
        {canPrint&&<button type="button" onClick={()=>print(open)} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm font-bold"><Printer className="h-4 w-4"/>طباعة</button>}
        {canExport&&<button type="button" onClick={()=>exportExcel(open)} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm font-bold"><FileSpreadsheet className="h-4 w-4"/>Excel</button>}
        {canExport&&<button type="button" disabled={busy} onClick={()=>void exportPdf(open)} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm font-bold disabled:opacity-50"><FileDown className="h-4 w-4"/>PDF</button>}
        {canDelete&&<button type="button" disabled={busy} onClick={()=>void remove(open)} className="inline-flex items-center gap-1 rounded border border-rose-300 px-3 py-1.5 text-sm font-bold text-rose-700"><Trash2 className="h-4 w-4"/>إخفاء</button>}
      </div>
    </div>
    {error&&<p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
    <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
      <div><span className="text-slate-500">الخامة</span><div className="font-bold">{open.material_name}</div></div>
      <div><span className="text-slate-500">كود الخامة</span><div className="font-mono font-bold" dir="ltr">{open.material_code}</div></div>
      <div><span className="text-slate-500">الخامة المرتبطة من الدليل</span><div className="font-bold">{open.fabric_item_name?`${open.fabric_item_name}${open.fabric_item_code?` (${open.fabric_item_code})`:''}`:'—'}</div></div>
    </div>
    {open.notes&&<p className="whitespace-pre-wrap text-sm">{open.notes}</p>}
    {open.sheets.length?<WorkbookSheetGrid sheets={open.sheets} illustrations={open.illustrations}/>:<p className="text-sm text-slate-500">لا يوجد محتوى محفوظ لهذه البطاقة بعد.</p>}
  </section>;

  // ───── المكتبة ─────
  return <section className="space-y-4" dir="rtl">
    <div className="flex flex-wrap items-center gap-2">
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالخامة أو كودها…" className="min-w-[220px] flex-1 rounded-lg border p-2 text-sm"/>
      <select value={sort} onChange={e=>setSort(e.target.value as typeof sort)} className="rounded-lg border p-2 text-sm" aria-label="فرز">{(Object.keys(sortedLabel) as Array<keyof typeof sortedLabel>).map(k=><option key={k} value={k}>فرز: {sortedLabel[k]}</option>)}</select>
      <button type="button" onClick={()=>setDir(d=>d==='asc'?'desc':'asc')} className="rounded-lg border px-3 py-2 text-sm">{dir==='asc'?'تصاعدي ↑':'تنازلي ↓'}</button>
      <div className="inline-flex overflow-hidden rounded-lg border text-sm font-bold">
        <button type="button" onClick={()=>setView('table')} className={`inline-flex items-center gap-1 px-3 py-2 ${view==='table'?'bg-indigo-600 text-white':''}`}><Table2 className="h-4 w-4"/>جدول</button>
        <button type="button" onClick={()=>setView('cards')} className={`inline-flex items-center gap-1 px-3 py-2 ${view==='cards'?'bg-indigo-600 text-white':''}`}><LayoutGrid className="h-4 w-4"/>بطاقات</button>
      </div>
      {canCreate&&<button type="button" onClick={()=>{setDraft({...emptyDraft});setItemQuery('');}} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4"/>بطاقة جديدة</button>}
    </div>
    {error&&<p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
    {loading?<div className="p-6 text-center text-slate-500"><Loader2 className="inline h-5 w-5 animate-spin"/></div>
    :rows.length===0?<p className="rounded-xl border bg-white p-8 text-center text-slate-500">لا توجد بطاقات مواصفات{search?' مطابقة':' بعد'}.</p>
    :view==='table'?<div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-right text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="p-3">الخامة</th><th className="p-3">كود الخامة</th><th className="p-3">الخامة المرتبطة</th><th className="p-3">الأوراق</th><th className="p-3">آخر تعديل</th><th className="p-3"/></tr></thead><tbody>
      {rows.map(r=><tr key={r.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={()=>void openCard(r.id)}><td className="p-3 font-bold">{r.material_name}</td><td className="p-3 font-mono" dir="ltr">{r.material_code}</td><td className="p-3">{r.fabric_item_name?`${r.fabric_item_name}${r.fabric_item_code?` (${r.fabric_item_code})`:''}`:'—'}</td><td className="p-3">{r.sheet_count}</td><td className="p-3">{fmt(r.updated_at)}</td><td className="p-3"><button type="button" className="rounded border px-2 py-1 text-xs font-bold" onClick={e=>{e.stopPropagation();void openCard(r.id);}}>فتح</button></td></tr>)}
    </tbody></table></div>
    :<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map(r=><button key={r.id} type="button" onClick={()=>void openCard(r.id)} className="rounded-xl border bg-white p-4 text-right hover:border-indigo-400 hover:shadow">
      <div className="mb-2 flex h-14 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><FileSpreadsheet className="h-7 w-7"/></div>
      <div className="font-bold text-slate-900">{r.material_name}</div><div className="font-mono text-sm text-slate-600" dir="ltr">{r.material_code}</div>
      <div className="mt-1 text-xs text-slate-500">{r.fabric_item_name?`مرتبطة: ${r.fabric_item_name}`:'غير مرتبطة بالدليل'}</div>
      <div className="mt-1 text-xs text-slate-400">{r.sheet_count} أوراق · {fmt(r.updated_at)}</div></button>)}</div>}
  </section>;
}
