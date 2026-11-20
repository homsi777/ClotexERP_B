import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api/client';
type Option = {
    id: string;
    work_order_no?: string;
    job_no?: string;
    name?: string;
    barcode?: string;
    weight_kg?: string;
    stage?: 'WEAVING' | 'SIZING';
    work_order_id?: string;
    status?: string;
};
type Entry = {
    id: string;
    kind: string;
    yarn_lot_id: string;
    weaving_run_id: string | null;
    sizing_order_id: string | null;
    weight_kg: string;
    waste_kg: string;
    unit_cost?: string | null;
    currency_code?: string;
    notes: string;
};
type Report = {
    materialBalances?:Array<{id:string;basis:string;issuedKg:number;returnedKg:number;consumedKg:number|null;wasteKg:number;custodyKg:number|null}>;
    work: {
        work_order_no: string;
        status: string;
    };
    materials: Entry[];
    warp?: Array<{
        id: string;
        issued_weight_kg: string;
        returned_weight_kg: string;
        waste_weight_kg: string;
        issued_unit_cost: string | null;
    }>;
    charges?: Array<{
        id: string;
        kind: string;
        amount: string;
        currency_code: string;
        notes: string;
    }>;
    external: Array<{
        id: string;
        job_no: string;
        lifecycle_closed_at: string | null;
    }>;
    rolls: Array<{
        id: string;
        roll_no: string;
        barcode: string;
        length_m: string;
        status: string;
    }>;
    unrated?: number;
    totalUsd?: number;
    unitCostUsd?: number | null;
    acceptedLengthM?: number;
    breakdown?: Record<string, number>;
    closure?: {
        total_usd: string;
        unit_cost_usd: string;
    } | null;
};
type Options = {
    orders: Option[];
    lots: Option[];
    stages: Option[];
    jobs: Option[];
    canPrice: boolean;
    canViewCost?: boolean;
    canPost: boolean;
};
const base = '/api/manufacturing/costing';
const css = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50';
const fetchData = <T,>(path: string) => apiFetch<{
    ok: true;
    data: T;
}>(`${base}${path}`).then(r => r.data);
const n = (value: unknown) => Number(value ?? 0).toLocaleString('ar', { maximumFractionDigits: 4 });
export function ManufacturingCostPanel() {
    const [options, setOptions] = useState<Options | null>(null), [order, setOrder] = useState(''), [report, setReport] = useState<Report | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [stage, setStage] = useState(''), [lot, setLot] = useState(''), [kind, setKind] = useState<'ISSUE' | 'RETURN'>('ISSUE'), [source, setSource] = useState(''), [kg, setKg] = useState(''), [note, setNote] = useState('');
    const [chargeKind, setChargeKind] = useState('LABOR'), [amount, setAmount] = useState(''), [currency, setCurrency] = useState('USD'), [chargeNote, setChargeNote] = useState(''), [job, setJob] = useState('');
    const [consumptionSource,setConsumptionSource]=useState(''),[consumed,setConsumed]=useState(''),[consumptionWaste,setConsumptionWaste]=useState('0'),[consumptionNote,setConsumptionNote]=useState(''),[chargeReference,setChargeReference]=useState('');
    const pending = useRef<{
        key: string;
        id: string;
    } | null>(null);
    const loadVersion = useRef(0);
    const load = useCallback(async () => { const version = ++loadVersion.current; const [o, r] = await Promise.all([fetchData<Options>('/options'), order ? fetchData<Report>(`/${order}`) : Promise.resolve(null)]); if (version !== loadVersion.current)
        return; setOptions(o); setReport(r); }, [order]);
    useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'تعذر التحميل')); }, [load]);
    const post = async (action: string, body: object, request = false) => {
        if (!order)
            return;
        setBusy(true);
        setError('');
        try {
            const key = JSON.stringify({ order, action, body });
            if (request && pending.current?.key !== key)
                pending.current = { key, id: crypto.randomUUID() };
            await apiFetch(`${base}/${order}/${action}`, { method: 'POST', body: JSON.stringify(request ? { ...body, requestId: pending.current!.id } : body) });
            await load();
            pending.current = null;
            if (action === 'materials') {
                setKg('');
                setNote('');
                setSource('');
            }
            if (action === 'charges') {
                setAmount('');
                setChargeNote('');
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'تعذر التنفيذ');
        }
        finally {
            setBusy(false);
        }
    };
    const price = async (type: 'WARP' | 'MATERIAL', id: string) => {
        const cost = prompt('سعر الكيلو المتفق عليه');
        if (cost === null || cost.trim() === '' || !Number.isFinite(Number(cost)) || Number(cost) < 0)
            return;
        const code = prompt('العملة: USD / EGP / TRY / SYP', 'USD');
        if (!code)
            return;
        const reason = prompt('سبب تسجيل أو تصحيح السعر');
        if (!reason?.trim())
            return;
        await post('price-material', { source: type, entryId: id, unitCost: Number(cost), currencyCode: code.toUpperCase(), notes: reason });
    };
    const selectedStage = options?.stages.find(s => s.id === stage), selectedSource = report?.materials.find(e => e.id === source);
    const exportReport = () => {
        if (!report)
            return;
        const rows: unknown[][] = [['أمر الإنتاج', report.work.work_order_no], ['حالة التكلفة', report.closure ? 'معتمدة' : 'تحت المراجعة'], ['بنود غير مسعرة', report.unrated ?? ''], ['الإجمالي USD', report.totalUsd ?? ''], ['الناتج م', report.acceptedLengthM ?? ''], ['تكلفة المتر USD', report.unitCostUsd ?? ''], [], ['نوع الحركة', 'المرحلة', 'الوزن كغ', 'الهالك كغ', 'السعر', 'العملة', 'الملاحظات'], ...report.materials.map(m => [m.kind, m.weaving_run_id ? 'WEAVING' : 'SIZING', m.weight_kg, m.waste_kg, m.unit_cost ?? '', m.currency_code ?? '', m.notes]), [], ['البند', 'المبلغ', 'العملة', 'الملاحظات'], ...(report.charges ?? []).map(c => [c.kind, c.amount, c.currency_code, c.notes]), [], ['المصنعية', 'الحالة'], ...report.external.map(j => [j.job_no, j.lifecycle_closed_at ? 'مغلقة' : 'قيد التنفيذ']), [], ['الرول', 'الباركود', 'الطول م', 'الحالة'], ...report.rolls.map(r => [r.roll_no, r.barcode, r.length_m, r.status])];
        const csv = '\ufeff' + rows.map(row => row.map(v => { let s = String(v ?? ''); if (/^[=+@-]/.test(s))
            s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `manufacturing-${report.work.work_order_no.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const frozen = Boolean(report?.closure);
    return <div className="space-y-4 p-4" dir="rtl">
  <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-bold">مواد الإنتاج والتكاليف والمصنعية الخارجية</h2><select aria-label="أمر الإنتاج" className={css} disabled={busy} value={order} onChange={e => { loadVersion.current++; setOrder(e.target.value); setStage(''); setSource(''); setReport(null); }}><option value="">اختر أمر الإنتاج</option>{options?.orders.map(o => <option key={o.id} value={o.id}>{o.work_order_no} — {o.status}</option>)}</select><button className={css} disabled={busy} onClick={() => void load().catch(e => setError(String(e)))}>تحديث</button></div>
  {error && <div role="alert" className="rounded bg-rose-50 p-3 text-rose-700">{error}</div>}
  {report && <>
   <button className={css} onClick={exportReport}>تصدير كشف المواد والتكاليف والرولات</button>
   <p className="text-sm text-slate-600">الصرف الجديد ينتقل إلى عهدة الإنتاج، ثم يسجل المستهلك والهالك والمرتجع بشكل منفصل. القيود القديمة تحتفظ بأساس تكلفتها السابق. تحميل الأجور يحتاج مرجعاً فريداً ولا ينشئ دفع رواتب.</p>
   {report.materialBalances?.length&&<div className="overflow-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr><th>سند الصرف</th><th>مصروف كغ</th><th>مستهلك</th><th>راجع</th><th>هالك</th><th>بالعهدة</th></tr></thead><tbody>{report.materialBalances.map(b=><tr key={b.id} className="border-t"><td className="p-2 font-mono">{b.id.slice(0,8)}</td><td>{b.issuedKg}</td><td>{b.consumedKg??'أساس سابق'}</td><td>{b.returnedKg}</td><td>{b.wasteKg}</td><td>{b.custodyKg??'غير مفصول سابقاً'}</td></tr>)}</tbody></table></div>}
   {options?.canPrice&&!frozen&&<fieldset disabled={busy} className="flex flex-wrap gap-2 rounded-xl border p-4"><legend>اعتماد الاستهلاك الفعلي والهالك</legend><select aria-label="سند عهدة الاستهلاك" className={css} value={consumptionSource} onChange={e=>setConsumptionSource(e.target.value)}><option value="">اختر سند صرف بعهدة الإنتاج</option>{report.materialBalances?.filter(b=>b.basis==='RECORDED'&&(b.custodyKg??0)>0).map(b=><option key={b.id} value={b.id}>{b.id.slice(0,8)} — {b.custodyKg} كغ</option>)}</select><input aria-label="المستهلك الفعلي كغ" type="number" min="0" step="0.001" className={css} value={consumed} onChange={e=>setConsumed(e.target.value)} placeholder="المستهلك كغ"/><input aria-label="الهالك الفعلي كغ" type="number" min="0" step="0.001" className={css} value={consumptionWaste} onChange={e=>setConsumptionWaste(e.target.value)}/><input aria-label="سبب اعتماد الاستهلاك" className={css} value={consumptionNote} onChange={e=>setConsumptionNote(e.target.value)} placeholder="سبب الاعتماد"/><button className={button} disabled={!consumptionSource||!consumptionNote.trim()||Number(consumed)+Number(consumptionWaste)<=0} onClick={()=>void post('consumption',{sourceEntryId:consumptionSource,consumedKg:Number(consumed),wasteKg:Number(consumptionWaste),notes:consumptionNote},true)}>اعتماد</button></fieldset>}
   {options?.canPost && !frozen && report.work.status === 'IN_PROGRESS' && <fieldset disabled={busy} className="grid gap-3 rounded-xl border p-4 md:grid-cols-4"><legend className="font-bold">استهلاك اللحمة ومواد التصميغ</legend>
    <select className={css} aria-label="نوع الحركة" value={kind} onChange={e => { setKind(e.target.value as 'ISSUE' | 'RETURN'); setSource(''); }}><option value="ISSUE">صرف واستهلاك</option><option value="RETURN">مرتجع من الصرف</option></select>
    {kind === 'ISSUE' ? <><select aria-label="مرحلة الإنتاج" className={css} value={stage} onChange={e => setStage(e.target.value)}><option value="">مرحلة الإنتاج</option>{options.stages.filter(s => s.work_order_id === order && ['DRAFT', 'IN_PROGRESS', 'PAUSED'].includes(s.status ?? '')).map(s => <option key={s.id} value={s.id}>{s.stage === 'WEAVING' ? 'لحمة' : 'تصميغ'} — {s.name}</option>)}</select><select aria-label="لوط المادة" className={css} value={lot} onChange={e => setLot(e.target.value)}><option value="">لوط المادة</option>{options.lots.map(l => <option key={l.id} value={l.id}>{l.name} — {l.barcode} — {n(l.weight_kg)} كغ</option>)}</select></> : <select aria-label="الصرف الأصلي" className={css} value={source} onChange={e => setSource(e.target.value)}><option value="">الصرف الأصلي</option>{report.materials.filter(m => m.kind === 'ISSUE').map(m => <option key={m.id} value={m.id}>{m.id.slice(0, 8)} — {n(m.weight_kg)} كغ — {m.notes}</option>)}</select>}
    <input aria-label="الوزن" className={css} type="number" min="0.001" step="0.001" placeholder="الوزن كغ" value={kg} onChange={e => setKg(e.target.value)}/>

    <input aria-label="ملاحظات الحركة" className={css} placeholder="ملاحظات الحركة" value={note} onChange={e => setNote(e.target.value)}/>
    <button className={button} disabled={!note.trim() || Number(kg) <= 0 || (kind === 'ISSUE' ? (!stage || !lot) : !source)} onClick={() => { const s = kind === 'ISSUE' ? selectedStage : { id: selectedSource?.weaving_run_id ?? selectedSource?.sizing_order_id, stage: selectedSource?.weaving_run_id ? 'WEAVING' : 'SIZING' }; void post('materials', { stage: s?.stage, stageId: s?.id, kind, lotId: kind === 'ISSUE' ? lot : selectedSource?.yarn_lot_id, ...(kind === 'RETURN' ? { sourceEntryId: source } : {consumptionBasis:'RECORDED'}), weightKg: Number(kg), wasteKg: 0, notes: note }, true); }}>تسجيل الحركة</button>
   </fieldset>}
   <div className="overflow-x-auto"><table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead><tr className="border-b text-right"><th>الحركة</th><th>المرحلة</th><th>الوزن كغ</th><th>الهالك كغ</th><th>السعر</th><th>الملاحظات</th><th>إجراء</th></tr></thead><tbody>{report.materials.map(m => <tr key={m.id} className="border-b"><td className="py-2">{m.kind === 'ISSUE' ? 'صرف' : 'مرتجع'}</td><td>{m.weaving_run_id ? 'لحمة' : 'مواد تصميغ'}</td><td>{n(m.weight_kg)}</td><td>{n(m.waste_kg)}</td><td>{m.unit_cost === undefined ? '—' : m.unit_cost === null ? 'غير مسعر' : `${n(m.unit_cost)} ${m.currency_code}`}</td><td>{m.notes}</td><td>{options?.canPrice && !frozen && m.kind === 'ISSUE' && <button className={css} disabled={busy} onClick={() => void price('MATERIAL', m.id)}>تسعير</button>}</td></tr>)}</tbody></table></div>
   {(options?.canViewCost || options?.canPrice) && <>
    <div className="grid gap-3 md:grid-cols-4">{[['المواد السداء', report.breakdown?.warpUsd], ['اللحمة والتصميغ', report.breakdown?.materialUsd], ['الأجور والمصاريف', report.breakdown?.chargeUsd], ['المصنعية الخارجية', report.breakdown?.externalUsd]].map(([label, value]) => <div key={String(label)} className="rounded-xl border p-3"><div className="text-sm text-slate-500">{label}</div><strong>{n(value)} USD</strong></div>)}</div>
    <div className="rounded-xl bg-slate-50 p-4"><strong>{frozen ? 'تكلفة معتمدة' : 'تكلفة تحت المراجعة'}: {n(report.totalUsd)} USD</strong><span className="mx-4">الناتج النهائي: {n(report.acceptedLengthM)} م — تكلفة المتر: {n(report.unitCostUsd)} USD</span>{Boolean(report.unrated) && <p className="text-rose-700">يوجد {report.unrated} بند غير مسعر. الإجمالي جزئي ولا يمكن اعتماده.</p>}</div>
    {report.warp?.map(w => <div className="flex gap-3 text-sm" key={w.id}><span>سداء: مصروف {n(w.issued_weight_kg)}، مرتجع {n(w.returned_weight_kg)}، هالك {n(w.waste_weight_kg)} كغ — {w.issued_unit_cost === null ? 'غير مسعر' : n(w.issued_unit_cost)}</span>{options?.canPrice && !frozen && <button className={css} disabled={busy} onClick={() => void price('WARP', w.id)}>تسعير السداء</button>}</div>)}
    {options?.canPrice && !frozen && <fieldset disabled={busy} className="flex flex-wrap gap-2 rounded-xl border p-4"><legend className="font-bold">تحميل الأجور والمصاريف أو تسوية موثقة</legend><select className={css} value={chargeKind} onChange={e => setChargeKind(e.target.value)}><option value="LABOR">أجور</option><option value="ENERGY">طاقة</option><option value="OVERHEAD">مصاريف صناعية</option><option value="ADJUSTMENT">تسوية بالزيادة أو النقص</option></select><input aria-label="مبلغ التكلفة" className={css} type="number" step="0.0001" placeholder="المبلغ" value={amount} onChange={e => setAmount(e.target.value)}/><select className={css} value={currency} onChange={e => setCurrency(e.target.value)}>{['USD', 'EGP', 'TRY', 'SYP'].map(c => <option key={c}>{c}</option>)}</select><input aria-label="سبب تحميل التكلفة" className={css} placeholder="السبب / المرجع لمنع تكرار التحميل" value={chargeNote} onChange={e => setChargeNote(e.target.value)}/><input aria-label="Cost source reference" className={css} value={chargeReference} onChange={e=>setChargeReference(e.target.value)} placeholder="Payroll/cost source reference"/><button className={button} disabled={!Number(amount) || !chargeNote.trim() || (chargeKind==='LABOR'&&!chargeReference.trim())} onClick={() => void post('charges', { kind: chargeKind, amount: Number(amount), currencyCode: currency, notes: chargeNote,sourceReference:chargeReference.trim()||undefined }, true)}>إضافة</button></fieldset>}
    <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><tbody>{report.charges?.map(c => <tr key={c.id} className="border-b"><td className="py-2">{c.kind}</td><td>{n(c.amount)} {c.currency_code}</td><td>{c.notes}</td></tr>)}</tbody></table>
    {options?.canPrice && !frozen && <div className="flex flex-wrap gap-2"><select aria-label="المصنعية الخارجية" className={css} value={job} onChange={e => setJob(e.target.value)}><option value="">ربط مهمة مصنعية موجودة</option>{options.jobs.map(j => <option key={j.id} value={j.id}>{j.job_no}</option>)}</select><button className={button} disabled={busy || !job} onClick={() => void post('external-link', { jobId: job })}>ربط والتحقق من مصدر الرولات</button></div>}
    <p className="text-sm text-slate-500">إنشاء وإرسال واستلام وفحص وتسعير المصنعية يتم من شاشة المهام الخارجية الحالية. الربط هنا يحفظ تتبع الرولات ويضم أجرة المهمة مرة واحدة إلى تكلفة أمر الإنتاج.</p>
    {report.external.map(j => <div key={j.id} className="rounded border p-2">{j.job_no} — {j.lifecycle_closed_at ? 'مغلقة' : 'قيد التنفيذ'} <a className="text-indigo-600 underline" href="/purchases/external-jobs">فتح المهام الخارجية</a></div>)}
    {options?.canPrice && !frozen && <button className={button} disabled={busy || Boolean(report.unrated) || report.work.status !== 'COMPLETED'} onClick={() => { if (confirm('اعتماد تكلفة الإنتاج وتوزيعها على الرولات النهائية المتاحة؟ لا يمكن تعديل التكاليف بعد الاعتماد.'))
                void post('finalize', {}); }}>اعتماد التكلفة وتحديث تكلفة الرولات</button>}
   </>}
   <h3 className="font-bold">الرولات النهائية وتتبع الناتج</h3><table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><tbody>{report.rolls.map(r => <tr key={r.id} className="border-b"><td className="py-2">{r.roll_no}</td><td>{r.barcode}</td><td>{n(r.length_m)} م</td><td>{r.status}</td></tr>)}</tbody></table>
  </>}
 </div>;
}
