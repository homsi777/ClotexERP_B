import { manufacturingError } from '../../lib/externalManufacturingI18n';
import {ExternalMixedCostPanel} from './ExternalMixedCostPanel';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { renderExternalJobPricingA4Html } from '../../lib/printing/renderExternalJobPricingA4';
import { getManufacturing, manufacturingAction, type ManufacturingResponse, type ServiceBasis } from '../../lib/api/externalManufacturingApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listLocations } from '../../lib/api/warehousesApi';
import { postExternalJobFee } from '../../lib/api/externalJobsApi';
import { renderExternalManufacturingBatch } from '../../lib/printing/renderExternalManufacturingBatch';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';

type Row = { itemId: string; targetKey: string; lengthM: string; weightKg: string; barcode: string; colorName: string; colorCode: string; widthCm: string; gsm: string; defective: boolean; defectReason: 'DYE_HOUSE' | 'INTERNAL_KNITTING' | 'OTHER'; responsibleParty: string; notes: string };
const blank = (defaults: { widthCm?: string | null; gsm?: string | null } = {}): Row => ({ itemId: '', targetKey: '', lengthM: '', weightKg: '', barcode: '', colorName: '', colorCode: '', widthCm: defaults.widthCm ?? '', gsm: defaults.gsm ?? '', defective: false, defectReason: 'DYE_HOUSE', responsibleParty: '', notes: '' });
const inputClass = 'border rounded p-2 w-full text-sm';
const remaining = (l: { sent_length_m: string; returned_m: string; shortage_m: string; excess_m: string }) => Math.max(0, Math.round((Number(l.sent_length_m) + Number(l.excess_m) - Number(l.returned_m) - Number(l.shortage_m)) * 1000) / 1000);

/** مفتاح الربط «أوردر|سطر لون» ← مرجع الخادم (فارغ = تلقائي، «|» = مخزون عام). */
const targetRefOf = (key: string) => {
  if (!key) return undefined;
  const [order, line] = key.split('|');
  return { customerOrderId: order || null, customerOrderLineId: line || null };
};

export function ExternalManufacturingLifecycle({ jobId, receiving = false, initialTab }: { jobId: string; receiving?: boolean; initialTab?: 'quality' }) {
  const [query]=useSearchParams();
  const manufacturingOrigin=query.get('from')==='manufacturing';
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
  const [receiveStep, setReceiveStep] = useState<1 | 2>(1);
  const [tab, setTab] = useState<'overview'|'receive'|'quality'|'settlements'|'pricing'>(initialTab || (['overview','receive','quality','settlements','pricing'].includes(query.get('tab') ?? '') ? (query.get('tab') as 'overview'|'receive'|'quality'|'settlements'|'pricing') : (query.get('quality')==='1'?'quality':'overview')));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const [services, setServices] = useState<{ name: string; quantity: string; basis: ServiceBasis }[]>([]);
  const [prices, setPrices] = useState<{ serviceId: string; unitPrice: string; currencyCode: string; basis: ServiceBasis; approvedQuantity: string }[]>([]);
  const [settlement, setSettlement] = useState({ amountM: '', reason: '', category: 'SHORTAGE' as 'SHORTAGE' | 'WASTE' | 'SPOILAGE' | 'EXCESS' });
  const load = async () => {
    const result = await getManufacturing(jobId); setResponse(result);
    setServices(result.data.services.map(s => ({ name: s.name, quantity: s.quantity, basis: s.basis })));
    setPrices(result.data.services.map(s => ({ serviceId: s.id, unitPrice: s.unit_price ?? '', currencyCode: s.currency_code ?? 'EGP', basis: s.basis, approvedQuantity: s.approved_quantity ?? (s.basis === 'FIXED' ? '1' : s.quantity) })));
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
      lines: rows.map(r => ({ itemId: r.itemId || undefined, targetRef: targetRefOf(r.targetKey), lengthM: Number(r.lengthM), weightKg: r.weightKg === '' ? null : Number(r.weightKg),
        barcode: r.barcode.trim() || undefined, colorName: r.colorName.trim() || undefined, colorCode: r.colorCode.trim() || undefined, widthCm: r.widthCm === '' ? null : Number(r.widthCm), gsm: r.gsm === '' ? null : Number(r.gsm),
        defective: r.defective, defectReason: r.defective ? r.defectReason : undefined, responsibleParty: r.defective ? r.responsibleParty.trim() : undefined, notes: r.notes.trim() || undefined })) };
    const signature = JSON.stringify(payload);
    if (!retry.current || retry.current.payload !== signature) retry.current = { payload: signature, id: crypto.randomUUID() };
    await manufacturingAction(jobId, 'returns', { ...payload, requestId: retry.current.id });
    retry.current = null; setRows([blank()]); setPaper(''); setNotes(''); setAttachments(''); setCompleted([]); setReceiveStep(1); setTab('quality');
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
  const receivedKg = data.batches.flatMap(b => b.lines).reduce((n, l) => n + (Number(l.weight_kg) || 0), 0);
  const remainingTotal = Math.max(0, Math.round((sent + excess - received - shortage) * 1000) / 1000);
  // الاستلام بمرجع الكمية الإجمالية: لا اختيار لبكرة مرسلة. تظهر قوائم الخامة/الأوردر فقط عند تعدّدها في المهمة.
  const openLines = data.lines.filter(l => remaining(l) > 0);
  const itemChoices = [...new Map(openLines.map(l => [String(l.sent_item_id ?? l.item_id ?? ''), `${l.item_name} / ${l.internal_code}`])).entries()].filter(([k]) => k);
  const targetChoices = [...new Map(openLines.map(l => [`${l.customer_order_id ?? ''}|${l.customer_order_line_id ?? ''}`,
    l.customer_order_no ? `${l.customer_order_no} / ${l.customer_order_line_no ?? ''}` : lifecycleT('traceability.stock')])).entries()];
  const jobDefaults = { widthCm: data.job.finished_width_cm ?? null, gsm: data.job.finished_gsm ?? null };
  const enteredTotal = rows.reduce((n, r) => n + Number(r.lengthM || 0), 0);
  const missing = [
    ...(!warehouseId ? [lifecycleT('lifecycle.missing.warehouse')] : []),
    ...(!paper.trim() ? [lifecycleT('lifecycle.missing.paper')] : []),
    ...(rows.some(r => !(Number(r.lengthM) > 0)) ? [lifecycleT('lifecycle.missing.lengths')] : []),
    ...(enteredTotal > remainingTotal + 0.0005 ? [lifecycleT('lifecycle.missing.exceeds')] : []),
    ...(rows.some(r => r.defective && !r.responsibleParty.trim()) ? [lifecycleT('lifecycle.missing.responsible')] : []),
  ];
  return <section data-external-lifecycle className="min-w-0 bg-white border rounded-xl p-4 space-y-4" dir={lifecycleI18n.dir()}>
    <h3 className="font-bold">{lifecycleT('lifecycle.title')}{data.job.job_no} — {data.job.supplier_name}</h3>
    {data.job.traceability_only && <p className="rounded bg-amber-50 p-3 text-amber-900">{lifecycleT('traceability.costNotice')}</p>}
    {data.job.previous_job_id && <Link to={`/purchases/external-jobs/${data.job.previous_job_id}${manufacturingOrigin?'?from=manufacturing':''}`} className="text-indigo-600">{lifecycleT('lifecycle.previous')}</Link>}
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status" className="text-green-700">{message}</p>}
    {data.legacyMode && <p className="text-amber-800">{lifecycleT('lifecycle.legacyNotice')}</p>}
    {data.legacyMode && <div className="border rounded p-3"><p>{lifecycleT('lifecycle.legacyDisplay')}</p>
      {data.legacy.map(r => <p key={r.id}>{new Date(r.received_at).toLocaleString(lifecycleI18n.language)} — {r.result_roll_barcode} — {r.returned_length_m}{lifecycleT('lifecycle.meterWeightSeparator')}{r.returned_weight_kg ?? lifecycleT('lifecycle.unknown')}{lifecycleT('lifecycle.kgSeparator')}{r.destination_warehouse_name} — {r.notes}</p>)}
      {!legacyAggregate && data.lines.filter(l => l.line_status === 'RECEIVED').map(l => <p key={l.id}>{l.sent_barcode} ← {l.new_barcode || l.barcode} — {l.returned_m}{lifecycleT('lifecycle.metersSeparator')}{l.received_at ? new Date(l.received_at).toLocaleString(lifecycleI18n.language) : lifecycleT('lifecycle.unknown')} — {l.receipt_notes}</p>)}
    </div>}
    <p>{lifecycleT('lifecycle.sentPrefix')}{sent.toFixed(3)}{lifecycleT('lifecycle.receivedPrefix')}{received.toFixed(3)}{lifecycleT('lifecycle.remainingPrefix')}{Math.max(0, sent + excess - received - shortage).toFixed(3)}{lifecycleT('lifecycle.shortagePrefix')}{shortage.toFixed(3)}{lifecycleT('lifecycle.excessPrefix')}{excess.toFixed(3)}{lifecycleT('lifecycle.defectivePrefix')}{data.legacyMode ? lifecycleT('lifecycle.unknown') : defective.toFixed(3)}{lifecycleT('lifecycle.meterSuffix')}</p>
    <p>{data.legacyMode ? lifecycleT(`status.${data.job.document_status.toLowerCase()}`) : data.job.lifecycle_closed_at ? lifecycleT('lifecycle.closed') : lifecycleT('lifecycle.open')} — {data.job.fee_posted_at ? lifecycleT('lifecycle.posted') : data.job.fee_amount !== null ? lifecycleT('lifecycle.pricedPending') : lifecycleT('lifecycle.unpriced')}</p>
    {(data.job.raw_width_cm || data.job.finished_width_cm || data.job.raw_gsm || data.job.finished_gsm) && <p className="text-sm text-slate-700">{lifecycleT('lifecycle.sheetPrefix')}{[
      data.job.raw_width_cm ? `${lifecycleT('print.rawWidth')}: ${Number(data.job.raw_width_cm)}` : '',
      data.job.finished_width_cm ? `${lifecycleT('print.finishedWidth')}: ${Number(data.job.finished_width_cm)}` : '',
      data.job.raw_gsm ? `${lifecycleT('print.rawGsm')}: ${Number(data.job.raw_gsm)}` : '',
      data.job.finished_gsm ? `${lifecycleT('print.finishedGsm')}: ${Number(data.job.finished_gsm)}` : '',
    ].filter(Boolean).join(lifecycleT('lifecycle.separator'))}</p>}
    {open && !data.legacyMode && (data.job.inventory_completed_at ? (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
        <span>{lifecycleT('lifecycle.inventoryDone')}</span>
        {canManage && !data.job.fee_posted_at && <button type="button" className="rounded border border-emerald-300 bg-white px-3 py-1 text-xs" disabled={busy} onClick={() => { if (window.confirm(lifecycleT('lifecycle.reopenConfirm'))) void run(() => manufacturingAction(jobId, 'inventory-reopen', {}), lifecycleT('lifecycle.reopened')); }}>{lifecycleT('lifecycle.reopenInventory')}</button>}
      </div>
    ) : canReceive ? (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
        <span className="font-bold text-indigo-900">{lifecycleT('lifecycle.inventoryPending')}</span>
        <button type="button" className="rounded-lg bg-indigo-700 px-4 py-2 font-bold text-white disabled:opacity-40" disabled={busy} onClick={() => { if (window.confirm(lifecycleT('lifecycle.inventoryConfirm', { remaining: remainingTotal.toFixed(3) }))) void run(() => manufacturingAction(jobId, 'inventory-complete', {}), lifecycleT('lifecycle.inventoryCompleted')); }}>{lifecycleT('lifecycle.completeInventory')}</button>
      </div>
    ) : null)}
    <nav aria-label={lifecycleT('workflow.label')} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{([
      ['overview',lifecycleT('workflow.overview')],...(receiving&&canReceive&&open&&!data.job.inventory_completed_at?[['receive',lifecycleT('workflow.receive')]]:[]),['quality',lifecycleT('workflow.quality')],...(canManage?[['settlements',lifecycleT('workflow.settlements')]]:[]),['pricing',lifecycleT('workflow.pricing')]
    ] as Array<[typeof tab,string]>).map(([id,label])=><button key={id} data-external-tab={id} aria-current={tab===id?'page':undefined} className={`rounded-lg border px-3 py-2 text-sm font-bold ${tab===id?'bg-indigo-600 text-white':'bg-white text-slate-700'}`} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab !== 'pricing' ? <>
      {tab==='overview'&&<>
      <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{[lifecycleT('lifecycle.itemColumn'),lifecycleT('lifecycle.rollColumn'),lifecycleT('lifecycle.sentColumn'),lifecycleT('lifecycle.receivedColumn'),lifecycleT('lifecycle.remainingColumn'),lifecycleT('lifecycle.shortageColumn')].map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{data.lines.map(l => <tr key={l.id}><td>{l.item_name} / {l.internal_code}<p className="text-xs text-indigo-700">{l.customer_order_no ? `${l.customer_order_no} / ${l.customer_order_line_no ?? ''}` : lifecycleT('traceability.stock')}</p></td><td>{l.color_name} / {l.roll_no} / {l.sent_barcode}</td><td>{l.sent_length_m} / {l.sent_weight_display ?? lifecycleT('lifecycle.unknown')}</td><td>{legacyAggregate ? lifecycleT('lifecycle.legacyUnallocated') : l.returned_m}</td><td>{legacyAggregate ? lifecycleT('lifecycle.legacyUnallocated') : remaining(l).toFixed(3)}</td><td>{legacyAggregate ? lifecycleT('lifecycle.legacyUnallocated') : l.shortage_m}</td></tr>)}</tbody></table></div>
      <h4 className="font-bold">{lifecycleT('lifecycle.servicesTitle')}</h4>
      {data.services.map(s => <p key={s.id}>{s.name} — {s.quantity} — {s.basis === 'METER' ? lifecycleT('lifecycle.meter') : s.basis === 'KG' ? lifecycleT('lifecycle.kg') : lifecycleT('lifecycle.fixed')}</p>)}
      {canReceive && open && !data.batches.length && data.job.fee_amount === null && !data.job.inventory_completed_at && <details><summary>{lifecycleT('lifecycle.editServices')}</summary><fieldset disabled={busy} className="space-y-2">
        {services.map((s, i) => <div key={i} className="flex gap-2"><input aria-label={lifecycleT('lifecycle.serviceName')} className={inputClass} value={s.name} onChange={e => setServices(a => a.map((v,j) => j === i ? {...v,name:e.target.value} : v))}/><input aria-label={lifecycleT('lifecycle.serviceQuantity')} className={inputClass} type="number" min="0.001" step="0.001" value={s.quantity} onChange={e => setServices(a => a.map((v,j) => j === i ? {...v,quantity:e.target.value} : v))}/><select value={s.basis} onChange={e => setServices(a => a.map((v,j) => j === i ? {...v,basis:e.target.value as ServiceBasis} : v))}><option value="METER">{lifecycleT('lifecycle.meter')}</option><option value="KG">{lifecycleT('lifecycle.kg')}</option><option value="FIXED">{lifecycleT('lifecycle.fixed')}</option></select><button onClick={() => setServices(a => a.filter((_,j) => j !== i))}>{lifecycleT('lifecycle.delete')}</button></div>)}
        <button onClick={() => setServices(a => [...a,{ name:'',quantity:'1',basis:'METER' }])}>{lifecycleT('lifecycle.addService')}</button><button onClick={() => run(() => manufacturingAction(jobId,'services',{ services: services.map(s => ({...s,quantity:Number(s.quantity)})) }),lifecycleT('lifecycle.servicesSaved'))}>{lifecycleT('lifecycle.saveServices')}</button>
      </fieldset></details>}
      {!receiving && open && canReceive && <Link className="text-indigo-700 font-bold" to={`/inventory/create?externalJobId=${jobId}`}>{lifecycleT('lifecycle.receive')}</Link>}
      </>}
      {/* سياسة بشير — "نفس شعور فاتورة الشراء": رأس المستند (مستودع/موقع/
          ورقة الصباغة) أعلاه، ثم جدول أسطر بعمود لكل حقل + زر حذف بكل صف +
          صف إجماليات أسفله، بنفس النمط البصري المُستخدَم بجداول فواتير
          الشراء/البيع والمناقلات بالمشروع — المنطق والنداء الخلفي (receive)
          لم يتغيّرا بحرف واحد، تعديل عرض فقط. */}
      {tab==='receive'&&receiving && canReceive && open && <fieldset disabled={busy} className="space-y-3 border rounded-xl p-4 bg-slate-50">
        <legend className="font-bold px-1">{lifecycleT('lifecycle.receiptLegend')}</legend>
        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-white p-3 text-center text-sm">
          <div><div className="text-xs text-slate-500">{lifecycleT('lifecycle.totalSent')}</div><b>{(sent + excess).toFixed(3)}</b></div>
          <div><div className="text-xs text-slate-500">{lifecycleT('lifecycle.totalReceived')}</div><b>{received.toFixed(3)}</b></div>
          <div><div className="text-xs text-slate-500">{lifecycleT('lifecycle.totalRemaining')}</div><b className={remainingTotal > 0 ? 'text-amber-700' : 'text-emerald-700'}>{remainingTotal.toFixed(3)}</b></div>
        </div>
        {receiveStep === 1 ? <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-sm">{lifecycleT('lifecycle.warehouse')}<select aria-label={lifecycleT('lifecycle.warehouse')} className={inputClass} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">{lifecycleT('lifecycle.chooseWarehouse')}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            <label className="text-sm">{lifecycleT('lifecycle.location')}<select aria-label={lifecycleT('lifecycle.location')} className={inputClass} value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">{lifecycleT('lifecycle.noLocation')}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="text-sm">{lifecycleT('lifecycle.dyePaper')}<input aria-label={lifecycleT('lifecycle.dyePaper')} className={inputClass} required value={paper} onChange={e => setPaper(e.target.value)}/></label>
          </div>
          <button type="button" disabled={!warehouseId || !paper.trim()} onClick={() => { setRows(r => (r.length === 1 && !r[0].lengthM ? [blank(jobDefaults)] : r)); setReceiveStep(2); }} className="bg-indigo-700 text-white px-4 py-2 rounded font-bold disabled:opacity-40">{lifecycleT('lifecycle.continueToRolls')}</button>
          {(!warehouseId || !paper.trim()) && <p className="text-xs text-amber-700">{lifecycleT('lifecycle.step1Hint')}</p>}
        </> : <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-2 text-sm">
            <span>{warehouses.find(w => w.id === warehouseId)?.name}{locationId ? ` / ${locations.find(l => l.id === locationId)?.name ?? ''}` : ''} — {lifecycleT('lifecycle.dyePaper')}: <b>{paper}</b></span>
            <button type="button" className="text-indigo-700 font-bold" onClick={() => setReceiveStep(1)}>{lifecycleT('lifecycle.editHeader')}</button>
          </div>
          <h4 className="font-bold text-sm">{lifecycleT('lifecycle.rollsStepTitle')}</h4>
          <div className="overflow-x-auto bg-white border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  {itemChoices.length > 1 && <th className="p-2 text-right min-w-[160px]">{lifecycleT('lifecycle.itemColumnShort')}</th>}
                  {targetChoices.length > 1 && <th className="p-2 text-right min-w-[160px]">{lifecycleT('lifecycle.targetColumn')}</th>}
                  <th className="p-2 text-right">{lifecycleT('lifecycle.actualMeters')}</th>
                  <th className="p-2 text-right">{lifecycleT('lifecycle.actualWeight')}</th>
                  <th className="p-2 text-right">{lifecycleT('lifecycle.newBarcode')}</th>
                  <th className="p-2 text-right">{lifecycleT('lifecycle.width')}</th>
                  <th className="p-2 text-right">{lifecycleT('lifecycle.gsm')}</th>
                  <th className="p-2 text-right min-w-[140px]">{lifecycleT('lifecycle.returnedColor')}</th>
                  <th className="p-2 text-right">{lifecycleT('lifecycle.defectiveCheck')}</th>
                  <th className="p-2 text-right min-w-[160px]">{lifecycleT('lifecycle.lineNotes')}</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <React.Fragment key={i}>
                    <tr className="border-t align-top">
                      {itemChoices.length > 1 && <td className="p-2"><select aria-label={lifecycleT('lifecycle.itemColumnShort')} className={inputClass} value={r.itemId} onChange={e => patch(i, { itemId: e.target.value })}><option value="">{lifecycleT('lifecycle.chooseItem')}</option>{itemChoices.map(([k, name]) => <option key={k} value={k}>{name}</option>)}</select></td>}
                      {targetChoices.length > 1 && <td className="p-2"><select aria-label={lifecycleT('lifecycle.targetColumn')} className={inputClass} value={r.targetKey} onChange={e => patch(i, { targetKey: e.target.value })}><option value="">{lifecycleT('lifecycle.targetAuto')}</option>{targetChoices.map(([k, name]) => <option key={k} value={k}>{name}</option>)}</select></td>}
                      <td className="p-2"><input aria-label={lifecycleT('lifecycle.actualMeters')} className={inputClass} type="number" min="0" step="0.001" value={r.lengthM} onChange={e=>patch(i,{lengthM:e.target.value})}/></td>
                      <td className="p-2"><input aria-label={lifecycleT('lifecycle.actualWeight')} className={inputClass} type="number" min="0" step="0.001" value={r.weightKg} onChange={e=>patch(i,{weightKg:e.target.value})}/></td>
                      <td className="p-2"><input aria-label={lifecycleT('lifecycle.newBarcode')} className={inputClass} value={r.barcode} onChange={e=>patch(i,{barcode:e.target.value})}/></td>
                      <td className="p-2"><input aria-label={lifecycleT('lifecycle.width')} className={inputClass} type="number" min="0" step="0.001" value={r.widthCm} onChange={e=>patch(i,{widthCm:e.target.value})}/></td>
                      <td className="p-2"><input aria-label={lifecycleT('lifecycle.gsm')} className={inputClass} type="number" min="0" step="0.001" value={r.gsm} onChange={e=>patch(i,{gsm:e.target.value})}/></td>
                      <td className="p-2 space-y-1">
                        <input placeholder={lifecycleT('lifecycle.returnedColor')} className={inputClass} value={r.colorName} onChange={e=>patch(i,{colorName:e.target.value})}/>
                        <input placeholder={lifecycleT('lifecycle.returnedColorCode')} className={inputClass} value={r.colorCode} onChange={e=>patch(i,{colorCode:e.target.value})}/>
                      </td>
                      <td className="p-2 text-center"><input aria-label={lifecycleT('lifecycle.defectiveCheck')} type="checkbox" checked={r.defective} onChange={e=>patch(i,{defective:e.target.checked})}/></td>
                      <td className="p-2"><input aria-label={lifecycleT('lifecycle.lineNotes')} placeholder={lifecycleT('lifecycle.lineNotes')} className={inputClass} value={r.notes} onChange={e=>patch(i,{notes:e.target.value})}/></td>
                      <td className="p-2"><button type="button" onClick={()=>setRows(a=>a.length > 1 ? a.filter((_,j)=>j!==i) : [blank(jobDefaults)])}>{lifecycleT('lifecycle.deleteLine')}</button></td>
                    </tr>
                    {r.defective && (
                      <tr className="bg-amber-50 border-t">
                        <td className="p-2 text-amber-800 text-[11px]" colSpan={itemChoices.length > 1 || targetChoices.length > 1 ? 2 : 1}>{lifecycleT('lifecycle.defectiveCheck')}</td>
                        <td className="p-2" colSpan={2}>
                          <select aria-label={lifecycleT('lifecycle.defectReason')} className={inputClass} value={r.defectReason} onChange={e=>patch(i,{defectReason:e.target.value as Row['defectReason']})}>
                            <option value="DYE_HOUSE">{lifecycleT('lifecycle.dyeDefect')}</option>
                            <option value="INTERNAL_KNITTING">{lifecycleT('lifecycle.knittingDefect')}</option>
                            <option value="OTHER">{lifecycleT('lifecycle.otherDefect')}</option>
                          </select>
                        </td>
                        <td className="p-2" colSpan={2}>
                          <input placeholder={lifecycleT('lifecycle.responsible')} className={inputClass} value={r.responsibleParty} onChange={e=>patch(i,{responsibleParty:e.target.value})}/>
                        </td>
                        <td colSpan={5}></td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-slate-100 font-bold">
                  <td className="p-2" colSpan={(itemChoices.length > 1 ? 1 : 0) + (targetChoices.length > 1 ? 1 : 0) + 1}>{lifecycleT('lifecycle.reviewPrefix')}{rows.length}{lifecycleT('lifecycle.rollsSuffix')}{enteredTotal.toFixed(3)}{lifecycleT('lifecycle.metersSeparator')}</td>
                  <td className="p-2">{rows.reduce((n,r)=>n+Number(r.weightKg||0),0).toFixed(3)}{lifecycleT('lifecycle.weightNote')}</td>
                  <td colSpan={7}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <button type="button" onClick={()=>setRows(a=>[...a,blank(jobDefaults)])} className="text-indigo-700 font-bold">+ {lifecycleT('lifecycle.addRoll')}</button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t">
            <div>
              <p className="text-sm font-bold mb-1">{lifecycleT('lifecycle.completedServices')}</p>
              {data.services.map(s=><label className="block text-sm" key={s.id}><input type="checkbox" checked={completed.includes(s.id)} onChange={e=>setCompleted(a=>e.target.checked?[...new Set([...a,s.id])]:a.filter(id=>id!==s.id))}/> {s.name}</label>)}
            </div>
            <div className="space-y-2">
              <textarea placeholder={lifecycleT('lifecycle.receiptNotes')} className={inputClass} value={notes} onChange={e=>setNotes(e.target.value)}/>
              <textarea placeholder={lifecycleT('lifecycle.attachments')} className={inputClass} value={attachments} onChange={e=>setAttachments(e.target.value)}/>
            </div>
          </div>

          <button disabled={missing.length > 0} onClick={receive} className="bg-emerald-700 text-white px-4 py-2 rounded font-bold disabled:opacity-40">{lifecycleT('lifecycle.confirmReceipt')}</button>
          {missing.length > 0 && <div role="status" className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <p className="font-bold">{lifecycleT('lifecycle.confirmDisabledHint')}</p>
            <ul className="list-disc pr-5">{missing.map(m => <li key={m}>{m}</li>)}</ul>
          </div>}
        </>}
      </fieldset>}
      {(tab==='overview'||tab==='quality')&&data.batches.map(b=><details key={b.id} open><summary>{lifecycleT('lifecycle.batchPrefix')}{b.dye_paper_no} — {new Date(b.received_at).toLocaleString(lifecycleI18n.language)}</summary><button type="button" className="my-2 rounded-lg border px-3 py-2 text-sm font-bold text-indigo-700" onClick={()=>{if(!openDocumentPrintWindow(renderExternalManufacturingBatch(data,b),`${data.job.job_no} — ${b.dye_paper_no}`))setError(lifecycleT('workflow.popupBlocked'));}}>{lifecycleT('workflow.printBatch')}</button><p>{b.notes}</p><p>{lifecycleT('lifecycle.servicesPrefix')}{b.service_ids.map(id=>data.services.find(s=>s.id===id)?.name??id).join(lifecycleT('lifecycle.separator'))}</p>{b.attachments.map(url=><a className="block text-indigo-600" key={url} href={url} target="_blank" rel="noopener noreferrer">{lifecycleT('lifecycle.attachment')}</a>)}
        {b.lines.map(l=><div key={l.id} className="border p-2"><p>{l.original_barcode} ← {l.barcode} — {l.length_m}{lifecycleT('lifecycle.meterWeightSeparator')}{l.weight_kg??lifecycleT('lifecycle.unknown')}{lifecycleT('lifecycle.kgSeparator')}{lifecycleT(`lifecycle.rollStatus.${l.status}`, { defaultValue: l.status })}</p><p>{l.defect_reason ? lifecycleT(`lifecycle.defect.${l.defect_reason}`) : ''} {l.responsible_party} {l.notes} {l.resolution ? lifecycleT(`lifecycle.decision.${l.resolution}`) : ''} {l.resolution_notes}</p>
          {tab==='quality'&&l.defective&&!l.resolution&&canManage&&<div>{(['ACCEPT','REWORK','WRITE_OFF'] as const).map((decision,i)=><button key={decision} className="border rounded p-2 ml-2" disabled={busy} onClick={()=>{ const note=window.prompt(lifecycleT('lifecycle.decisionNotes')); if(note?.trim())void run(()=>manufacturingAction(jobId,'resolve-defect',{returnLineId:l.id,decision,notes:note.trim()}),lifecycleT('lifecycle.decisionSaved')); }}>{[lifecycleT('lifecycle.accept'),lifecycleT('lifecycle.rework'),lifecycleT('lifecycle.writeOff')][i]}</button>)}</div>}
          {l.resolution==='REWORK'&&canReceive&&<Link className="text-indigo-700" to={`/purchases/external-jobs/processing/new?previousJobId=${jobId}${manufacturingOrigin?'&from=manufacturing':''}`}>{lifecycleT('lifecycle.createRework')}</Link>}
        </div>)}</details>)}
      {tab==='quality'&&!data.batches.length&&<p className="rounded bg-slate-50 p-4 text-slate-500">{lifecycleT('workflow.noBatches')}</p>}
      {tab==='settlements'&&<><h4>{lifecycleT('lifecycle.settlements')}</h4>{data.settlements.map(s=><p key={s.id}>{s.reason_category?lifecycleT(`lifecycle.reasonCat.${s.reason_category}`):s.kind==='EXCESS'?lifecycleT('lifecycle.approvedExcess'):lifecycleT('lifecycle.approvedShortage')} — {s.amount_m}{lifecycleT('lifecycle.metersSeparator')}{s.reason} — {new Date(s.approved_at).toLocaleString(lifecycleI18n.language)}</p>)}</>}
      {tab==='settlements'&&canManage&&open&&<fieldset disabled={busy} className="border p-3 space-y-3"><legend>{lifecycleT('lifecycle.settlementLegend')}</legend>
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-3 text-center text-sm sm:grid-cols-4">
          <div><div className="text-xs text-slate-500">{lifecycleT('lifecycle.totalSent')}</div><b>{sent.toFixed(3)}</b></div>
          <div><div className="text-xs text-slate-500">{lifecycleT('lifecycle.totalReceived')}</div><b>{received.toFixed(3)}</b></div>
          <div><div className="text-xs text-slate-500">{lifecycleT('lifecycle.totalSettled')}</div><b>{(shortage - excess).toFixed(3)}</b></div>
          <div><div className="text-xs text-slate-500">{lifecycleT('lifecycle.totalRemaining')}</div><b className={remainingTotal > 0 ? 'text-amber-700' : 'text-emerald-700'}>{remainingTotal.toFixed(3)}</b></div>
        </div>
        <select aria-label={lifecycleT('lifecycle.settlementType')} className={inputClass} value={settlement.category} onChange={e=>setSettlement({...settlement,category:e.target.value as typeof settlement.category})}>
          {(['SHORTAGE','WASTE','SPOILAGE','EXCESS'] as const).map(c=><option key={c} value={c}>{lifecycleT(`lifecycle.reasonCat.${c}`)}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input aria-label={lifecycleT('lifecycle.settlementQuantity')} className={inputClass} type="number" min="0.001" step="0.001" value={settlement.amountM} onChange={e=>setSettlement({...settlement,amountM:e.target.value})}/>
          {settlement.category!=='EXCESS'&&<button type="button" className="shrink-0 rounded border px-2 py-1 text-xs" onClick={()=>setSettlement({...settlement,amountM:remainingTotal.toFixed(3)})}>{lifecycleT('lifecycle.useRemaining')}</button>}
        </div>
        <input placeholder={lifecycleT('lifecycle.settlementReason')} className={inputClass} value={settlement.reason} onChange={e=>setSettlement({...settlement,reason:e.target.value})}/>
        {Number(settlement.amountM)>0&&settlement.category!=='EXCESS'&&<p className="text-xs text-slate-600">{lifecycleT('lifecycle.remainingAfter')}{Math.max(0,remainingTotal-Number(settlement.amountM)).toFixed(3)}</p>}
        <button disabled={!(Number(settlement.amountM)>0)||!settlement.reason.trim()||(settlement.category!=='EXCESS'&&Number(settlement.amountM)>remainingTotal+0.0005)} onClick={()=>run(async()=>{await manufacturingAction(jobId,'settlements',{reasonCategory:settlement.category,reason:settlement.reason,amountM:Number(settlement.amountM)});setSettlement({amountM:'',reason:'',category:'SHORTAGE'});},lifecycleT('lifecycle.settlementSaved'))}>{lifecycleT('lifecycle.approveSettlement')}</button><button className="mr-4" onClick={()=>run(()=>manufacturingAction(jobId,'close',{}),lifecycleT('lifecycle.closedSuccess'))}>{lifecycleT('lifecycle.close')}</button>
      </fieldset>}
    </> : <div className="space-y-3">
      <p>{lifecycleT(data.job.production_cost_closed?'workflow.costLocked':'lifecycle.pricingInfo')}</p>
      {canPrice&&<ExternalMixedCostPanel key={JSON.stringify([data.costShares,data.costAllocationTotalUsd])} jobId={jobId} data={data} onSaved={load}/>}
      {data.legacyMode ? <p>{lifecycleT('lifecycle.legacyPricing')}</p> : !canPrice?<p>{lifecycleT('lifecycle.pricingPermission')}</p>:<fieldset disabled={busy||!!data.job.fee_posted_at} className="space-y-3">
        {prices.map((p,i)=>{const locked=!!data.job.production_cost_closed;
          const setBasis=(basis:ServiceBasis)=>setPrices(a=>a.map((v,j)=>i===j?{...v,basis,approvedQuantity:basis==='FIXED'?'1':basis==='METER'?received.toFixed(3):receivedKg.toFixed(3)}:v));
          const setField=(k:'unitPrice'|'currencyCode'|'approvedQuantity',val:string)=>setPrices(a=>a.map((v,n)=>n===i?{...v,[k]:val}:v));
          return <div key={p.serviceId} className="border p-2 grid grid-cols-2 gap-2">
            <strong>{data.services.find(s=>s.id===p.serviceId)?.name}</strong>
            <label>{lifecycleT('lifecycle.basis')}<select disabled={locked} className={inputClass} value={p.basis} onChange={e=>setBasis(e.target.value as ServiceBasis)}><option value="METER">{lifecycleT('lifecycle.meter')}</option><option value="KG">{lifecycleT('lifecycle.kg')}</option><option value="FIXED">{lifecycleT('lifecycle.fixed')}</option></select></label>
            <label>{lifecycleT('lifecycle.unitPrice')}<input disabled={locked} className={inputClass} type="number" min="0" step="0.0001" value={p.unitPrice} onChange={e=>setField('unitPrice',e.target.value)}/></label>
            <label>{lifecycleT('lifecycle.currency')}<select disabled={locked} className={inputClass} value={p.currencyCode} onChange={e=>setField('currencyCode',e.target.value)}>{['EGP','USD','SYP','TRY'].map(c=><option key={c} value={c}>{lifecycleT(`lifecycle.currencyName.${c}`)}</option>)}</select></label>
            <label>{lifecycleT('lifecycle.quantityMeters')}<input disabled={locked||p.basis!=='METER'} className={inputClass} type="number" min="0" step="0.001" value={p.basis==='METER'?p.approvedQuantity:received.toFixed(3)} onChange={e=>setField('approvedQuantity',e.target.value)}/></label>
            <label>{lifecycleT('lifecycle.quantityKg')}<input disabled={locked||p.basis!=='KG'} className={inputClass} type="number" min="0" step="0.001" value={p.basis==='KG'?p.approvedQuantity:receivedKg.toFixed(3)} onChange={e=>setField('approvedQuantity',e.target.value)}/></label>
            <p>{lifecycleT('lifecycle.totalPrefix')}{(Number(p.unitPrice)*Number(p.approvedQuantity)).toFixed(4)} {p.currencyCode}</p>
          </div>;})}
        <button disabled={!!data.job.production_cost_closed||!prices.length||prices.some(p=>p.unitPrice===''||Number(p.unitPrice)<0||Number(p.approvedQuantity)<=0)} onClick={()=>run(()=>manufacturingAction(jobId,'service-pricing',{lines:prices.map(p=>({...p,unitPrice:Number(p.unitPrice),approvedQuantity:Number(p.approvedQuantity)}))}),lifecycleT('lifecycle.pricingSaved'))}>{lifecycleT('lifecycle.savePricing')}</button>
        <button className="mr-4" disabled={data.job.fee_amount===null} onClick={()=>{if(window.confirm(lifecycleT('lifecycle.confirmPost')))void run(()=>postExternalJobFee(jobId),lifecycleT('lifecycle.postSaved'));}}>{lifecycleT('lifecycle.post')}</button>
      </fieldset>}
      {canPrice&&data.job.fee_amount!==null&&<button type="button" className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-900" onClick={()=>{const html=renderExternalJobPricingA4Html({data,lang:lifecycleI18n.language==='tr'?'tr':'ar'});if(!openDocumentPrintWindow(html,data.job.job_no))setError(lifecycleT('processingNew.printPopupBlocked'));}}>{lifecycleT('lifecycle.printPricing')}</button>}
      <p>{lifecycleT('lifecycle.feePrefix')}{data.job.fee_amount??lifecycleT('lifecycle.unpriced')} {data.job.fee_currency_code} — {data.job.fee_posted_at?lifecycleT('lifecycle.posted'):lifecycleT('lifecycle.unposted')}</p>
    </div>}
  </section>;
}
