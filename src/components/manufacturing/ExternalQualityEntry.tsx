import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listExternalJobs, type ExternalJob } from '../../lib/api/externalJobsApi';
import { ExternalManufacturingLifecycle } from '../purchases/ExternalManufacturingLifecycle';

export function ExternalQualityEntry() {
  const {t}=useTranslation('externalJobs');
  const [search,setSearch]=useState(''),[jobs,setJobs]=useState<ExternalJob[]>([]),[jobId,setJobId]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const timer=window.setTimeout(()=>{
      listExternalJobs({jobKind:'PROCESSING',documentStatus:'CONFIRMED',search,pageSize:100})
        .then(r=>{if(active){setJobs(r.rows);setError('');}})
        .catch(e=>{if(active){setJobs([]);setError(String(e.message));}});
    },250);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[search]);
  return <div className="space-y-3">
    <input aria-label={t('traceability.externalQuality')} placeholder={t('traceability.search')} className="w-full border rounded p-2" value={search} onChange={e=>setSearch(e.target.value)}/>
    <select aria-label={t('traceability.externalQuality')} className="w-full border rounded p-2" value={jobId} onChange={e=>setJobId(e.target.value)}>
      <option value="">{t('traceability.externalQuality')}</option>
      {jobs.map(j=><option key={j.id} value={j.id}>{j.job_no} / {j.supplier_name}{j.open_defects?' ⚠':''}</option>)}
    </select>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {jobId&&<ExternalManufacturingLifecycle key={jobId} jobId={jobId} initialTab="quality"/>}
  </div>;
}
