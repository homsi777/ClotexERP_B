import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, RefreshCw, Users, Wallet, AlertTriangle, Package, TrendingUp, TrendingDown, ArrowLeftRight, Clock } from 'lucide-react';
import { apiFetch } from '../lib/api/client';
import { fetchMe, switchCompanyApi } from '../lib/api/authApi';
import { applyCompanyDefaultLanguage } from '../i18n/applyCompanyLanguage';

type Amount = { currency: string; total: number; count?: number };
interface Branch {
  id: string; code: string; name: string; isActive: boolean;
  users: { active: number; onlineNow: number; custom: number };
  lastActivityAt: string | null;
  sales30d: Amount[]; purchases30d: Amount[]; receivables: Amount[]; payables: Amount[]; cash: Amount[];
  inventory: { availableRolls: number; availableMeters: number };
  cheques: { pending: number; overdue: number; pendingByCurrency: Amount[] };
  waiting: { salesDrafts: number; purchaseDrafts: number; pricingQueue: number; editRequests: number; wasteDrafts: number };
}
interface Overview { generatedAt: string; branches: Branch[]; recentActivity: Array<{ at: string; branch: string | null; username: string; action: string; entity_type: string | null }> }

const nf = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** المبالغ دائماً لكل عملة على حدة — لا تحويل ولا جمع بين عملتين مختلفتين. */
function Money({ rows, empty = '—' }: { rows: Amount[]; empty?: string }) {
  const shown = rows.filter((r) => Math.abs(r.total) > 0.004);
  if (!shown.length) return <span className="text-slate-400">{empty}</span>;
  return <span className="flex flex-col items-end gap-0.5" dir="ltr">{shown.map((r) => <span key={r.currency} className="font-mono text-sm font-bold">{nf(r.total, 2)} <span className="text-xs font-normal text-slate-500">{r.currency}</span></span>)}</span>;
}

function Row({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0"><span className="flex items-center gap-2 text-sm text-slate-600"><Icon className="h-4 w-4 text-slate-400" />{label}</span><div className="text-end">{children}</div></div>;
}

export function PlatformOverview() {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [isPlatform, setIsPlatform] = useState<boolean | null>(null), [currentId, setCurrentId] = useState(''), [switching, setSwitching] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData((await apiFetch<{ ok: boolean; data: Overview }>('/api/platform/overview')).data); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل اللوحة'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void fetchMe().then((me) => { setIsPlatform(me.isPlatformAdmin); setCurrentId(me.companyId); if (me.isPlatformAdmin) void load(); else setLoading(false); }).catch(() => { setIsPlatform(false); setLoading(false); });
  }, [load]);

  const openBranch = async (id: string) => {
    if (id === currentId) { window.location.assign('/'); return; }
    setSwitching(id);
    try { const u = await switchCompanyApi(id); await applyCompanyDefaultLanguage(u.companyDefaultLanguage); window.location.assign('/'); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر فتح الفرع'); setSwitching(''); }
  };

  if (isPlatform === false) return <p role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center font-bold text-rose-800">هذه اللوحة لمالك المنصة فقط.</p>;

  const alerts = (data?.branches ?? []).flatMap((b) => [
    ...(b.cheques.overdue > 0 ? [`${b.name}: ${b.cheques.overdue} شيك متأخر التحصيل`] : []),
    ...(b.waiting.pricingQueue > 0 ? [`${b.name}: ${b.waiting.pricingQueue} مستند بانتظار التسعير`] : []),
    ...(b.waiting.editRequests > 0 ? [`${b.name}: ${b.waiting.editRequests} طلب إذن تعديل بانتظار القرار`] : []),
    ...(b.waiting.wasteDrafts > 0 ? [`${b.name}: ${b.waiting.wasteDrafts} إهلاك مادي بانتظار الاعتماد`] : []),
    ...(!b.isActive ? [`${b.name}: الفرع معطّل`] : []),
  ]);

  return <div className="space-y-6" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-950">لوحة المالك</h1><p className="text-sm text-slate-500">نظرة واحدة على كل الفروع — قراءة فقط. المبالغ لكل عملة على حدة دون تحويل.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
    {loading && !data && <div className="p-10 text-center text-slate-500"><Loader2 className="inline h-6 w-6 animate-spin" /></div>}

    {data && <>
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-black"><AlertTriangle className="h-5 w-5 text-amber-600" />يحتاج متابعة</h2>
        {alerts.length === 0 ? <p className="text-sm text-emerald-700">لا شيء بانتظار القرار في أي فرع.</p> : <ul className="space-y-1.5 text-sm">{alerts.map((a, i) => <li key={i} className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-900">{a}</li>)}</ul>}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {data.branches.map((b) => <section key={b.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${b.isActive ? '' : 'opacity-60'}`}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div><h2 className="flex items-center gap-2 text-lg font-black"><Building2 className="h-5 w-5 text-indigo-600" />{b.name}</h2><p className="font-mono text-xs text-slate-400" dir="ltr">{b.code}</p></div>
            <button type="button" disabled={!!switching} onClick={() => void openBranch(b.id)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{switching === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}{b.id === currentId ? 'افتح' : 'افتح الفرع'}</button>
          </div>
          <Row icon={Users} label="المستخدمون (نشط / متصل الآن)"><b>{b.users.active}</b> / <b className="text-emerald-700">{b.users.onlineNow}</b></Row>
          <Row icon={Clock} label="آخر نشاط"><span className="text-sm">{when(b.lastActivityAt)}</span></Row>
          <Row icon={TrendingUp} label="مبيعات آخر 30 يوماً"><Money rows={b.sales30d} /></Row>
          <Row icon={TrendingDown} label="مشتريات آخر 30 يوماً"><Money rows={b.purchases30d} /></Row>
          <Row icon={Wallet} label="مستحقات على العملاء"><Money rows={b.receivables} /></Row>
          <Row icon={Wallet} label="مستحقات للموردين"><Money rows={b.payables} /></Row>
          <Row icon={Wallet} label="أرصدة الصناديق"><Money rows={b.cash} /></Row>
          <Row icon={Package} label="أتواب متاحة"><span className="font-mono text-sm font-bold" dir="ltr">{nf(b.inventory.availableRolls)} · {nf(b.inventory.availableMeters, 1)} م</span></Row>
          <Row icon={Wallet} label={`شيكات قيد التحصيل (${b.cheques.pending}${b.cheques.overdue ? ` · متأخر ${b.cheques.overdue}` : ''})`}><Money rows={b.cheques.pendingByCurrency} /></Row>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {([['فواتير بيع مسودة', b.waiting.salesDrafts], ['فواتير شراء مسودة', b.waiting.purchaseDrafts], ['بانتظار التسعير', b.waiting.pricingQueue], ['طلبات إذن', b.waiting.editRequests], ['إهلاك بانتظار الاعتماد', b.waiting.wasteDrafts]] as Array<[string, number]>).map(([l, n]) =>
              <span key={l} className={`rounded-full px-2.5 py-1 font-bold ${n > 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-500'}`}>{l}: {n}</span>)}
          </div>
        </section>)}
      </div>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-black">آخر النشاطات في كل الفروع</h2>
        <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-2">الوقت</th><th className="p-2">الفرع</th><th className="p-2">المستخدم</th><th className="p-2">العملية</th></tr></thead><tbody>
          {data.recentActivity.map((r, i) => <tr key={i} className="border-t"><td className="p-2 whitespace-nowrap">{when(r.at)}</td><td className="p-2">{r.branch ?? '—'}</td><td className="p-2">{r.username}</td><td className="p-2 font-mono text-xs" dir="ltr">{r.action}{r.entity_type ? ` · ${r.entity_type}` : ''}</td></tr>)}
          {!data.recentActivity.length && <tr><td colSpan={4} className="p-4 text-center text-slate-400">لا نشاط مسجَّل.</td></tr>}
        </tbody></table></div>
      </section>
      <p className="text-xs text-slate-400">آخر تحديث: {when(data.generatedAt)}</p>
    </>}
  </div>;
}
