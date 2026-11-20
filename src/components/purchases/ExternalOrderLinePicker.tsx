import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchExternalOrderLines, type ExternalLineReference, type ExternalOrderChoice } from '../../lib/api/externalJobsApi';

export function ExternalOrderLinePicker({rollId,value,onChange}: {
  rollId:string; value?:ExternalLineReference; onChange:(v:ExternalLineReference)=>void;
}) {
  const {t}=useTranslation('externalJobs');
  const [search,setSearch]=useState(''),[choices,setChoices]=useState<ExternalOrderChoice[]>([]),[error,setError]=useState('');
  const [selected,setSelected]=useState<ExternalOrderChoice>();
  useEffect(()=>{
    let active=true;
    const timer=window.setTimeout(()=>{
      searchExternalOrderLines(search).then(r=>{if(active){setChoices(r.data);setError('');}})
        .catch(e=>{if(active){setChoices([]);setError(String(e.message));}});
    },300);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[search]);
  const options=selected&&!choices.some(c=>c.line_id===selected.line_id)?[selected,...choices]:choices;
  return <div className="space-y-1 mt-2 min-w-64">
    <input aria-label={t('traceability.search')} placeholder={t('traceability.search')} className="border rounded p-1 w-full" value={search} onChange={e=>setSearch(e.target.value)}/>
    <select aria-label={t('traceability.order')} className="border rounded p-1 w-full" value={value?.customerOrderLineId ?? (value?.customerOrderId===null?'stock':'inherit')} onChange={e=>{
      const choice=options.find(c=>c.line_id===e.target.value);setSelected(choice);
      onChange(choice?{rollId,customerOrderId:choice.order_id,customerOrderLineId:choice.line_id}:e.target.value==='stock'?{rollId,customerOrderId:null,customerOrderLineId:null}:{rollId});
    }}>
      <option value="inherit">{t('traceability.inherit')}</option>
      <option value="stock">{t('traceability.stock')}</option>
      {options.map(c=><option key={c.line_id} value={c.line_id}>{c.order_no} / {c.customer_name} / {c.line_no} / {c.material_name} / {c.color_name} {c.color_code}</option>)}
    </select>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
