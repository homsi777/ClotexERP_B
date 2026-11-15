import { manufacturingError } from '../../lib/externalManufacturingI18n';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listExternalJobs, type ExternalJob } from '../../lib/api/externalJobsApi';

export function ExternalManufacturingLookup() {
  const { t: lifecycleT, i18n: lifecycleI18n } = useTranslation('externalJobs');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [jobs, setJobs] = useState<ExternalJob[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const latest = useRef(0);
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
    {jobs.map(j=><button key={j.id} className="block border rounded p-2 w-full text-right" onClick={()=>navigate(`/inventory/create?externalJobId=${j.id}`)}>{j.job_no} — {j.supplier_name} — {j.sent_date}</button>)}
    <div className="flex gap-4"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>{lifecycleT('lifecycle.prevPage')}</button><span>{page}</span><button disabled={page*30>=total} onClick={()=>setPage(p=>p+1)}>{lifecycleT('lifecycle.nextPage')}</button></div>
  </section>;
}
