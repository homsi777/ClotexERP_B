import {useCallback,useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';
import {Link} from 'react-router-dom';
import {AlertTriangle,FileSpreadsheet,Loader2,MessageCircle,Printer,RefreshCw,Send,X,ClipboardList,FileText} from 'lucide-react';
import {DateInput} from '../components/common/DateInput';
import {addPartyNote,getPartyBalances,listPartyNotes,savePartyProfile,type BalanceKind,type CurrencyBalance,type PartyBalanceRow,type PartyBalancesResult,type PartyNote} from '../lib/api/partyBalancesApi';
import {fetchChatPeers,type ChatPeer} from '../lib/api/chatApi';
import {getCustomerStatementByCurrency,getSupplierStatementByCurrency} from '../lib/api/partyStatementsApi';
import {sendTelegramDocument} from '../lib/api/telegramApi';

const nf=(n:number)=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const T={
  customers:{title:'أرصدة العملاء',sub:'الرصيد الحقيقي المطابق لكشف الحساب، لكل عملة على حدة. العميل: مدين = عليه، دائن = له.',owes:'عليه',owed:'له',total1:'إجمالي المدين (على العملاء)',total2:'إجمالي الدائن (للعملاء)',statement:'/customers/statement?customerId=',sales:'مبيعات 12 شهراً',party:'العميل',pay:'آخر دفعة منه',promise:'موعد التحصيل',promised:'المبلغ الموعود بتحصيله'},
  suppliers:{title:'أرصدة الموردين',sub:'الرصيد الحقيقي المطابق لكشف الحساب، لكل عملة على حدة. المورد: دائن = علينا له، مدين = لنا عنده.',owes:'علينا له',owed:'لنا عنده',total1:'إجمالي المستحق للموردين',total2:'إجمالي المدفوع زيادة (لنا)',statement:'/suppliers/statement?supplierId=',sales:'مشتريات 12 شهراً',party:'المورد',pay:'آخر دفعة له',promise:'موعد السداد',promised:'المبلغ الموعود بسداده'},
} as const;

function Stack({row,pick,cls=''}:{row:PartyBalanceRow;pick:(c:CurrencyBalance)=>React.ReactNode;cls?:string}){
  if(!row.currencies.length)return <span className="text-slate-300">—</span>;
  return <div className="flex flex-col gap-0.5" dir="ltr">{row.currencies.map(c=><span key={c.currency} className={`font-mono text-xs ${cls}`}>{pick(c)}</span>)}</div>;
}

export function PartyBalancesPage({kind}:{kind:BalanceKind}){
  const L=T[kind];
  const [data,setData]=useState<PartyBalancesResult|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [search,setSearch]=useState(''),[currency,setCurrency]=useState(''),[onlyBal,setOnlyBal]=useState(true),[onlyAlerts,setOnlyAlerts]=useState(false);
  const [sort,setSort]=useState<'name'|'balance'|'lastPayment'|'lastOperation'>('balance'),[dir,setDir]=useState<'asc'|'desc'>('desc');
  const [follow,setFollow]=useState<PartyBalanceRow|null>(null),[share,setShare]=useState<PartyBalanceRow|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{setData(await getPartyBalances(kind,{search:search.trim()||undefined,currency:currency||undefined,onlyWithBalance:onlyBal,onlyAlerts,sort,dir}));}
    catch(e){setError(e instanceof Error?e.message:'تعذر تحميل الأرصدة');}
    finally{setLoading(false);}
  },[kind,search,currency,onlyBal,onlyAlerts,sort,dir]);
  useEffect(()=>{const h=setTimeout(()=>void load(),250);return ()=>clearTimeout(h);},[load]);

  const currencies=useMemo(()=>[...new Set((data?.rows??[]).flatMap(r=>r.currencies.map(c=>c.currency)))].sort(),[data]);
  const rows=data?.rows??[];
  const sideLabel=(c:CurrencyBalance)=>c.side==='ZERO'?'':c.side==='OWES_US'?(kind==='customers'?L.owes:L.owed):(kind==='customers'?L.owed:L.owes);

  const exportExcel=()=>{
    const aoa:unknown[][]=[[L.party,'الكود','الهاتف','العملة','الرصيد','الجهة','شيكات قيد التحصيل','الرصيد المتوقع','0-30','31-60','61-90','+90','غير مخصص',L.sales,'آخر عملية','آخر دفعة','حد الائتمان','المسؤول',L.promise,L.promised]];
    for(const r of rows)for(const c of r.currencies){
      if(currency&&c.currency!==currency)continue;
      aoa.push([r.name,r.code??'',r.phone??'',c.currency,c.balance,sideLabel(c),c.pendingCheques,c.expectedBalance,c.aging.d0_30,c.aging.d31_60,c.aging.d61_90,c.aging.d90plus,c.aging.unallocated,c.sales12m,c.lastOperationDate??'',c.lastPaymentDate??'',c.creditLimit??'',r.profile?.ownerName??'',r.profile?.expectedCollectionDate??'',r.profile?.promisedAmount??'']);
    }
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),L.title.slice(0,30));
    XLSX.writeFile(wb,`${kind}-balances-${new Date().toISOString().slice(0,10)}.xlsx`);
  };
  const print=()=>{
    const w=window.open('','_blank','width=1100,height=800');if(!w)return;
    const esc=(v:unknown)=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
    const body=rows.flatMap(r=>r.currencies.filter(c=>!currency||c.currency===currency).map(c=>`<tr><td>${esc(r.name)}</td><td>${esc(r.code)}</td><td dir="ltr">${esc(c.currency)}</td><td dir="ltr">${nf(c.balance)}</td><td>${esc(sideLabel(c))}</td><td dir="ltr">${nf(c.pendingCheques)}</td><td dir="ltr">${nf(c.expectedBalance)}</td><td dir="ltr">${nf(c.aging.d0_30)}</td><td dir="ltr">${nf(c.aging.d31_60)}</td><td dir="ltr">${nf(c.aging.d61_90)}</td><td dir="ltr">${nf(c.aging.d90plus)}</td><td>${esc(c.lastPaymentDate??'')}</td></tr>`)).join('');
    const tot=(data?.totals??[]).map(t=>`<p dir="ltr"><b>${esc(t.currency)}</b> — ${esc(L.total1)}: ${nf(t.owedToUs)} · ${esc(L.total2)}: ${nf(t.weOwe)}</p>`).join('');
    w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(L.title)}</title><style>body{font:12px Tahoma,Arial}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:4px;text-align:right}@page{size:A4 landscape;margin:10mm}</style></head><body><h2>${esc(L.title)} — ${new Date().toLocaleDateString('en-GB')}</h2>${tot}<table><thead><tr><th>${esc(L.party)}</th><th>الكود</th><th>العملة</th><th>الرصيد</th><th>الجهة</th><th>شيكات معلّقة</th><th>المتوقع</th><th>0-30</th><th>31-60</th><th>61-90</th><th>+90</th><th>آخر دفعة</th></tr></thead><tbody>${body}</tbody></table><p>${esc(data?.note??'')}</p></body></html>`);
    w.document.close();w.focus();setTimeout(()=>w.print(),300);
  };

  return <div className="space-y-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-950">{L.title}</h1><p className="text-sm text-slate-500">{L.sub}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={()=>void load()} className="inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-sm font-bold"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>تحديث</button>
        <button type="button" onClick={exportExcel} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-sm font-bold disabled:opacity-40"><FileSpreadsheet className="h-4 w-4"/>Excel</button>
        <button type="button" onClick={print} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-sm font-bold disabled:opacity-40"><Printer className="h-4 w-4"/>طباعة</button>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`بحث بالاسم أو الكود أو الهاتف…`} className="min-w-[220px] flex-1 rounded-lg border p-2 text-sm"/>
      <select value={currency} onChange={e=>setCurrency(e.target.value)} className="rounded-lg border p-2 text-sm" aria-label="العملة"><option value="">كل العملات</option>{currencies.map(c=><option key={c} value={c}>{c}</option>)}</select>
      <select value={sort} onChange={e=>setSort(e.target.value as typeof sort)} className="rounded-lg border p-2 text-sm" aria-label="فرز"><option value="balance">فرز: الأكبر رصيداً</option><option value="name">فرز: الاسم</option><option value="lastPayment">فرز: آخر دفعة</option><option value="lastOperation">فرز: آخر عملية</option></select>
      <button type="button" onClick={()=>setDir(d=>d==='asc'?'desc':'asc')} className="rounded-lg border px-3 py-2 text-sm">{dir==='asc'?'تصاعدي ↑':'تنازلي ↓'}</button>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyBal} onChange={e=>setOnlyBal(e.target.checked)}/>من عليه رصيد فقط</label>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyAlerts} onChange={e=>setOnlyAlerts(e.target.checked)}/>التنبيهات فقط</label>
    </div>

    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}

    {data&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.totals.map(t=><div key={t.currency} className="rounded-xl border bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-center justify-between"><b className="font-mono" dir="ltr">{t.currency}</b><span className="text-xs text-slate-500">{t.parties} {L.party}</span></div>
      <div className="flex justify-between text-sm"><span className="text-slate-600">{L.total1}</span><b className="font-mono text-rose-700" dir="ltr">{nf(t.owedToUs)}</b></div>
      <div className="flex justify-between text-sm"><span className="text-slate-600">{L.total2}</span><b className="font-mono text-emerald-700" dir="ltr">{nf(t.weOwe)}</b></div>
      {kind==='customers'&&t.pendingCheques>0&&<div className="flex justify-between text-xs text-amber-800"><span>شيكات قيد التحصيل</span><b className="font-mono" dir="ltr">{nf(t.pendingCheques)}</b></div>}
    </div>)}{!data.totals.length&&<p className="text-sm text-slate-500">لا أرصدة مطابقة.</p>}</div>}

    {data&&<p className="flex items-start gap-2 rounded-lg bg-sky-50 p-2.5 text-xs text-sky-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>{data.note}</p>}

    {loading&&!data?<div className="p-8 text-center text-slate-500"><Loader2 className="inline h-5 w-5 animate-spin"/></div>:
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[1200px] text-right text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr>
      <th className="p-2">{L.party}</th><th className="p-2">الرصيد</th>{kind==='customers'&&<><th className="p-2">شيكات معلّقة</th><th className="p-2">المتوقع</th></>}
      <th className="p-2">0-30</th><th className="p-2">31-60</th><th className="p-2">61-90</th><th className="p-2">+90</th><th className="p-2">غير مخصص</th><th className="p-2">{L.sales}</th>
      <th className="p-2">آخر عملية</th><th className="p-2">{L.pay}</th><th className="p-2">المسؤول</th><th className="p-2">{L.promise}</th><th className="p-2">تنبيه</th><th className="p-2"/></tr></thead><tbody>
      {rows.map(r=><tr key={r.id} className="border-t align-top hover:bg-slate-50">
        <td className="p-2"><div className="font-bold">{r.name}</div><div className="font-mono text-xs text-slate-400" dir="ltr">{r.code}</div></td>
        <td className="p-2"><div className="flex flex-col gap-0.5" dir="ltr">{r.currencies.map(c=><span key={c.currency} className={`font-mono text-xs font-bold ${c.side==='OWES_US'?(kind==='customers'?'text-rose-700':'text-rose-700'):c.side==='WE_OWE'?'text-emerald-700':'text-slate-400'}`}>{nf(c.balance)} {c.currency} <span className="font-sans font-normal text-slate-500">{sideLabel(c)}</span></span>)}</div></td>
        {kind==='customers'&&<><td className="p-2"><Stack row={r} pick={c=>c.pendingCheques>0?nf(c.pendingCheques):'—'} cls="text-amber-800"/></td><td className="p-2"><Stack row={r} pick={c=>nf(c.expectedBalance)}/></td></>}
        <td className="p-2"><Stack row={r} pick={c=>nf(c.aging.d0_30)}/></td><td className="p-2"><Stack row={r} pick={c=>nf(c.aging.d31_60)}/></td>
        <td className="p-2"><Stack row={r} pick={c=>nf(c.aging.d61_90)}/></td><td className="p-2"><Stack row={r} pick={c=>nf(c.aging.d90plus)} cls="text-rose-700"/></td>
        <td className="p-2"><Stack row={r} pick={c=>nf(c.aging.unallocated)} cls="text-slate-500"/></td>
        <td className="p-2"><Stack row={r} pick={c=>c.sales12m>0?`${nf(c.sales12m)}`:'—'}/></td>
        <td className="p-2 whitespace-nowrap text-xs">{r.lastOperationDate??'—'}</td><td className="p-2 whitespace-nowrap text-xs">{r.lastPaymentDate??'—'}</td>
        <td className="p-2 text-xs">{r.profile?.ownerName??'—'}</td>
        <td className="p-2 text-xs"><div>{r.profile?.expectedCollectionDate??'—'}</div>{r.profile?.promisedAmount!=null&&<div className="font-mono text-slate-500" dir="ltr">{nf(r.profile.promisedAmount)} {r.profile.promisedCurrency}</div>}</td>
        <td className="p-2"><div className="flex flex-col gap-1 text-[11px] font-bold">{r.alerts.promiseOverdue&&<span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">تجاوز موعد {kind==='customers'?'التحصيل':'السداد'}</span>}{r.alerts.limitExceeded&&<span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">تجاوز حد الائتمان</span>}</div></td>
        <td className="p-2"><div className="flex flex-wrap gap-1">
          <Link to={`${L.statement}${r.id}`} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-bold"><FileText className="h-3.5 w-3.5"/>كشف</Link>
          <button type="button" onClick={()=>setFollow(r)} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-bold"><ClipboardList className="h-3.5 w-3.5"/>متابعة</button>
          <button type="button" onClick={()=>setShare(r)} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-bold"><Send className="h-3.5 w-3.5"/>مشاركة</button>
        </div></td>
      </tr>)}
      {!rows.length&&!loading&&<tr><td colSpan={16} className="p-8 text-center text-slate-400">لا توجد نتائج.</td></tr>}
    </tbody></table></div>}

    {follow&&<FollowUp kind={kind} row={follow} L={L} onClose={()=>setFollow(null)} onSaved={()=>{setFollow(null);void load();}}/>}
    {share&&<ShareModal kind={kind} row={share} onClose={()=>setShare(null)}/>}
  </div>;
}

/* ───── متابعة التحصيل: مسؤول، حد ائتمان اختياري، موعد، مبلغ موعود، ملاحظات ───── */
function FollowUp({kind,row,L,onClose,onSaved}:{kind:BalanceKind;row:PartyBalanceRow;L:typeof T[BalanceKind];onClose:()=>void;onSaved:()=>void}){
  const p=row.profile;
  const [peers,setPeers]=useState<ChatPeer[]>([]),[notes,setNotes]=useState<PartyNote[]>([]),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  const [owner,setOwner]=useState(p?.ownerUserId??''),[limit,setLimit]=useState(p?.creditLimit!=null?String(p.creditLimit):''),[limitCcy,setLimitCcy]=useState(p?.creditLimitCurrency??row.currencies[0]?.currency??'USD');
  const [date,setDate]=useState(p?.expectedCollectionDate??''),[promised,setPromised]=useState(p?.promisedAmount!=null?String(p.promisedAmount):''),[promCcy,setPromCcy]=useState(p?.promisedCurrency??row.currencies[0]?.currency??'USD');
  useEffect(()=>{void fetchChatPeers().then(r=>setPeers(r.data.peers.filter(x=>x.kind==='user'))).catch(()=>setPeers([]));void listPartyNotes(kind,row.id).then(setNotes).catch(()=>setNotes([]));},[kind,row.id]);
  const save=async()=>{
    setBusy(true);setErr('');
    try{
      await savePartyProfile(kind,row.id,{ownerUserId:owner||null,creditLimit:limit.trim()?Number(limit):null,creditLimitCurrency:limit.trim()?limitCcy:null,expectedCollectionDate:date||null,promisedAmount:promised.trim()?Number(promised):null,promisedCurrency:promised.trim()?promCcy:null});
      onSaved();
    }catch(e){setErr(e instanceof Error?e.message:'تعذر الحفظ');}finally{setBusy(false);}
  };
  const addNote=async()=>{if(!note.trim())return;setBusy(true);try{await addPartyNote(kind,row.id,note.trim());setNote('');setNotes(await listPartyNotes(kind,row.id));}catch(e){setErr(e instanceof Error?e.message:'تعذر إضافة الملاحظة');}finally{setBusy(false);}};
  const ccys=row.currencies.map(c=>c.currency);const opts=[...new Set([...ccys,'USD','EGP','TRY','SYP'])];
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true"><div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" dir="rtl">
    <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-black">متابعة: {row.name}</h3><button type="button" onClick={onClose} aria-label="إغلاق"><X className="h-5 w-5"/></button></div>
    {err&&<p role="alert" className="mb-2 rounded bg-rose-50 p-2 text-sm text-rose-700">{err}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm font-bold sm:col-span-2">مسؤول المتابعة<select value={owner} onChange={e=>setOwner(e.target.value)} className="w-full rounded border p-2 font-normal"><option value="">— بلا مسؤول —</option>{peers.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}</select></label>
      {kind==='customers'&&<div className="space-y-1 text-sm font-bold sm:col-span-2">حد الائتمان (اختياري)<div className="flex gap-2"><input type="number" min="0" value={limit} onChange={e=>setLimit(e.target.value)} placeholder="بلا حد" className="min-w-0 flex-1 rounded border p-2 font-mono font-normal" dir="ltr"/><select value={limitCcy} onChange={e=>setLimitCcy(e.target.value)} className="rounded border p-2 font-normal">{opts.map(c=><option key={c}>{c}</option>)}</select></div></div>}
      <label className="space-y-1 text-sm font-bold">{L.promise}<DateInput value={date} onChange={e=>setDate(e.target.value)} className="w-full rounded border p-2 font-normal"/></label>
      <div className="space-y-1 text-sm font-bold">{L.promised}<div className="flex gap-2"><input type="number" min="0" value={promised} onChange={e=>setPromised(e.target.value)} className="min-w-0 flex-1 rounded border p-2 font-mono font-normal" dir="ltr"/><select value={promCcy} onChange={e=>setPromCcy(e.target.value)} className="rounded border p-2 font-normal">{opts.map(c=><option key={c}>{c}</option>)}</select></div></div>
    </div>
    <button type="button" disabled={busy} onClick={()=>void save()} className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy?'جارٍ الحفظ…':'حفظ المتابعة'}</button>
    <h4 className="mb-2 mt-5 font-black">ملاحظات المتابعة</h4>
    <div className="flex gap-2"><input value={note} onChange={e=>setNote(e.target.value)} placeholder="أضف ملاحظة (اتصال، وعد، سبب تأخير…)" className="min-w-0 flex-1 rounded border p-2 text-sm"/><button type="button" disabled={busy||!note.trim()} onClick={()=>void addNote()} className="rounded border px-3 py-2 text-sm font-bold disabled:opacity-40">إضافة</button></div>
    <ul className="mt-3 space-y-2 text-sm">{notes.map(n=><li key={n.id} className="rounded-lg bg-slate-50 p-2"><div className="whitespace-pre-wrap">{n.note}</div><div className="mt-1 text-xs text-slate-400">{n.author??'—'} · {new Date(n.created_at).toLocaleString('en-GB',{dateStyle:'short',timeStyle:'short'})}</div></li>)}{!notes.length&&<li className="text-slate-400">لا ملاحظات بعد.</li>}</ul>
  </div></div>;
}

/* ───── مشاركة كشف الحساب: معاينة نصية قابلة للتعديل ثم واتساب أو تيليغرام ───── */
function ShareModal({kind,row,onClose}:{kind:BalanceKind;row:PartyBalanceRow;onClose:()=>void}){
  const [text,setText]=useState('جارٍ تجهيز الكشف…'),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
  useEffect(()=>{
    let active=true;
    void (kind==='customers'?getCustomerStatementByCurrency(row.id,{}):getSupplierStatementByCurrency(row.id,{})).then(r0=>{
      if(!active)return;
      const res=r0.data;
      const lines:string[]=[`كشف حساب — ${row.name}`,new Date().toLocaleDateString('en-GB'),''];
      for(const e of res.byCurrency){
        lines.push(`العملة ${e.currency}`);
        for(const r of e.rows.slice(-8))lines.push(`${r.date} · ${r.typeLabel} ${r.documentNo} · ${r.debit?`مدين ${nf(r.debit)}`:''}${r.credit?`دائن ${nf(r.credit)}`:''} · الرصيد ${nf(r.balance)}`);
        const c=row.currencies.find(x=>x.currency===e.currency);
        lines.push(`الرصيد الحالي: ${nf(e.totals.closingBalance)} ${e.currency}`);
        if(c&&kind==='customers'&&c.pendingCheques>0)lines.push(`شيكات قيد التحصيل: ${nf(c.pendingCheques)} — الرصيد المتوقع بعد التحصيل: ${nf(c.expectedBalance)} ${e.currency}`);
        lines.push('');
      }
      setText(lines.join('\n'));
    }).catch(()=>{if(active)setText(`كشف حساب — ${row.name}\n`+row.currencies.map(c=>`الرصيد ${nf(c.balance)} ${c.currency}`).join('\n'));});
    return ()=>{active=false;};
  },[kind,row]);
  const phone=(row.phone??'').replace(/[^\d]/g,'');
  const whatsapp=()=>window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`,'_blank','noopener,noreferrer');
  const telegram=async()=>{
    setBusy(true);setMsg('');
    try{await sendTelegramDocument({documentType:'STATEMENT',partyType:kind==='customers'?'customer':'supplier',partyId:row.id,message:text,eventType:'BALANCE_SHARE'});setMsg('أُرسل عبر تيليغرام');}
    catch(e){setMsg(e instanceof Error?e.message:'تعذر الإرسال عبر تيليغرام');}finally{setBusy(false);}
  };
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true"><div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" dir="rtl">
    <div className="mb-2 flex items-center justify-between"><h3 className="text-lg font-black">مشاركة كشف الحساب — معاينة</h3><button type="button" onClick={onClose} aria-label="إغلاق"><X className="h-5 w-5"/></button></div>
    <p className="mb-2 text-xs text-slate-500">راجع النص وعدّله إن شئت قبل الإرسال. لا يُرسل شيء حتى تضغط أحد الزرين.</p>
    <textarea value={text} onChange={e=>setText(e.target.value)} rows={14} className="w-full rounded-lg border p-2 font-mono text-xs" dir="auto"/>
    {msg&&<p role="status" className="mt-2 text-sm font-bold text-indigo-700">{msg}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={whatsapp} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white"><MessageCircle className="h-4 w-4"/>واتساب{phone?'':' (بلا رقم: اختر المحادثة)'}</button>
      <button type="button" disabled={busy||!row.telegramEnabled} onClick={()=>void telegram()} title={row.telegramEnabled?'':'تيليغرام غير مفعّل لهذا الطرف'} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Send className="h-4 w-4"/>تيليغرام</button>
      <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">إغلاق</button>
    </div>
  </div></div>;
}
