import type {YarnProperties} from '../../lib/api/yarnLotsApi';
export function YarnPropertiesEditor({value,onChange}:{value:YarnProperties;onChange:(v:YarnProperties)=>void}) {
 const blend=value.blend??[];
 return <fieldset className="space-y-2 rounded border p-2"><legend>مواصفات اللوط (اختياري؛ الفراغ يستخدم تصنيف الصنف)</legend>
 {(['fiber','spinningType','count'] as const).map((key,i)=><input key={key} aria-label={['الألياف','طريقة الغزل','النمرة'][i]} placeholder={['الألياف','طريقة الغزل','النمرة'][i]} className="w-full rounded border p-2" value={value[key]??''} maxLength={key==='count'?50:100} onChange={e=>onChange({...value,[key]:e.target.value||undefined})}/>)}
 <select aria-label="نظام النمرة" value={value.countSystem??''} onChange={e=>onChange({...value,countSystem:(e.target.value||undefined) as YarnProperties['countSystem']})}><option value="">نظام النمرة</option>{['Ne','Nm','Denier','Tex'].map(s=><option key={s}>{s}</option>)}</select>
 {blend.map((row,index)=><div className="flex gap-1" key={index}><input aria-label="مكون الخليط" className="min-w-0 w-full border" value={row.fiber} onChange={e=>onChange({...value,blend:blend.map((b,i)=>i===index?{...b,fiber:e.target.value}:b)})}/><input aria-label="نسبة المكون" className="w-20 border" type="number" min="0.001" max="100" step="0.001" value={row.percent} onChange={e=>onChange({...value,blend:blend.map((b,i)=>i===index?{...b,percent:Number(e.target.value)}:b)})}/><button type="button" onClick={()=>onChange({...value,blend:blend.filter((_,i)=>i!==index)})}>×</button></div>)}
 <button type="button" disabled={blend.length>=20} onClick={()=>onChange({...value,blend:[...blend,{fiber:'',percent:0}]})}>إضافة مكون خليط</button>{blend.length>0&&<p role="status">مجموع النسب: {blend.reduce((n,b)=>n+b.percent,0)}% (المطلوب 100%)</p>}
 </fieldset>;
}
