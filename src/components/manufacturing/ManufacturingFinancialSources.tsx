import { DateInput } from '../common/DateInput';
import {useEffect,useRef,useState} from 'react';
import {apiFetch} from '../../lib/api/client';
type Rate={id:string;machine_id:string;unit:string;kind:string;amount:string;currency_code:string;status:string;asset_reference:string|null};
type Basis='ELIGIBLE_EARNINGS'|'APPROVED_NET_SNAPSHOT';
type Asset={machine_id:string;code:string;name:string;asset_value:string|null;asset_currency_code:string|null;acquisition_date:string|null;ownership_type:string;owner_name:string|null;is_active:boolean;version:number};
type Payroll={id:string;full_name:string;payroll_no:string;currency_code:string;base_salary:string;allowances:string;deductions:string;net_salary:string;gross_earnings:string;allocated:string;cost_basis:Basis|null;eligible_amount:string|null};
type Sources={rates:Rate[];assets:Asset[];machines:{id:string;name:string}[];payroll:Payroll[]};
const base='/api/manufacturing/costing';
const inputClass='rounded border px-2 py-1';
function AssetDate({asset,busy,save}:{asset:Asset;busy:boolean;save:(a:Asset,date:string)=>Promise<void>}) {
 const [date,setDate]=useState(asset.acquisition_date?.slice(0,10)??'');
 useEffect(()=>setDate(asset.acquisition_date?.slice(0,10)??''),[asset.acquisition_date,asset.version]);
 return <div className="flex gap-2"><DateInput className={inputClass} aria-label={`تاريخ اقتناء ${asset.name}`} value={date} onChange={e=>setDate(e.target.value)}/><button disabled={busy||date===(asset.acquisition_date?.slice(0,10)??'')} onClick={()=>void save(asset,date)}>حفظ التاريخ</button></div>;
}
export function ManufacturingFinancialSources({order,refresh,frozen=false}:{order:string;refresh:()=>Promise<void>;frozen?:boolean}) {
 const [data,setData]=useState<Sources|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [machine,setMachine]=useState(''),[unit,setUnit]=useState('HOUR'),[kind,setKind]=useState('OVERHEAD'),[amount,setAmount]=useState(''),[currency,setCurrency]=useState('USD'),[asset,setAsset]=useState(''),[note,setNote]=useState(''),[source,setSource]=useState(''),[qty,setQty]=useState('');
 const [basis,setBasis]=useState<Basis|''>(''),[eligible,setEligible]=useState('');
 const pending=useRef<{key:string;id:string}|null>(null);
 const load=async()=>{const r=await apiFetch<{data:Sources}>(`${base}/financial-sources`);setData(r.data);};
 useEffect(()=>{let active=true;void apiFetch<{data:Sources}>(`${base}/financial-sources`).then(r=>{if(active)setData(r.data);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[order]);
 const post=async(action:string,body:Record<string,unknown>,request=false,path?:string)=>{
  setBusy(true);setError('');try{
   const key=JSON.stringify({order,action,body,path});if(request&&pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
   await apiFetch(path??`${base}/${order}/${action}`,{method:'POST',body:JSON.stringify({...body,...(request?{requestId:pending.current!.id}:{})})});pending.current=null;
   await load();await refresh();
  }catch(e){setError(String(e));}finally{setBusy(false);}
 };
 const rate=data?.rates.find(r=>r.id===source),pay=data?.payroll.find(p=>p.id===source);
 const chosenBasis=pay?.cost_basis??basis;
 const ceiling=pay?.eligible_amount!=null?Number(pay.eligible_amount):chosenBasis==='APPROVED_NET_SNAPSHOT'?Number(pay?.net_salary):Number(eligible);
 const remaining=ceiling-Number(pay?.allocated??0);
 const selectSource=(id:string)=>{setSource(id);setBasis('');setEligible('');setQty('');};
 return <div className="space-y-4">
 {error&&<p role="alert" className="text-rose-700">{error}</p>}
 <section className="space-y-2 rounded border p-3"><h3 className="font-bold">سجل الأصول التصنيعية</h3>
 <p className="text-sm">القيمة والعملة والملكية من بطاقة الماكينة مباشرة؛ تعديلها من مكتبة الماكينات. التاريخ غير المسجل يظهر كمجهول. لا إهلاك أو قيود محاسبية.</p>
 <div className="overflow-auto"><table className="w-full min-w-[850px] text-sm [&_td]:p-2 [&_th]:p-2"><thead><tr><th>الماكينة</th><th>القيمة</th><th>العملة</th><th>تاريخ الاقتناء</th><th>الملكية</th><th>الحالة</th></tr></thead><tbody>{data?.assets.map(a=><tr key={a.machine_id} className="border-t"><td>{a.code} — {a.name}</td><td>{a.asset_value??'غير مسجلة'}</td><td>{a.asset_currency_code??'غير مسجلة'}</td><td><AssetDate asset={a} busy={busy} save={(row,date)=>post('asset-date',{machineId:row.machine_id,version:row.version,acquisitionDate:date||null,notes:'تحديث تاريخ الاقتناء من سجل الأصول التصنيعية'},true,`${base}/asset-register/acquisition-date`)}/></td><td>{a.ownership_type==='COMPANY'?'ملك الشركة':`عهدة — ${a.owner_name??'مالك غير مسجل'}`}</td><td>{a.is_active?'نشطة':'غير نشطة'}</td></tr>)}</tbody></table></div>
 </section>
 <fieldset disabled={busy||frozen||!order} className="space-y-3 rounded border p-3"><legend>الأسعار الداخلية ومصادر التحميل</legend>
 <p>التحميل تحليلي ولا ينشئ قيداً أو إهلاكاً أو راتباً. الأسعار المعتمدة ثابتة؛ أنشئ تعريفاً جديداً لتغييرها.</p>
 <div className="flex flex-wrap gap-2">
 <select className={inputClass} aria-label="الماكينة" value={machine} onChange={e=>setMachine(e.target.value)}><option value="">الماكينة</option>{data?.machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
 <select className={inputClass} aria-label="وحدة السعر" value={unit} onChange={e=>setUnit(e.target.value)}>{['HOUR','METER','KG','UNIT'].map(u=><option key={u}>{u}</option>)}</select>
 <select className={inputClass} aria-label="نوع السعر" value={kind} onChange={e=>setKind(e.target.value)}><option value="OVERHEAD">مصروف صناعي</option><option value="ENERGY">طاقة</option></select>
 <input className={inputClass} aria-label="السعر الداخلي" type="number" step="0.0001" value={amount} onChange={e=>setAmount(e.target.value)}/>
 <select className={inputClass} aria-label="عملة السعر" value={currency} onChange={e=>setCurrency(e.target.value)}>{['USD','EGP','TRY','SYP'].map(c=><option key={c}>{c}</option>)}</select>
 <input className={inputClass} aria-label="مرجع مستند الأصل" placeholder="مرجع مستند الأصل (اختياري)" value={asset} onChange={e=>setAsset(e.target.value)}/>
 <input className={inputClass} aria-label="مستند اعتماد السعر أو مبرر أهلية الأجر" placeholder="المستند / مبرر أهلية مكونات الأجر" value={note} onChange={e=>setNote(e.target.value)}/>
 <button disabled={!machine||Number(amount)<=0||!note.trim()} onClick={()=>void post('internal-rates',{action:'CREATE',machineId:machine,unit,kind,amount:Number(amount),currencyCode:currency,assetReference:asset.trim()||undefined,notes:note},true)}>حفظ سعر غير معتمد</button>
 </div>
 {data?.rates.map(r=><div key={r.id}>{data.machines.find(m=>m.id===r.machine_id)?.name} — {r.amount} {r.currency_code}/{r.unit} — {r.asset_reference} — {r.status==='APPROVED'?'معتمد':'غير معتمد'} {r.status!=='APPROVED'&&<button onClick={()=>void post('internal-rates',{action:'APPROVE',rateId:r.id})}>اعتماد السعر</button>}</div>)}
 <select className={inputClass} aria-label="مصدر تحميل التكلفة" value={source} onChange={e=>selectSource(e.target.value)}><option value="">اختر المصدر</option>{data?.rates.filter(r=>r.status==='APPROVED').map(r=><option key={r.id} value={r.id}>{r.kind} — {r.amount} {r.currency_code}/{r.unit}</option>)}{data?.payroll.map(p=><option key={p.id} value={p.id}>{p.full_name} — {p.payroll_no} — {p.currency_code}</option>)}</select>
 {pay&&<div className="space-y-2 rounded bg-amber-50 p-3">
 <p>الأساسي {pay.base_salary} + الاستحقاقات {pay.allowances} = {pay.gross_earnings}؛ الاستقطاعات {pay.deductions}؛ الصافي {pay.net_salary} {pay.currency_code}. المحمّل سابقاً {pay.allocated}.</p>
 <p>الاستقطاعات قد تشمل مشتريات وسلفاً أو غياباً؛ لا تُخصم تلقائياً من تكلفة الإنتاج. حدّد المكونات المؤهلة ومبررها. إجماليات السطر تشمل البنود التفصيلية بالفعل ولا نضيفها مرة أخرى.</p>
 <select className={inputClass} aria-label="أساس تحميل الأجر" disabled={!!pay.cost_basis} value={chosenBasis} onChange={e=>setBasis(e.target.value as Basis)}><option value="">اختر الأساس صراحةً</option><option value="ELIGIBLE_EARNINGS">مكونات الأجر المؤهلة قبل صافي الدفع</option><option value="APPROVED_NET_SNAPSHOT">لقطة صافي المسير المعتمد</option></select>
 {chosenBasis==='ELIGIBLE_EARNINGS'&&<input className={inputClass} aria-label="سقف الأجر المؤهل لجميع الأوامر" type="number" min="0" step="0.0001" disabled={pay.eligible_amount!=null} value={pay.eligible_amount??eligible} onChange={e=>setEligible(e.target.value)} placeholder="سقف المكونات المؤهلة لجميع أوامر الإنتاج"/>}
 {chosenBasis==='APPROVED_NET_SNAPSHOT'&&<p>هذا اختيار صريح للصافي فقط، متضمناً أثر الاستقطاعات؛ لا يمثل بالضرورة تكلفة الأجر الكاملة. القيد الحالي يستخدم الصافي ولا نغيّره.</p>}
 {chosenBasis&&<p>سقف المصدر {ceiling||0}؛ المتاح للتوزيع {remaining||0} {pay.currency_code}. يثبت الأساس والسقف عند أول تحميل لهذا السطر.</p>}
 </div>}
 <div className="flex flex-wrap gap-2"><input className={inputClass} aria-label="كمية السعر أو مبلغ توزيع الراتب" type="number" step="0.0001" value={qty} onChange={e=>setQty(e.target.value)}/>
 <button disabled={!source||Number(qty)<=0||!note.trim()||!!pay&&(!chosenBasis||!Number.isFinite(ceiling)||ceiling<=0||Number(qty)>remaining)} onClick={()=>void post('charges',rate?{kind:rate.kind,internalRateId:rate.id,allocationQuantity:Number(qty),amount:Math.round(Number(rate.amount)*Number(qty)*10000)/10000,currencyCode:rate.currency_code,notes:note}:{kind:'LABOR',payrollLineId:pay?.id,payrollBasis:chosenBasis,payrollEligibleAmount:chosenBasis==='ELIGIBLE_EARNINGS'?ceiling:undefined,amount:Number(qty),currencyCode:pay?.currency_code,notes:note},true)}>حفظ تحميل غير معتمد</button></div>
 </fieldset></div>;
}
