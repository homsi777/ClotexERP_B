import { manufacturingError } from '../../lib/externalManufacturingI18n';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getManufacturing, manufacturingAction, type ManufacturingResponse, type ServiceBasis } from '../../lib/api/externalManufacturingApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listLocations } from '../../lib/api/warehousesApi';
import { postExternalJobFee } from '../../lib/api/externalJobsApi';

type Row = { sourceLineId: string; lengthM: string; weightKg: string; barcode: string; colorName: string; colorCode: string; widthCm: string; gsm: string; defective: boolean; defectReason: 'DYE_HOUSE' | 'INTERNAL_KNITTING' | 'OTHER'; responsibleParty: string; notes: string };
const blank = (): Row => ({ sourceLineId: '', lengthM: '', weightKg: '', barcode: '', colorName: '', colorCode: '', widthCm: '', gsm: '', defective: false, defectReason: 'DYE_HOUSE', responsibleParty: '', notes: '' });
const inputClass = 'border rounded p-2 w-full text-sm';
const remaining = (l: { sent_length_m: string; returned_m: string; shortage_m: string; excess_m: string }) => Math.max(0, Math.round((Number(l.sent_length_m) + Number(l.excess_m) - Number(l.returned_m) - Number(l.shortage_m)) * 1000) / 1000);

export function ExternalManufacturingLifecycle({ jobId, receiving = false }: { jobId: string; receiving?: boolean }) {
  const { t: lifecycleT, i18n: lifecycleI18n } = useTranslation('externalJobs');
  const [response, setResponse] = useState<ManufacturingResponse | null>(null);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = useState('');
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [paper, setPaper] = useState('');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const [tab, setTab] = useState<'returns' | 'pricing'>('returns');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const [services, setServices] = useState<{ name: string; quantity: string; basis: ServiceBasis }[]>([]);
  const [prices, setPrices] = useState<{ serviceId: string; unitPrice: string; currencyCode: string; basis: ServiceBasis; approvedQuantity: string }[]>([]);
  const [settlement, setSettlement] = useState({ sourceLineId: '', amountM: '', reason: '', kind: 'SHORTAGE' });
  const load = async () => {
    const result = await getManufacturing(jobId); setResponse(result);
    setServices(result.data.services.map(s => ({ name: s.name, quantity: s.quantity, basis: s.basis })));
    setPrices(result.data.services.map(s => ({ serviceId: s.id, unitPrice: s.unit_price ?? '', currencyCode: s.currency_code ?? 'USD', basis: s.basis, approvedQuantity: s.approved_quantity ?? (s.basis === 'FIXED' ? '1' : s.quantity) })));
  };
  useEffect(() => { let active = true; getManufacturing(jobId).then(result => {
    if (!active) return; setResponse(result);
    setServices(result.data.services.map(s => ({ name: s.name, quantity: s.quantity, basis: s.basis })));
    setPrices(result.data.services.map(s => ({ serviceId: s.id, unitPrice: s.unit_price ?? '', currencyCode: s.currency_code ?? 'USD', basis: s.basis, approvedQuantity: s.approved_quantity ?? (s.basis === 'FIXED' ? '1' : s.quantity) })));
  }).catch(e => { if (active) setError(manufacturingError(e, lifecycleT)); }); listWarehouses({ status: 'active' }).then(r => { if (active) setWarehouses(r); }).catch(e => { if (active) setError(manufacturingError(e, lifecycleT)); }); return () => { active = false; }; }, [jobId]);
  useEffect(() => { setLocationId(''); setLocations([]); if (!warehouseId) return; let active = true;
    listLocations(warehouseId).then(r => { if (active) setLocations(r.filter(l => l.is_active)); }).catch(e => { if (active) setError(manufacturingError(e, lifecycleT)); }); return () => { active = false; };
  }, [warehouseId]);
  const run = async (work: () => Promise<unknown>, success: string) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage(success); await load(); } catch (e) { setError(manufacturingError(e, lifecycleT)); }
    finally { lock.current = false; setBusy(false); }
  };
  const patch = (i: number, next: Partial<Row>) => setRows(old => old.map((r, j) => i === j ? { ...r, ...next } : r));
  const receive = () => run(async () => {
    const payload = { destinationWarehouseId: warehouseId, destinationLocationId: locationId || null, dyePaperNo: paper.trim(), notes: notes.trim() || undefined,
      attachments: attachments.split('\n').map(v => v.trim()).filter(Boolean), completedServiceIds: completed,
      lines: rows.map(r => ({ sourceLineId: r.sourceLineId, lengthM: Number(r.lengthM), weightKg: r.weightKg === '' ? null : Number(r.weightKg),
        barcode: r.barcode.trim() || undefined, colorName: r.colorName.trim() || undefined, colorCode: r.colorCode.trim() || undefined, widthCm: r.widthCm === '' ? null : Number(r.widthCm), gsm: r.gsm === '' ? null : Number(r.gsm),
        defective: r.defective, defectReason: r.defective ? r.defectReason : undefined, responsibleParty: r.defective ? r.responsibleParty.trim() : undefined, notes: r.notes.trim() || undefined })) };
    const signature = JSON.stringify(payload);
    if (!retry.current || retry.current.payload !== signature) retry.current = { payload: signature, id: crypto.randomUUID() };
    await manufacturingAction(jobId, 'returns', { ...payload, requestId: retry.current.id });
    retry.current = null; setRows([blank()]); setPaper(''); setNotes(''); setAttachments(''); setCompleted([]);
  }, lifecycleT('lifecycle.returnSaved'));
  if (!response) return <section className="p-4 border rounded">{error || lifecycleT('lifecycle.loading')}</section>;
  const { data, canPrice, canManage, canReceive } = response;
  const sent = data.lines.reduce((n, l) => n + Number(l.sent_length_m), 0);
  const legacyAggregate = data.legacyMode && data.legacy.length > 0;
  const received = legacyAggregate ? data.legacy.reduce((n, r) => n + Number(r.returned_length_m), 0) : data.lines.reduce((n, l) => n + Number(l.returned_m), 0);
  const shortage = legacyAggregate ? data.legacy.reduce((n, r) => n + Number(r.shortage_approved_length_m), 0) : data.lines.reduce((n, l) => n + Number(l.shortage_m), 0);
  const excess = data.lines.reduce((n, l) => n + Number(l.excess_m), 0);
  const defective = data.batches.flatMap(b => b.lines).filter(l => l.defective).reduce((n, l) => n + Number(l.length_m), 0);
  const open = !data.job.lifecycle_closed_at && data.job.document_status === 'CONFIRMED' && !data.legacyMode;
  return <section className="bg-white border rounded-xl p-4 space-y-4" dir={lifecycleI18n.dir()}>
    <h3 className="font-bold">{lifecycleT('lifecycle.title')}{data.job.job_no} — {data.job.supplier_name}</h3>
    {data.job.previous_job_id && <Link to={`/purchases/external-jobs/${data.job.previous_job_id}`} className="text-indigo-600">{lifecycleT('lifecycle.previous')}</Link>}
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status" className="text-green-700">{message}</p>}
    {data.legacyMode && <p className="text-amber-800">{lifecycleT('lifecycle.legacyNotice')}</p>}
    {data.legacyMode && <div className="border rounded p-3"><p>{lifecycleT('lifecycle.legacyDisplay')}</p>
      {data.legacy.map(r => <p key={r.id}>{new Date(r.received_at).toLocaleString(lifecycleI18n.language)} — {r.result_roll_barcode} — {r.returned_length_m}{lifecycleT('lifecycle.meterWeightSeparator')}{r.returned_weight_kg ?? lifecycleT('lifecycle.unknown')}{lifecycleT('lifecycle.kgSeparator')}{r.destination_warehouse_name} — {r.notes}</p>)}
      {!legacyAggregate && data.lines.filter(l => l.line_status === 'RECEIVED').map(l => <p key={l.id}>{l.sent_barcode} ← {l.new_barcode || l.barcode} — {l.returned_m}{lifecycleT('lifecycle.metersSeparator')}{l.received_at ? new Date(l.received_at).toLocaleString(lifecycleI18n.language) : lifecycleT('lifecycle.unknown')} — {l.receipt_notes}</p>)}
    </div>}
    <p>{lifecycleT('lifecycle.sentPrefix')}{sent.toFixed(3)}{lifecycleT('lifecycle.receivedPrefix')}{received.toFixed(3)}{lifecycleT('lifecycle.remainingPrefix')}{Math.max(0, sent + excess - received - shortage).toFixed(3)}{lifecycleT('lifecycle.shortagePrefix')}{shortage.toFixed(3)}{lifecycleT('lifecycle.excessPrefix')}{excess.toFixed(3)}{lifecycleT('lifecycle.defectivePrefix')}{data.legacyMode ? lifecycleT('lifecycle.unknown') : defective.toFixed(3)}{lifecycleT('lifecycle.meterSuffix')}</p>
    <p>{data.legacyMode ? lifecycleT(`status.${data.job.document_status.toLowerCase()}`) : data.job.lifecycle_closed_at ? lifecycleT('lifecycle.closed') : lifecycleT('lifecycle.open')} — {data.job.fee_posted_at ? lifecycleT('lifecycle.posted') : data.job.fee_amount !== null ? lifecycleT('lifecycle.pricedPending') : lifecycleT('lifecycle.unpriced')}</p>
    <div className="flex gap-3"><button onClick={() => setTab('returns')}>{lifecycleT('lifecycle.returnsTab')}</button><button onClick={() => setTab('pricing')}>{lifecycleT('lifecycle.pricingTab')}</button></div>
    {tab === 'returns' ? <>
      <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{[lifecycleT('lifecycle.itemColumn'),lifecycleT('lifecycle.rollColumn'),lifecycleT('lifecycle.sentColumn'),lifecycleT('lifecycle.receivedColumn'),lifecycleT('lifecycle.remainingColumn'),lifecycleT('lifecycle.shortageColumn')].map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{data.lines.map(l => <tr key={l.id}><td>{l.item_name} / {l.internal_code}</td><td>{l.color_name} / {l.roll_no} / {l.sent_barcode}</td><td>{l.sent_length_m} / {l.sent_weight_display ?? lifecycleT('lifecycle.unknown')}</td><td>{legacyAggregate ? lifecycleT('lifecycle.legacyUnallocated') : l.returned_m}</td><td>{legacyAggregate ? lifecycleT('lifecycle.legacyUnallocated') : remaining(l).toFixed(3)}</td><td>{legacyAggregate ? lifecycleT('lifecycle.legacyUnallocated') : l.shortage_m}</td></tr>)}</tbody></table></div>
      <h4 className="font-bold">{lifecycleT('lifecycle.servicesTitle')}</h4>
      {data.services.map(s => <p key={s.id}>{s.name} — {s.quantity} — {s.basis === 'METER' ? lifecycleT('lifecycle.meter') : s.basis === 'KG' ? lifecycleT('lifecycle.kg') : lifecycleT('lifecycle.fixed')}</p>)}
      {canReceive && open && !data.batches.length && data.job.fee_amount === null && <details><summary>{lifecycleT('lifecycle.editServices')}</summary><fieldset disabled={busy} className="space-y-2">
        {services.map((s, i) => <div key={i} className="flex gap-2"><input aria-label={lifecycleT('lifecycle.serviceName')} className={inputClass} value={s.name} onChange={e => setServices(a => a.map((v,j) => j === i ? {...v,name:e.target.value} : v))}/><input aria-label={lifecycleT('lifecycle.serviceQuantity')} className={inputClass} type="number" min="0.001" step="0.001" value={s.quantity} onChange={e => setServices(a => a.map((v,j) => j === i ? {...v,quantity:e.target.value} : v))}/><select value={s.basis} onChange={e => setServices(a => a.map((v,j) => j === i ? {...v,basis:e.target.value as ServiceBasis} : v))}><option value="METER">{lifecycleT('lifecycle.meter')}</option><option value="KG">{lifecycleT('lifecycle.kg')}</option><option value="FIXED">{lifecycleT('lifecycle.fixed')}</option></select><button onClick={() => setServices(a => a.filter((_,j) => j !== i))}>{lifecycleT('lifecycle.delete')}</button></div>)}
        <button onClick={() => setServices(a => [...a,{ name:'',quantity:'1',basis:'METER' }])}>{lifecycleT('lifecycle.addService')}</button><button onClick={() => run(() => manufacturingAction(jobId,'services',{ services: services.map(s => ({...s,quantity:Number(s.quantity)})) }),lifecycleT('lifecycle.servicesSaved'))}>{lifecycleT('lifecycle.saveServices')}</button>
      </fieldset></details>}
      {!receiving && open && canReceive && <Link className="text-indigo-700 font-bold" to={`/inventory/create?externalJobId=${jobId}`}>{lifecycleT('lifecycle.receive')}</Link>}
      {receiving && canReceive && open && <fieldset disabled={busy} className="space-y-3 border p-3 rounded">
        <legend>{lifecycleT('lifecycle.receiptLegend')}</legend>
        <label>{lifecycleT('lifecycle.warehouse')}<select className={inputClass} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">{lifecycleT('lifecycle.chooseWarehouse')}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label>{lifecycleT('lifecycle.location')}<select className={inputClass} value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">{lifecycleT('lifecycle.noLocation')}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>{lifecycleT('lifecycle.dyePaper')}<input className={inputClass} required value={paper} onChange={e => setPaper(e.target.value)}/></label>
        {rows.map((r,i) => <div className="border p-3 space-y-2" key={i}>
          <select aria-label={lifecycleT('lifecycle.sentRoll')} className={inputClass} value={r.sourceLineId} onChange={e => { const l=data.lines.find(x=>x.id===e.target.value);patch(i,{sourceLineId:e.target.value,widthCm:l?.width_cm??'',gsm:l?.gsm??''}); }}><option value="">{lifecycleT('lifecycle.chooseRoll')}</option>{data.lines.filter(l=>remaining(l)>0).map(l=><option key={l.id} value={l.id}>{l.item_name} — {l.color_name} — {l.sent_barcode}{lifecycleT('lifecycle.remainingOption')}{remaining(l)}{lifecycleT('lifecycle.meterSuffix')}</option>)}</select>
          <div className="grid grid-cols-2 gap-2">{(['lengthM','weightKg','barcode','widthCm','gsm'] as const).map((k,j)=><label key={k}>{[lifecycleT('lifecycle.actualMeters'),lifecycleT('lifecycle.actualWeight'),lifecycleT('lifecycle.newBarcode'),lifecycleT('lifecycle.width'),lifecycleT('lifecycle.gsm')][j]}<input className={inputClass} type={k==='barcode'?'text':'number'} min="0" step="0.001" value={r[k]} onChange={e=>patch(i,{[k]:e.target.value})}/></label>)}</div>
          <div className="flex gap-2"><input placeholder={lifecycleT('lifecycle.returnedColor')} className={inputClass} value={r.colorName} onChange={e=>patch(i,{colorName:e.target.value})}/><input placeholder={lifecycleT('lifecycle.returnedColorCode')} className={inputClass} value={r.colorCode} onChange={e=>patch(i,{colorCode:e.target.value})}/></div>
          <label><input type="checkbox" checked={r.defective} onChange={e=>patch(i,{defective:e.target.checked})}/>{lifecycleT('lifecycle.defectiveCheck')}</label>
          {r.defective && <><select aria-label={lifecycleT('lifecycle.defectReason')} className={inputClass} value={r.defectReason} onChange={e=>patch(i,{defectReason:e.target.value as Row['defectReason']})}><option value="DYE_HOUSE">{lifecycleT('lifecycle.dyeDefect')}</option><option value="INTERNAL_KNITTING">{lifecycleT('lifecycle.knittingDefect')}</option><option value="OTHER">{lifecycleT('lifecycle.otherDefect')}</option></select><input placeholder={lifecycleT('lifecycle.responsible')} className={inputClass} value={r.responsibleParty} onChange={e=>patch(i,{responsibleParty:e.target.value})}/></>}
          <input aria-label={lifecycleT('lifecycle.lineNotes')} placeholder={lifecycleT('lifecycle.lineNotes')} className={inputClass} value={r.notes} onChange={e=>patch(i,{notes:e.target.value})}/><button onClick={()=>setRows(a=>a.filter((_,j)=>j!==i))}>{lifecycleT('lifecycle.deleteLine')}</button>
        </div>)}
        <button onClick={()=>setRows(a=>[...a,blank()])}>{lifecycleT('lifecycle.addRoll')}</button>
        <p>{lifecycleT('lifecycle.completedServices')}</p>{data.services.map(s=><label className="block" key={s.id}><input type="checkbox" checked={completed.includes(s.id)} onChange={e=>setCompleted(a=>e.target.checked?[...new Set([...a,s.id])]:a.filter(id=>id!==s.id))}/>{s.name}</label>)}
        <textarea placeholder={lifecycleT('lifecycle.receiptNotes')} className={inputClass} value={notes} onChange={e=>setNotes(e.target.value)}/><textarea placeholder={lifecycleT('lifecycle.attachments')} className={inputClass} value={attachments} onChange={e=>setAttachments(e.target.value)}/>
        <p>{lifecycleT('lifecycle.reviewPrefix')}{rows.length}{lifecycleT('lifecycle.rollsSuffix')}{rows.reduce((n,r)=>n+Number(r.lengthM||0),0).toFixed(3)}{lifecycleT('lifecycle.metersSeparator')}{rows.reduce((n,r)=>n+Number(r.weightKg||0),0).toFixed(3)}{lifecycleT('lifecycle.weightNote')}</p>
        <button disabled={!warehouseId||!paper.trim()||!rows.length||rows.some(r=>!r.sourceLineId||Number(r.lengthM)<=0)} onClick={receive} className="bg-emerald-700 text-white px-4 py-2 rounded">{lifecycleT('lifecycle.confirmReceipt')}</button>
      </fieldset>}
      {data.batches.map(b=><details key={b.id} open><summary>{lifecycleT('lifecycle.batchPrefix')}{b.dye_paper_no} — {new Date(b.received_at).toLocaleString(lifecycleI18n.language)}</summary><p>{b.notes}</p><p>{lifecycleT('lifecycle.servicesPrefix')}{b.service_ids.map(id=>data.services.find(s=>s.id===id)?.name??id).join(lifecycleT('lifecycle.separator'))}</p>{b.attachments.map(url=><a className="block text-indigo-600" key={url} href={url} target="_blank" rel="noopener noreferrer">{lifecycleT('lifecycle.attachment')}</a>)}
        {b.lines.map(l=><div key={l.id} className="border p-2"><p>{l.original_barcode} ← {l.barcode} — {l.length_m}{lifecycleT('lifecycle.meterWeightSeparator')}{l.weight_kg??lifecycleT('lifecycle.unknown')}{lifecycleT('lifecycle.kgSeparator')}{lifecycleT(`lifecycle.rollStatus.${l.status}`, { defaultValue: l.status })}</p><p>{l.defect_reason ? lifecycleT(`lifecycle.defect.${l.defect_reason}`) : ''} {l.responsible_party} {l.notes} {l.resolution ? lifecycleT(`lifecycle.decision.${l.resolution}`) : ''} {l.resolution_notes}</p>
          {l.defective&&!l.resolution&&canManage&&<div>{(['ACCEPT','REWORK','WRITE_OFF'] as const).map((decision,i)=><button key={decision} className="border rounded p-2 ml-2" disabled={busy} onClick={()=>{ const note=window.prompt(lifecycleT('lifecycle.decisionNotes')); if(note?.trim())void run(()=>manufacturingAction(jobId,'resolve-defect',{returnLineId:l.id,decision,notes:note.trim()}),lifecycleT('lifecycle.decisionSaved')); }}>{[lifecycleT('lifecycle.accept'),lifecycleT('lifecycle.rework'),lifecycleT('lifecycle.writeOff')][i]}</button>)}</div>}
          {l.resolution==='REWORK'&&canReceive&&<Link className="text-indigo-700" to={`/purchases/external-jobs/processing/new?previousJobId=${jobId}`}>{lifecycleT('lifecycle.createRework')}</Link>}
        </div>)}</details>)}
      <h4>{lifecycleT('lifecycle.settlements')}</h4>{data.settlements.map(s=><p key={s.id}>{s.kind==='EXCESS'?lifecycleT('lifecycle.approvedExcess'):lifecycleT('lifecycle.approvedShortage')} — {s.amount_m}{lifecycleT('lifecycle.metersSeparator')}{s.reason} — {new Date(s.approved_at).toLocaleString(lifecycleI18n.language)}</p>)}
      {canManage&&open&&<fieldset disabled={busy} className="border p-3 space-y-2"><legend>{lifecycleT('lifecycle.settlementLegend')}</legend>
        <select aria-label={lifecycleT('lifecycle.settlementType')} className={inputClass} value={settlement.kind} onChange={e=>setSettlement({...settlement,kind:e.target.value})}><option value="SHORTAGE">{lifecycleT('lifecycle.shortage')}</option><option value="EXCESS">{lifecycleT('lifecycle.excess')}</option></select>
        <select className={inputClass} value={settlement.sourceLineId} onChange={e=>setSettlement({...settlement,sourceLineId:e.target.value})}><option value="">{lifecycleT('lifecycle.sourceLine')}</option>{data.lines.filter(l=>settlement.kind==='EXCESS'||remaining(l)>0).map(l=><option value={l.id} key={l.id}>{l.sent_barcode} — {remaining(l)}{lifecycleT('lifecycle.meterSuffix')}</option>)}</select>
        <input aria-label={lifecycleT('lifecycle.settlementQuantity')} className={inputClass} type="number" min="0.001" step="0.001" value={settlement.amountM} onChange={e=>setSettlement({...settlement,amountM:e.target.value})}/><input placeholder={lifecycleT('lifecycle.settlementReason')} className={inputClass} value={settlement.reason} onChange={e=>setSettlement({...settlement,reason:e.target.value})}/>
        <button onClick={()=>run(async()=>{await manufacturingAction(jobId,'settlements',{...settlement,amountM:Number(settlement.amountM)});setSettlement({sourceLineId:'',amountM:'',reason:'',kind:'SHORTAGE'});},lifecycleT('lifecycle.settlementSaved'))}>{lifecycleT('lifecycle.approveSettlement')}</button><button className="mr-4" onClick={()=>run(()=>manufacturingAction(jobId,'close',{}),lifecycleT('lifecycle.closedSuccess'))}>{lifecycleT('lifecycle.close')}</button>
      </fieldset>}
    </> : <div className="space-y-3">
      <p>{lifecycleT('lifecycle.pricingInfo')}</p>
      {data.legacyMode ? <p>{lifecycleT('lifecycle.legacyPricing')}</p> : !canPrice?<p>{lifecycleT('lifecycle.pricingPermission')}</p>:<fieldset disabled={busy||!!data.job.fee_posted_at} className="space-y-3">
        {prices.map((p,i)=><div key={p.serviceId} className="border p-2 grid grid-cols-2 gap-2"><strong>{data.services.find(s=>s.id===p.serviceId)?.name}</strong><label>{lifecycleT('lifecycle.basis')}<select className={inputClass} value={p.basis} onChange={e=>setPrices(a=>a.map((v,j)=>i===j?{...v,basis:e.target.value as ServiceBasis}:v))}><option value="METER">{lifecycleT('lifecycle.meter')}</option><option value="KG">{lifecycleT('lifecycle.kg')}</option><option value="FIXED">{lifecycleT('lifecycle.fixed')}</option></select></label>{(['unitPrice','currencyCode','approvedQuantity'] as const).map((k,j)=><label key={k}>{[lifecycleT('lifecycle.unitPrice'),lifecycleT('lifecycle.currency'),lifecycleT('lifecycle.approvedQuantity')][j]}<input className={inputClass} type={k==='currencyCode'?'text':'number'} min="0" step="0.0001" value={p[k]} onChange={e=>setPrices(a=>a.map((v,n)=>n===i?{...v,[k]:e.target.value}:v))}/></label>)}<p>{lifecycleT('lifecycle.totalPrefix')}{(Number(p.unitPrice)*Number(p.approvedQuantity)).toFixed(4)} {p.currencyCode}</p></div>)}
        <button disabled={!prices.length||prices.some(p=>p.unitPrice==='')} onClick={()=>run(()=>manufacturingAction(jobId,'service-pricing',{lines:prices.map(p=>({...p,unitPrice:Number(p.unitPrice),approvedQuantity:Number(p.approvedQuantity)}))}),lifecycleT('lifecycle.pricingSaved'))}>{lifecycleT('lifecycle.savePricing')}</button>
        <button className="mr-4" disabled={data.job.fee_amount===null} onClick={()=>{if(window.confirm(lifecycleT('lifecycle.confirmPost')))void run(()=>postExternalJobFee(jobId),lifecycleT('lifecycle.postSaved'));}}>{lifecycleT('lifecycle.post')}</button>
      </fieldset>}
      <p>{lifecycleT('lifecycle.feePrefix')}{data.job.fee_amount??lifecycleT('lifecycle.unpriced')} {data.job.fee_currency_code} — {data.job.fee_posted_at?lifecycleT('lifecycle.posted'):lifecycleT('lifecycle.unposted')}</p>
    </div>}
  </section>;
}
