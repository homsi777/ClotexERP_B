import { manufacturingError } from '../../lib/externalManufacturingI18n';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Loader2 } from 'lucide-react';
import { getExternalJob, listExternalJobs, type ExternalJob } from '../../lib/api/externalJobsApi';

type Preview = { loading: boolean; error?: string; materials: Array<{ name: string; rolls: number; meters: number; remaining: number }>; prep?: string | null; desc?: string | null; notes?: string | null; supplierOrderNo?: number | null };
const m = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ExternalManufacturingLookup() {
  const { t: lifecycleT, i18n: lifecycleI18n } = useTranslation('externalJobs');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [jobs, setJobs] = useState<ExternalJob[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const latest = useRef(0);
  const [previews, setPreviews] = useState<Record<string, Preview | undefined>>({});
  const togglePreview = async (id: string) => {
    if (previews[id]) { setPreviews((p) => ({ ...p, [id]: undefined })); return; }
    setPreviews((p) => ({ ...p, [id]: { loading: true, materials: [] } }));
    try {
      const d = (await getExternalJob(id)).data as ExternalJob & { lines: Array<{ item_name?: string | null; sent_length_m: string | number | null; line_status: string }> };
      const by = new Map<string, { name: string; rolls: number; meters: number; remaining: number }>();
      for (const l of d.lines.filter((x) => x.line_status !== 'CANCELLED')) {
        const k = l.item_name || '—'; const e = by.get(k) ?? { name: k, rolls: 0, meters: 0, remaining: 0 };
        const len = Number(l.sent_length_m ?? 0); e.rolls += 1; e.meters += len; if (l.line_status === 'SENT') e.remaining += len; by.set(k, e);
      }
      setPreviews((p) => ({ ...p, [id]: { loading: false, materials: [...by.values()], prep: d.preparation_type_name, desc: d.process_description, notes: d.notes, supplierOrderNo: d.supplier_order_no } }));
    } catch (e) { setPreviews((p) => ({ ...p, [id]: { loading: false, materials: [], error: manufacturingError(e, lifecycleT) } })); }
  };
  useEffect(() => { const generation = ++latest.current; const timer = window.setTimeout(() => {
    listExternalJobs({ search: search.trim(), jobKind: 'PROCESSING', documentStatus: 'CONFIRMED', page, pageSize: 30 }).then(r => {
      if (generation === latest.current) { setJobs(r.rows); setTotal(r.total); setError(''); }
    }).catch(e => { if (generation === latest.current) setError(manufacturingError(e, lifecycleT)); });
  }, 200); return () => { ++latest.current; window.clearTimeout(timer); }; }, [search, page]);
  return <section className="border rounded p-4 space-y-3" dir={lifecycleI18n.dir()}><h3 className="font-bold">{lifecycleT('lifecycle.lookupTitle')}</h3>
    <input className="border rounded p-2 w-full" placeholder={lifecycleT('lifecycle.search')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} onKeyDown={async e => {
      if (e.key !== 'Enter') return; e.preventDefault(); const query=search.trim(); const generation=++latest.current;
      try { const result=await listExternalJobs({search:query,jobKind:'PROCESSING',documentStatus:'CONFIRMED',pageSize:100}); if(generation!==latest.current)return;
        const exact=result.rows.find(j=>j.job_no.toLocaleLowerCase()===query.toLocaleLowerCase());
        if(exact)navigate(`/inventory/create?externalJobId=${exact.id}`);else setError(lifecycleT('lifecycle.noExact'));
      }catch(err){if(generation===latest.current)setError(manufacturingError(err, lifecycleT));}
    }}/>{error&&<p role="alert" className="text-red-700">{error}</p>}
    {jobs.map(j=>{const pv=previews[j.id];const tot=pv?.materials.reduce((a,x)=>({r:a.r+x.rolls,m:a.m+x.meters,k:a.k+x.remaining}),{r:0,m:0,k:0});return <div key={j.id} className="rounded border">
      <div className="flex items-stretch"><button className="flex-1 p-2 text-right" onClick={()=>navigate(`/inventory/create?externalJobId=${j.id}`)}>{j.job_no} — {j.supplier_name} — {j.sent_date}</button>
        <button type="button" aria-label="معاينة" title="معاينة المهمة قبل اختيارها" className="border-s px-3 text-indigo-700" onClick={()=>void togglePreview(j.id)}><Eye className="h-4 w-4"/></button></div>
      {pv&&<div className="border-t bg-slate-50 p-3 text-sm space-y-2">
        {pv.loading&&<Loader2 className="h-4 w-4 animate-spin"/>}{pv.error&&<p className="text-red-700">{pv.error}</p>}
        {!pv.loading&&!pv.error&&<><table className="w-full text-right text-xs"><thead className="text-slate-500"><tr><th className="p-1">الخامة</th><th className="p-1">أتواب</th><th className="p-1">الأمتار المسلَّمة</th><th className="p-1">المتبقي للاستلام</th></tr></thead><tbody>
          {pv.materials.map(x=><tr key={x.name} className="border-t"><td className="p-1">{x.name}</td><td className="p-1">{x.rolls}</td><td className="p-1 font-mono">{m(x.meters)} م</td><td className="p-1 font-mono">{m(x.remaining)} م</td></tr>)}
          {tot&&<tr className="border-t font-bold"><td className="p-1">المجموع الشامل</td><td className="p-1">{tot.r}</td><td className="p-1 font-mono">{m(tot.m)} م</td><td className="p-1 font-mono">{m(tot.k)} م</td></tr>}</tbody></table>
          {(pv.prep||pv.desc||pv.notes)&&<div className="text-xs text-slate-700"><b>طلب التحضير:</b> {[pv.prep,pv.desc,pv.notes].filter(Boolean).join(' — ')}</div>}</>}
      </div>}</div>;})}
    <div className="flex gap-4"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>{lifecycleT('lifecycle.prevPage')}</button><span>{page}</span><button disabled={page*30>=total} onClick={()=>setPage(p=>p+1)}>{lifecycleT('lifecycle.nextPage')}</button></div>
  </section>;
}
