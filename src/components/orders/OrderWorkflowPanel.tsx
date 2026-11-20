import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Link} from 'react-router-dom';
import type {CustomerOrder} from '../../types';
import {usePermissions} from '../../hooks/usePermissions';
import {confirmOrderProduction,changeOrderReservation,getOrderHistory,getOrderWorkflow,type OrderHistoryEntry,type OrderWorkflow} from '../../lib/api/orderWorkflowApi';
import {listManufacturingSpecifications,type ManufacturingSpecificationSummary} from '../../lib/api/manufacturingReferenceApi';
import {SpecPreviewDialog} from './SpecPreviewDialog';


export function OrderWorkflowPanel({order}:{order:CustomerOrder}){
  const {t}=useTranslation('orderWorkflow');
  const {has}=usePermissions();
  const [data,setData]=useState<OrderWorkflow|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Record<string,string[]>>({});
  const [history,setHistory]=useState<OrderHistoryEntry[]>([]),[specs,setSpecs]=useState<ManufacturingSpecificationSummary[]>([]),[spec,setSpec]=useState<Record<string,string>>({});
  const [previewVersionId,setPreviewVersionId]=useState<string|null>(null);
  const previewSpec=previewVersionId?specs.find(s=>s.approved_version_id===previewVersionId):undefined;
  const canManage=has('customers.manage'),canProduce=has('manufacturing.work_orders.manage');
  const refresh=async()=>{setBusy(true);setError('');try{const [workflow,audit]=await Promise.all([getOrderWorkflow(order.id),getOrderHistory(order.id)]);setData(workflow);setHistory(audit);setSpec(old=>Object.fromEntries(workflow.lines.map(line=>[line.id,old[line.id]??(line.defaultSpecification.state==='READY'?line.defaultSpecification.mapping?.specification_version_id??'':'')])));}catch(e){setError(e instanceof Error?e.message:t('failed'));}finally{setBusy(false);}};
  useEffect(()=>{void refresh();},[order.id]);
  useEffect(()=>{if(canProduce)void listManufacturingSpecifications().then(setSpecs).catch(()=>setSpecs([]));},[canProduce]);
  const reserve=async(line:string,action:'reserve'|'release',automatic=false)=>{setBusy(true);setError('');try{setData(await changeOrderReservation(order.id,line,action,automatic?undefined:selected[line]));setSelected(old=>({...old,[line]:[]}));setHistory(await getOrderHistory(order.id));}catch(e){setError(e instanceof Error?e.message:t('failed'));}finally{setBusy(false);}};
  const produce=async(lineId:string)=>{
    const line=data?.lines.find(l=>l.id===lineId);
    if(!line||!spec[lineId])return;
    const committed=line.production.reduce((n,p)=>n+Number(p.allocated_length_m),0);
    const quantity=Math.round(Math.max(0,line.shortageMeters-committed)*1000)/1000;
    if(quantity<=0)return;
    const definition=specs.find(s=>s.approved_version_id===spec[lineId]);
    if(!window.confirm(`تأكيد إنشاء مسودة إنتاج: ${quantity.toFixed(3)} متر، المواصفة ${definition?.code??spec[lineId]} — ${definition?.name??''}؟`))return;
    setBusy(true);setError('');
    try{
      await confirmOrderProduction(order.id,line.id,{confirmed:true,specificationVersionId:spec[lineId],mappingId:line.defaultSpecification.state==='READY'&&line.defaultSpecification.mapping?.specification_version_id===spec[lineId]?line.defaultSpecification.mapping.id:null,targetLengthM:quantity});
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:t('failed'));}finally{setBusy(false);}
  };
  const mappingHint=(line:OrderWorkflow['lines'][number])=>line.defaultSpecification.state==='READY'
    ?`ربط افتراضي معتمد — إصدار ${line.defaultSpecification.mapping?.version_no}`
    :line.defaultSpecification.state==='STALE'?'الربط متقادم؛ اختر إصداراً معتمداً'
    :line.defaultSpecification.state==='AMBIGUOUS_ITEM'?'هوية الخامة ملتبسة؛ اختر المواصفة صراحة'
    :'لا يوجد ربط افتراضي؛ اختر المواصفة صراحة';
  const qty=(n:number)=>Number(n).toLocaleString(undefined,{maximumFractionDigits:3});
  const open=data&&!['draft','completed','cancelled'].includes(data.order.status);
  return <section className="h-full space-y-4 overflow-auto bg-white p-4" dir="rtl">
    <div className="flex items-center justify-between gap-3"><h3 className="font-bold">{t('title')}</h3><button disabled={busy} onClick={()=>void refresh()} className="rounded-lg border px-3 py-2">{t('refresh')}</button></div>
    <p className="text-sm text-slate-600">{t('hint')}</p>
    {previewSpec&&previewVersionId&&<SpecPreviewDialog spec={previewSpec} versionId={previewVersionId} onClose={()=>setPreviewVersionId(null)}/>}
    {data&&!open&&<p className="rounded bg-amber-50 p-3 text-sm text-amber-800">{t(data.order.status==='draft'?'draftHint':'closedHint')}</p>}
    {data&&open&&!canManage&&<p className="rounded bg-amber-50 p-3 text-sm text-amber-800">{t('noPermission')}</p>}
    {error&&<p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p>}
    {!data&&busy&&<p>{t('loading')}</p>}
    {data?.lines.map(line=><article key={line.id} className="space-y-3 rounded-xl border p-3" data-order-workflow-line={line.id}>
      <h4 className="font-bold">{line.materialName} — {line.designCode} — {line.colorName||line.colorCode||'—'}</h4>
      <p className="text-sm text-indigo-800">{t(`phase.${line.phase}`)} — {data.order.follow_up_user_name||data.order.follow_up_employee_name||t('unassigned')}</p>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{([['ordered',line.orderedMeters],['delivered',line.fulfilledMeters],['available',line.availableMeters],['reserved',line.reservedMeters],['shortage',line.shortageMeters],['raw',line.rawMeters],['external',line.externalMeters],['quality',line.qualityPendingMeters]] as const).map(([key,value])=><div key={key} className="rounded bg-slate-50 p-2">{t(key)}: <strong>{qty(value)}</strong> {t('meters')}</div>)}</div>
      {line.unclassifiedMeters>0&&<p className="text-sm text-amber-700">{t('unclassified',{quantity:qty(line.unclassifiedMeters)})}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-right text-sm"><thead><tr><th>{t('select')}</th><th>{t('barcode')}</th><th>{t('warehouse')}</th><th>{t('meters')}</th><th>{t('state')}</th></tr></thead><tbody>{line.rolls.map(roll=><tr key={roll.id} className="border-t"><td className="py-2"><input type="checkbox" aria-label={`${t('select')} ${roll.barcode}`} disabled={busy||!open||!canManage||!roll.eligible} checked={(selected[line.id]??[]).includes(roll.id)} onChange={e=>setSelected(old=>({...old,[line.id]:e.target.checked?[...(old[line.id]??[]),roll.id]:(old[line.id]??[]).filter(id=>id!==roll.id)}))}/></td><td className="font-mono">{roll.barcode}</td><td>{roll.warehouse_name}</td><td>{qty(roll.length_m)}</td><td>{t(roll.owned?'owned':roll.quality_hold?'quality':roll.external_pending?'external':roll.fabric_stage==='RAW'?'raw':!roll.fabric_stage?'rollUnclassified':roll.eligible?'available':'unavailable')}</td></tr>)}</tbody></table></div>
      {canManage&&open&&<div className="flex flex-wrap gap-2"><button disabled={busy||!line.rolls.some(r=>r.eligible)} onClick={()=>void reserve(line.id,'reserve',true)} className="rounded border px-3 py-2 text-sm">{t('fifo')}</button><button disabled={busy||!(selected[line.id]?.length)} onClick={()=>void reserve(line.id,'reserve')} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white">{t('reserveSelected')}</button><button disabled={busy||!line.reservedMeters} onClick={()=>void reserve(line.id,'release')} className="rounded border px-3 py-2 text-sm">{t('release')}</button></div>}
      {line.production.map(p=><p key={p.id} className="text-sm"><Link to="/manufacturing?section=workOrders" className="text-indigo-700 underline">{p.work_order_no}</Link> — {t(`phase.${p.phase}`)} — {qty(p.allocated_length_m)} {t('meters')} {p.shared&&t('shared')} — {new Date(p.last_update).toLocaleString()}</p>)}
      {line.externalJobs?.map(job=><div key={job.id} className="rounded bg-slate-50 p-2 text-sm"><Link to={`/purchases/external-jobs/${job.id}?from=manufacturing`} className="text-indigo-700 underline">{job.job_no}</Link> — {job.stage} — {t('sent')}: {qty(job.sent)} — {t('received')}: {qty(job.received)} — {t('accepted')}: {qty(job.accepted)} — {t('external')}: {qty(job.pending)} — {t('quality')}: {qty(job.qualityPending)} — {t('shortage')}: {qty(job.shortage)}</div>)}
      {canProduce&&open&&line.shortageMeters>0&&<div className="flex flex-wrap items-center gap-2 rounded bg-indigo-50 p-3"><span className="text-sm">{t('productionHint')} - {mappingHint(line)}</span><select aria-label={t('specification')} value={spec[line.id]??''} onChange={e=>setSpec(old=>({...old,[line.id]:e.target.value}))} className="min-w-0 max-w-full rounded border p-2"><option value="">{t('specification')}</option>{specs.filter(s=>s.is_active&&s.approved_version_id).map(s=><option key={s.id} value={s.approved_version_id??''}>{s.code} — {s.name}</option>)}</select><button type="button" disabled={!spec[line.id]} onClick={()=>setPreviewVersionId(spec[line.id]??null)} className="rounded border px-3 py-2 text-sm">{t('previewSpec')}</button><button disabled={busy||!spec[line.id]||line.shortageMeters-line.production.reduce((n,p)=>n+Number(p.allocated_length_m),0)<=0} onClick={()=>void produce(line.id)} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white">{t('createProduction')}</button></div>}
    </article>)}
    <details className="rounded-xl border p-3"><summary className="cursor-pointer font-bold">{t('audit')}</summary>{history.map(entry=><div key={entry.id} className="border-t py-2 text-sm"><span>{new Date(entry.created_at).toLocaleString()} — {entry.username||'—'} — {entry.action}</span><details><summary>{t('changes')}</summary><pre className="overflow-auto whitespace-pre-wrap text-xs" dir="ltr">{JSON.stringify(entry.details,null,2)}</pre></details></div>)}</details>
  </section>;
}
