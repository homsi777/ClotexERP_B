import {useEffect,useState} from 'react';
import {apiFetch} from '../../lib/api/client';
import {usePermissions} from '../../hooks/usePermissions';
import {canYarn} from '../../lib/inventory/yarnPermissions';
type Row={item_id:string;item_name:string;internal_code:string;minimum_kg:string;available_kg:string;shortage_kg:string};
export function YarnShortagePanel({items,lots}:{items:Array<{id:string;name:string}>;lots:unknown[]}) {
 const {user}=usePermissions();const [rows,setRows]=useState<Row[]>([]),[item,setItem]=useState(''),[minimum,setMinimum]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{try{const r=await apiFetch<{data:Row[]}>('/api/inventory/yarn-lots/shortages');setRows(r.data);setError('');}catch(e){setError(String(e));}};
 useEffect(()=>{void load();},[lots]);
 const count=rows.filter(r=>Number(r.shortage_kg)>0).length;
 return <details className="rounded border bg-white p-4"><summary className="font-bold">الحد الأدنى وتقرير النقص {count>0&&<span role="status" className="text-rose-700"> — تنبيه: {count} أصناف دون الحد</span>}</summary><p className="text-sm">المتاح للشركة داخل المستودعات فقط؛ يستبعد ملك العملاء والمرسل للخارج والمحجوز. الحدود على مستوى الصنف لجميع المستودعات.</p>
 {canYarn(user,'profile')&&<fieldset disabled={busy} className="flex flex-wrap gap-2 py-2"><select aria-label="صنف الحد الأدنى" value={item} onChange={e=>{setItem(e.target.value);setMinimum(rows.find(r=>r.item_id===e.target.value)?.minimum_kg??'');}}><option value="">اختر الصنف</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select><input aria-label="الحد الأدنى كغ" type="number" min="0" max="999999999" step="0.001" value={minimum} onChange={e=>setMinimum(e.target.value)}/><button disabled={!item||minimum.trim()===''||!Number.isFinite(Number(minimum))||Number(minimum)<0} onClick={()=>{setBusy(true);void apiFetch(`/api/inventory/yarn-lots/minimum-stock/${item}`,{method:'PUT',body:JSON.stringify({minimumKg:Number(minimum)})}).then(load).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>حفظ الحد</button></fieldset>}
 <button onClick={()=>void load()}>تحديث التقرير</button><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>الصنف والكود</th><th>الحد كغ</th><th>المتاح كغ</th><th>النقص كغ</th></tr></thead><tbody>{rows.map(r=><tr key={r.item_id} className={Number(r.shortage_kg)>0?'bg-rose-50':''}><td>{r.item_name} — {r.internal_code}</td><td>{r.minimum_kg}</td><td>{r.available_kg}</td><td>{r.shortage_kg}</td></tr>)}</tbody></table></div>{error&&<p role="alert">{error}</p>}</details>;
}
