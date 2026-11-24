import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Building2, KeyRound, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { fetchMe, switchCompanyApi } from '../lib/api/authApi';
import { applyCompanyDefaultLanguage } from '../i18n/applyCompanyLanguage';
import { fetchOverview } from '../lib/api/managementApi';
import type { Overview, PeriodQuery } from '../lib/api/managementApi';
import { MetricsDashboard, useDashExtras } from './management/Dashboard';
import { CustomizeDialog, useDashPrefs } from './management/Customize';
import { AdminCostSection } from './management/AdminCost';
import { AlertsPanel, DecisionsPanel, LiquidityPanel, OversightPanel, SummaryPanel } from './management/Panels';
import { ChartCard, CurrencyTabs, HBars } from './management/charts';
import { ErrorLine, MoneyLines, PeriodBar, errMsg, nf, when } from './management/kit';
import './management/dash.css';

type Tab = 'overview' | 'alerts' | 'decisions' | 'liquidity' | 'summary' | 'users' | 'cost';
const TABS: Array<[Tab, string]> = [['overview', 'نظرة عامة'], ['alerts', 'التنبيهات'], ['decisions', 'القرارات'], ['liquidity', 'السيولة'], ['summary', 'ملخصات'], ['users', 'المستخدمون والرقابة'], ['cost', 'التكلفة والربحية (سري)']];

/** مقارنة فروع مختارة جنباً إلى جنب: كل مقياس لعملة واحدة، ولا اختلاط بين الفروع أو العملات. */
function Compare({ branches }: { branches: Overview['branches'] }) {
  const ccys = [...new Set(branches.flatMap((b) => [...b.metrics.sales.current, ...b.metrics.purchases.current, ...b.metrics.balances.customers.map((c) => ({ currency: c.currency }))].map((x) => x.currency)))].sort();
  const [ccy, setCcy] = useState('');
  const cur = ccys.includes(ccy) ? ccy : ccys[0] ?? '';
  const pick = (rows: Array<{ currency: string; total: number }>) => rows.find((r) => r.currency === cur)?.total ?? 0;
  const item = (f: (b: Overview['branches'][number]) => number) => branches.map((b) => ({ label: b.name, values: [f(b)] }));
  return <div className="space-y-3">
    <div className="cx-card overflow-x-auto p-2"><table className="cx-tbl"><thead><tr><th>المؤشر</th>{branches.map((b) => <th key={b.id}>{b.name}</th>)}</tr></thead><tbody>
      {([['المبيعات', (b) => <MoneyLines rows={b.metrics.sales.current} deltaAgainst={b.metrics.sales.previous} />], ['المشتريات', (b) => <MoneyLines rows={b.metrics.purchases.current} deltaAgainst={b.metrics.purchases.previous} />],
        ['العملاء مدينون', (b) => <MoneyLines rows={b.metrics.balances.customers.map((c) => ({ currency: c.currency, total: c.owedToUs }))} />], ['الموردون (علينا)', (b) => <MoneyLines rows={b.metrics.balances.suppliers.map((c) => ({ currency: c.currency, total: c.weOwe }))} />],
        ['الصناديق', (b) => <MoneyLines rows={b.metrics.cash} />], ['شيكات متأخرة', (b) => <span className="num">{b.metrics.cheques.overdue}</span>], ['مخزون متاح (م)', (b) => <span className="num">{nf(b.metrics.inventory.available.meters, 1)}</span>],
        ['طلبيات متأخرة', (b) => <span className="num">{b.metrics.orders.late}</span>], ['مصنعية خارجية متأخرة', (b) => <span className="num">{b.metrics.external.late}</span>], ['أوامر إنتاج متأخرة', (b) => <span className="num">{b.metrics.production.late}</span>]] as Array<[string, (b: Overview['branches'][number]) => React.ReactNode]>)
        .map(([l, f]) => <tr key={l}><td className="font-bold">{l}</td>{branches.map((b) => <td key={b.id}>{f(b)}</td>)}</tr>)}</tbody></table></div>
    <div className="cx-charts">
      <ChartCard title="مقارنة المبيعات" right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />} empty={!ccys.length ? 'لا مبيعات.' : undefined}><HBars unit={cur} legend={['المبيعات']} items={item((b) => pick(b.metrics.sales.current))} /></ChartCard>
      <ChartCard title="مقارنة المشتريات" right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />} empty={!ccys.length ? 'لا مشتريات.' : undefined}><HBars unit={cur} legend={['المشتريات']} items={item((b) => pick(b.metrics.purchases.current))} /></ChartCard>
      <ChartCard title="مقارنة المخزون المتاح (أمتار)"><HBars unit="م" legend={['أمتار']} items={item((b) => b.metrics.inventory.available.meters)} /></ChartCard>
      <ChartCard title="مقارنة ديون العملاء" right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />} empty={!ccys.length ? 'لا أرصدة.' : undefined}><HBars unit={cur} legend={['مدينون لنا']} items={item((b) => b.metrics.balances.customers.find((c) => c.currency === cur)?.owedToUs ?? 0)} /></ChartCard>
    </div>
  </div>;
}

/** لوحة المالك المركزية: كل الفروع، اختيار فرع أو مقارنة عدة فروع، وإدارة التنبيهات دون تبديل الفرع. */
export function PlatformOverview() {
  const { prefs, loaded, update, reset } = useDashPrefs('owner');
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [isPlatform, setIsPlatform] = useState<boolean | null>(null), [currentId, setCurrentId] = useState(''), [switching, setSwitching] = useState('');
  const [period, setPeriod] = useState<PeriodQuery | null>(null), [tab, setTab] = useState<Tab | null>(null), [custom, setCustom] = useState(false);
  const [sel, setSel] = useState<string[] | null>(null);

  useEffect(() => { void fetchMe().then((me) => { setIsPlatform(me.isPlatformAdmin); setCurrentId(me.companyId); }).catch(() => setIsPlatform(false)); }, []);
  useEffect(() => { if (loaded && !period) { setPeriod({ period: prefs?.defaultPeriod ?? 'month' }); const t = prefs?.defaultTab as Tab | undefined; setTab(t && TABS.some(([k]) => k === t) ? t : 'overview'); } }, [loaded, period, prefs]);
  const load = useCallback(async () => {
    if (!period || (period.period === 'custom' && !(period.from && period.to))) return;
    setLoading(true); setError('');
    try { const o = await fetchOverview('owner', period); setData(o); setSel((s) => s ?? o.branches.map((b) => b.id)); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [period]);
  useEffect(() => { if (isPlatform && period) void load(); }, [isPlatform, period, load]);

  const chosen = useMemo(() => (data?.branches ?? []).filter((b) => (sel ?? []).includes(b.id)), [data, sel]);
  const single = chosen.length === 1 ? chosen[0] : null;
  const focusId = single?.id ?? chosen.find((b) => b.id === currentId)?.id ?? chosen[0]?.id;
  const focus = (data?.branches ?? []).find((b) => b.id === focusId);
  const extras = useDashExtras('owner', period ?? { period: 'month' }, focusId, !!single && tab === 'overview');

  const goBranch = async (id: string, to: string) => {
    if (id === currentId) { window.location.assign(to); return; }
    setSwitching(id);
    try { const u = await switchCompanyApi(id); await applyCompanyDefaultLanguage(u.companyDefaultLanguage); window.location.assign(to); }
    catch (e) { setError(errMsg(e)); setSwitching(''); }
  };

  if (isPlatform === false) return <p role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center font-bold text-rose-800">هذه اللوحة لمالك المنصة فقط.</p>;
  if (!period || !tab) return <div className="cx-dash p-10 text-center"><Loader2 className="inline h-6 w-6 animate-spin" /></div>;

  return <div className="cx-dash space-y-3" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h1 className="cx-title text-xl">لوحة المالك</h1><p className="cx-muted text-xs">كل الفروع · المبالغ لكل عملة على حدة دون تحويل · الفروع لا تختلط · آخر تحديث {when(data?.generatedAt)}</p></div>
      <div className="cx-noprint flex gap-1.5"><button type="button" className="cx-btn" onClick={() => setCustom(true)}><SlidersHorizontal className="inline h-4 w-4" /> تخصيص</button><button type="button" onClick={() => void load()} disabled={loading} className="cx-btn"><RefreshCw className={`inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
    </div>
    <div className="cx-tabs cx-noprint space-y-2">
      <div className="cx-hscroll">{TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} className="cx-chip" onClick={() => setTab(k)}>{l}</button>)}</div>
      <PeriodBar value={period} onChange={setPeriod} />
      {data && <div className="cx-hscroll items-center"><span className="cx-muted text-xs">الفروع:</span>
        <button type="button" className="cx-chip" aria-pressed={chosen.length === data.branches.length} onClick={() => setSel(data.branches.map((b) => b.id))}>الكل (مقارنة)</button>
        {data.branches.map((b) => <button key={b.id} type="button" className="cx-chip" aria-pressed={(sel ?? []).includes(b.id)} onClick={() => setSel((s) => { const cur = s ?? []; const next = cur.includes(b.id) ? cur.filter((x) => x !== b.id) : [...cur, b.id]; return next.length ? next : cur; })}>{b.name}</button>)}</div>}
    </div>
    <ErrorLine msg={error} />
    {loading && !data && <div className="p-10 text-center"><Loader2 className="inline h-6 w-6 animate-spin" /></div>}

    {tab === 'overview' && data && <>
      {single ? <div className="space-y-3">
        <div className="cx-card cx-noprint flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="flex items-center gap-2"><Building2 className="h-5 w-5" style={{ color: 'var(--cx-brand)' }} /><b>{single.name}</b><span className="cx-muted num text-xs">{single.code} · آخر نشاط {when(single.lastActivityAt)}</span></div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="cx-btn cx-btn-primary" disabled={!!switching} onClick={() => void goBranch(single.id, '/management')}>{switching === single.id ? <Loader2 className="inline h-4 w-4 animate-spin" /> : <ArrowLeftRight className="inline h-4 w-4" />} فتح التفاصيل داخل الفرع</button>
            <button type="button" className="cx-btn" disabled={!!switching} onClick={() => void goBranch(single.id, '/permissions')}><KeyRound className="inline h-4 w-4" /> إدارة صلاحيات الفرع</button>
          </div>
        </div>
        <MetricsDashboard m={single.metrics} linked={single.id === currentId} prefs={prefs} analytics={extras.analytics} liquidity={extras.liquidity} attention={extras.attention} onTab={(t) => setTab(t as Tab)} branchId={single.id} scope="owner" />
        {single.id !== currentId && <p className="cx-muted text-xs">روابط المؤشرات تفتح داخل الفرع الحالي؛ استخدم «فتح التفاصيل داخل الفرع» للانتقال إلى هذا الفرع بالذات (لا خلط بين الفروع).</p>}
      </div> : <div className="space-y-3">
        <Compare branches={chosen} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{chosen.map((b) => <div key={b.id} className="cx-card cx-noprint flex items-center justify-between gap-2 p-3"><div className="flex items-center gap-2 text-sm font-bold"><Building2 className="h-4 w-4" />{b.name}</div><button type="button" className="cx-btn" onClick={() => setSel([b.id])}>تفاصيل</button></div>)}</div>
      </div>}
      {data.recentActivity.length > 0 && <details className="cx-card p-3"><summary className="cursor-pointer text-sm font-bold">آخر النشاطات في الفروع</summary>
        <div className="mt-2 overflow-x-auto"><table className="cx-tbl"><thead><tr><th>الوقت</th><th>الفرع</th><th>المستخدم</th><th>العملية</th></tr></thead><tbody>{data.recentActivity.map((r, i) => <tr key={i}><td>{when(r.at)}</td><td>{r.branch ?? '—'}</td><td>{r.username}</td><td className="num">{r.action}{r.entity_type ? ` · ${r.entity_type}` : ''}</td></tr>)}</tbody></table></div></details>}
    </>}
    {tab === 'alerts' && <AlertsPanel scope="owner" branchId={single?.id ?? focusId} branchName={focus?.name} />}
    {tab === 'decisions' && <DecisionsPanel scope="owner" branchId={single?.id} />}
    {tab === 'liquidity' && <LiquidityPanel scope="owner" branchId={single?.id} />}
    {tab === 'summary' && (single ? <SummaryPanel scope="owner" branchId={single.id} /> : <p className="cx-muted text-sm">اختر فرعاً واحداً لعرض ملخصاته.</p>)}
    {tab === 'users' && <OversightPanel scope="owner" />}
    {tab === 'cost' && (single ? <AdminCostSection branchId={single.id} period={period} isOwner /> : <p className="cx-muted text-sm">اختر فرعاً واحداً لعرض التكلفة والربحية (لا اختلاط بين الفروع).</p>)}
    {custom && <CustomizeDialog prefs={prefs} tabs={TABS} onChange={update} onReset={() => void reset()} onClose={() => setCustom(false)} />}
  </div>;
}
