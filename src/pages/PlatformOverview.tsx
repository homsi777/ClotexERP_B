import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { fetchMe, switchCompanyApi } from '../lib/api/authApi';
import { applyCompanyDefaultLanguage } from '../i18n/applyCompanyLanguage';
import { fetchOverview } from '../lib/api/managementApi';
import type { Overview, PeriodQuery } from '../lib/api/managementApi';
import { AdminCostPanel, AlertsPanel, DecisionsPanel, LiquidityPanel, MetricsGrid, Money, OversightPanel, PeriodBar, SummaryPanel, nf, when } from './ManagementPanels';

type Tab = 'overview' | 'alerts' | 'decisions' | 'liquidity' | 'summary' | 'users' | 'cost';
const TABS: Array<[Tab, string]> = [['overview', 'نظرة عامة'], ['alerts', 'مركز التنبيهات'], ['decisions', 'قرارات معلّقة'], ['liquidity', 'السيولة'], ['summary', 'ملخصات'], ['users', 'المستخدمون والاستثناءات'], ['cost', 'التكلفة والربحية (سري)']];
const HOME_KEY = 'clotex.platform.home';

/** لوحة المالك المركزية: كل الفروع، فترة قابلة للاختيار، كل مؤشر ينقل لشاشته الأصلية. */
export function PlatformOverview() {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [isPlatform, setIsPlatform] = useState<boolean | null>(null), [currentId, setCurrentId] = useState(''), [switching, setSwitching] = useState('');
  const [period, setPeriod] = useState<PeriodQuery>({ period: 'month' });
  const [tab, setTab] = useState<Tab>(() => { try { const t = localStorage.getItem(HOME_KEY) as Tab | null; return t && TABS.some(([k]) => k === t) ? t : 'overview'; } catch { return 'overview'; } });
  const [open, setOpen] = useState(''), [costBranch, setCostBranch] = useState('');

  const load = useCallback(async () => {
    if (period.period === 'custom' && !(period.from && period.to)) return;
    setLoading(true); setError('');
    try { setData(await fetchOverview('owner', period)); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل اللوحة'); }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { void fetchMe().then((me) => { setIsPlatform(me.isPlatformAdmin); setCurrentId(me.companyId); setCostBranch(me.companyId); }).catch(() => setIsPlatform(false)); }, []);
  useEffect(() => { if (isPlatform) void load(); }, [isPlatform, load]);

  const openBranch = async (id: string, to = '/') => {
    if (id === currentId) { window.location.assign(to); return; }
    setSwitching(id);
    try { const u = await switchCompanyApi(id); await applyCompanyDefaultLanguage(u.companyDefaultLanguage); window.location.assign(to); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر فتح الفرع'); setSwitching(''); }
  };
  const setHome = (t: Tab) => { try { localStorage.setItem(HOME_KEY, t); } catch { /* ignore */ } };

  if (isPlatform === false) return <p role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center font-bold text-rose-800">هذه اللوحة لمالك المنصة فقط.</p>;

  return <div className="space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-950">لوحة المالك</h1><p className="text-sm text-slate-500">كل الفروع في مكان واحد. المبالغ لكل عملة على حدة دون تحويل، والفروع لا تختلط.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
    </div>
    <PeriodBar value={period} onChange={setPeriod} />
    <div className="flex flex-wrap items-center gap-1.5">
      {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === k ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{l}</button>)}
      <button type="button" onClick={() => setHome(tab)} className="ms-auto text-xs text-slate-500 underline">اجعل هذا القسم صفحتي الافتتاحية</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}

    {tab === 'overview' && <>
      {loading && !data && <div className="p-10 text-center text-slate-500"><Loader2 className="inline h-6 w-6 animate-spin" /></div>}
      {data && <>
        <p className="text-xs text-slate-500">الفترة: {data.period.label} ({data.period.from} → {data.period.to}) — مقارنة بالفترة السابقة {data.period.prevFrom} → {data.period.prevTo}</p>
        <div className="grid gap-4 lg:grid-cols-3">
          {data.branches.map((b) => <section key={b.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${b.isActive ? '' : 'opacity-60'} ${open === b.id ? 'lg:col-span-3' : ''}`}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div><h2 className="flex items-center gap-2 text-lg font-black"><Building2 className="h-5 w-5 text-indigo-600" />{b.name}</h2><p className="font-mono text-xs text-slate-400" dir="ltr">{b.code} · آخر نشاط {when(b.lastActivityAt)}</p></div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setOpen(open === b.id ? '' : b.id)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">{open === b.id ? 'طيّ' : 'التفاصيل'}</button>
                <button type="button" disabled={!!switching} onClick={() => void openBranch(b.id, '/management')} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{switching === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}لوحة الفرع</button>
              </div>
            </div>
            {open === b.id ? <MetricsGrid m={b.metrics} linked={b.id === currentId} /> : <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">مبيعات</span><Money rows={b.metrics.sales.current} /></div>
              <div className="flex justify-between"><span className="text-slate-600">العملاء مدينون (كشف الحساب)</span><Money rows={b.metrics.balances.customers.map((r) => ({ currency: r.currency, total: r.owedToUs }))} /></div>
              <div className="flex justify-between"><span className="text-slate-600">الموردون (علينا)</span><Money rows={b.metrics.balances.suppliers.map((r) => ({ currency: r.currency, total: r.weOwe }))} /></div>
              <div className="flex justify-between"><span className="text-slate-600">الصناديق</span><Money rows={b.metrics.cash} /></div>
              <div className="flex justify-between"><span className="text-slate-600">أتواب متاحة</span><span className="font-mono font-bold" dir="ltr">{nf(b.metrics.inventory.available.rolls)} · {nf(b.metrics.inventory.available.meters, 1)} م</span></div>
            </div>}
            {open === b.id && b.id !== currentId && <p className="mt-2 text-xs text-slate-500">روابط المؤشرات تعمل داخل الفرع الحالي فقط؛ افتح «لوحة الفرع» للتنقل إلى تفاصيله.</p>}
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
    </>}
    {tab === 'alerts' && <AlertsPanel scope="owner" />}
    {tab === 'decisions' && <DecisionsPanel scope="owner" />}
    {tab === 'liquidity' && <LiquidityPanel scope="owner" />}
    {tab === 'summary' && <p className="text-sm text-slate-600">الملخصات تُعرض لكل فرع على حدة: افتح «لوحة الفرع» ثم تبويب «ملخصات».</p>}
    {tab === 'users' && <OversightPanel scope="owner" />}
    {tab === 'cost' && <div className="space-y-3">
      <select value={costBranch} onChange={(e) => setCostBranch(e.target.value)} className="rounded-lg border px-2 py-1 text-sm">{(data?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      {costBranch && <AdminCostPanel branchId={costBranch} period={period} />}
    </div>}
  </div>;
}
