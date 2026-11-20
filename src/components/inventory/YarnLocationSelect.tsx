import {useEffect,useState} from 'react';
import {listLocations,type ApiWarehouseLocation} from '../../lib/api/warehousesApi';
export function YarnLocationSelect({warehouseId,value,onChange}:{warehouseId:string;value:string;onChange:(v:string)=>void}) {
 const [rows,setRows]=useState<ApiWarehouseLocation[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;setRows([]);setError('');if(warehouseId)void listLocations(warehouseId).then(r=>{if(active)setRows(r.filter(l=>l.is_active));}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[warehouseId]);
 return <div><select aria-label="موقع التخزين" className="w-full rounded border p-2" disabled={!warehouseId} value={value} onChange={e=>onChange(e.target.value)}><option value="">الموقع (اختياري)</option>{rows.map(l=><option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select>{error&&<p role="alert">{error}</p>}</div>;
}
