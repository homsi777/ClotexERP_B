import { useState } from 'react';
import type { CustomerOrder } from '../../types';
import { groupZoneBarcodes, type ZoneRollGroup } from '../../lib/api/warehouseZonesApi';
import { renderOrderPickingByZone } from '../../lib/printing/renderOrderPickingByZone';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';

const qty=(value:number)=>value.toLocaleString('ar',{maximumFractionDigits:3});
export function OrderPickingByZonePanel({order,customerName}:{order:CustomerOrder;customerName:string}){
 const[barcode,setBarcode]=useState(''),[groups,setGroups]=useState<ZoneRollGroup[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const codes=groups.flatMap(g=>g.rolls.map(r=>r.barcode));
 const refresh=async(next:string[])=>{const result=next.length?await groupZoneBarcodes(next):[];if(result.flatMap(g=>g.rolls).length!==new Set(next).size)throw new Error('تغيرت بعض الرولات؛ أعد تحديد القائمة');setGroups(result);return result;};
 const add=async()=>{const entered=barcode.split(/[\s,،;]+/).map(x=>x.trim()).filter(Boolean);if(!entered.length)return;setBusy(true);setError('');try{await refresh([...new Set([...codes,...entered])]);setBarcode('');}catch(e){setError(e instanceof Error?e.message:'تعذر إضافة الرولات');}finally{setBusy(false);}};
 const remove=async(code:string)=>{setBusy(true);setError('');try{await refresh(codes.filter(c=>c!==code));}catch(e){setError(e instanceof Error?e.message:'تعذر التحديث');}finally{setBusy(false);}};
 const print=async()=>{setBusy(true);setError('');try{
  const fresh=await refresh(codes);if(!fresh.length)throw new Error('حدد الرولات أولاً');
  if(fresh.some(g=>g.rolls.some(r=>r.status!=='AVAILABLE'||Number(r.length_m)<=0)))throw new Error('توجد رولات غير متاحة؛ أزلها قبل طباعة كشف التجهيز');
  const html=renderOrderPickingByZone({orderNumber:order.orderNumber,customerName,groups:fresh});
  if(window.fabricApp?.isElectron&&window.fabricApp.printHtml){const settings=await window.fabricApp.getSettings();const result=await window.fabricApp.printHtml(html,{pageSize:'A4',silent:Boolean(settings.silentA4PrintingEnabled),printerName:settings.defaultA4PrinterName??undefined,printBackground:true});if(!result.ok)throw new Error(result.error||'تعذرت الطباعة');}
  else if(!openDocumentPrintWindow(html,`تجهيز ${order.orderNumber}`))throw new Error('اسمح بفتح نافذة الطباعة في المتصفح');
 }catch(e){setError(e instanceof Error?e.message:'تعذرت الطباعة');}finally{setBusy(false);}};
 return <div className="h-full overflow-y-auto bg-white p-4 space-y-4" dir="rtl">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">تجهيز الطلبية حسب المستودع والعنبر</h3><button type="button" className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy||!codes.length} onClick={()=>void print()}>طباعة كشف التجهيز</button></div>
  <p className="text-sm text-slate-600">امسح باركود الرولات الفعلية أو الصق عدة باركودات. تُحفظ القائمة طوال فتح هذه الطلبية وتُراجع الحالة مجدداً قبل الطباعة. لا تنشئ هذه القائمة حجزاً مخزنياً.</p>
  <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>المطلوب في الطلبية:</strong>{order.items.map(line=><div key={line.id}>{line.materialName} — {line.colorName||line.colorCode||'—'} — {qty(line.remainingMeters??line.length)} {line.unitType==='yard'?'ياردة':'متر'}</div>)}</div>
  <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void add();}}><input aria-label="باركود رول التجهيز" autoComplete="off" autoFocus value={barcode} disabled={busy} onChange={e=>setBarcode(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2" placeholder="مسح الباركود أو لصق باركودات"/><button type="submit" disabled={busy||!barcode.trim()} className="rounded-lg border px-4 py-2 disabled:opacity-50">إضافة للرولات المحددة</button></form>
  {error&&<p role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</p>}
  {!groups.length&&<p className="py-8 text-center text-slate-500">لم تحدد رولات للتجهيز بعد</p>}
  {groups.map(g=><section key={`${g.warehouseId}:${g.zoneId??'none'}`} className="overflow-hidden rounded-xl border"><div className="bg-indigo-50 p-3 font-bold">{g.warehouseName} — {g.zoneName}<span className="mx-3 text-sm font-normal">{g.rolls.length} توب — {qty(g.rolls.reduce((s,r)=>s+Number(r.length_m),0))} م</span></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm text-right"><thead><tr className="border-b"><th className="p-2">الباركود</th><th>الخامة</th><th>اللون</th><th>الأمتار</th><th>كغ</th><th>الحالة</th><th></th></tr></thead><tbody>{g.rolls.map(r=><tr key={r.id} className="border-b"><td className="p-2 font-mono">{r.barcode}</td><td>{r.item_name}</td><td>{r.color_name||r.color_code||'—'}</td><td>{qty(Number(r.length_m))}</td><td>{r.weight_kg==null?'—':qty(Number(r.weight_kg))}</td><td className={r.status==='AVAILABLE'?'text-emerald-700':'text-rose-700'}>{r.status==='AVAILABLE'?'متاح':'غير متاح للتجهيز'}</td><td><button disabled={busy} className="p-2 text-rose-700" onClick={()=>void remove(r.barcode)}>إزالة</button></td></tr>)}</tbody></table></div></section>)}
  {Boolean(codes.length)&&<div className="rounded-lg bg-slate-100 p-3 font-bold">الإجمالي: {codes.length} توب — {qty(groups.flatMap(g=>g.rolls).reduce((s,r)=>s+Number(r.length_m),0))} متر</div>}
 </div>;
}
