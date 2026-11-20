import React,{useState} from 'react';
import {usePermissions} from '../../hooks/usePermissions';
import {apiFetch} from '../../lib/api/client';
import {renderManufacturingBeamLabel,renderManufacturingWorkOrder,type ManufacturingPrintData} from '../../lib/printing/renderManufacturingPrint';
import {buildCode128Svg} from '../../lib/printing/renderCartelaLabel';

export function ManufacturingPrintButton({kind,id}:{kind:'work-orders'|'warp-beams'|'sized-beams';id:string}){
  const {has}=usePermissions(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const permission=kind==='work-orders'?'manufacturing.work_orders.view':kind==='warp-beams'?'manufacturing.warping.view':'manufacturing.sizing.view';
  if(!has(permission))return null;
  const print=async()=>{
    // Reserve synchronously to avoid popup blocking after the network request.
    const popup=window.open('','_blank','width=980,height=900');
    if(!popup){setError('اسمح بالنوافذ المنبثقة للطباعة');return;}
    popup.opener=null;popup.document.body.textContent='جارٍ تحميل بيانات الطباعة…';setBusy(true);setError('');
    try{
      const result=await apiFetch<{ok:true;data:ManufacturingPrintData}>('/api/manufacturing/print/'+kind+'/'+encodeURIComponent(id),{method:'POST'});
      if(popup.closed)throw new Error('تم إغلاق نافذة الطباعة');
      const html=kind==='work-orders'?renderManufacturingWorkOrder(result.data):renderManufacturingBeamLabel(result.data,buildCode128Svg);
      popup.document.open();popup.document.write(html);popup.document.close();
      await popup.document.fonts.ready;
      await Promise.all(Array.from(popup.document.images).map(img=>img.decode().catch(()=>undefined)));
      popup.focus();popup.print();
    }catch(e){popup.close();setError(e instanceof Error?e.message:'تعذر تحميل بيانات الطباعة');}finally{setBusy(false);}
  };
  return <span className="inline-flex flex-col gap-1"><button type="button" disabled={busy} onClick={()=>void print()} className="rounded border px-2 py-1 text-sm text-indigo-700 disabled:opacity-50">{busy?'جارٍ التحميل…':kind==='work-orders'?'طباعة أمر الإنتاج الكامل':'طباعة ملصق المطواة'}</button>{error&&<span role="alert" className="text-xs text-red-700">{error}</span>}</span>;
}
