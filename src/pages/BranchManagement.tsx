import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { fetchOverview } from '../lib/api/managementApi';
import type { Overview, PeriodQuery } from '../lib/api/managementApi';
import { MetricsDashboard, useDashExtras } from './management/Dashboard';
import { CustomizeDialog, useDashPrefs } from './management/Customize';
import { AlertsPanel, DecisionsPanel, LiquidityPanel, OversightPanel, SummaryPanel } from './management/Panels';
import { ErrorLine, PeriodBar, errMsg, when } from './management/kit';
import './management/dash.css';

type Tab = 'overview' | 'alerts' | 'decisions' | 'liquidity' | 'summary' | 'users';
const TABS: Array<[Tab, string]> = [['overview', 'نظرة عامة'], ['alerts', 'التنبيهات'], ['decisions', 'القرارات'], ['liquidity', 'السيولة'], ['summary', 'ملخصات'], ['users', 'المستخدمون والرقابة']];

/** لوحة إدارة الفرع: مستقلة لهذا الفرع فقط، وبحسب صلاحيات المستخدم (يفرضها الخادم). نفس مكوّنات لوحة المالك. */
export function BranchManagement() {
  const { prefs, loaded, update, reset } = useDashPrefs('branch');
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [custom, setCustom] = useState(false);
  const [period, setPeriod] = useState<PeriodQuery | null>(null), [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => { if (loaded && !period) { setPeriod({ period: prefs?.defaultPeriod ?? 'month' }); setTab((prefs?.defaultTab as Tab) && TABS.some(([k]) => k === prefs?.defaultTab) ? (prefs!.defaultTab as Tab) : 'overview'); } }, [loaded, period, prefs]);
  const load = useCallback(async () => {
    if (!period || (period.period === 'custom' && !(period.from && period.to))) return;
    setLoading(true); setError('');
    try { setData(await fetchOverview('branch', period)); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);
  const b = data?.branches[0];
  const extras = useDashExtras('branch', period ?? { period: 'month' }, undefined, !!b && tab === 'overview');
  if (!period || !tab) return <div className="cx-dash p-10 text-center"><Loader2 className="inline h-6 w-6 animate-spin" /></div>;
  return <div className="cx-dash space-y-3" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h1 className="cx-title text-xl">لوحة إدارة الفرع{b ? ` — ${b.name}` : ''}</h1><p className="cx-muted text-xs">بيانات هذا الفرع فقط · المبالغ لكل عملة على حدة · آخر تحديث {when(data?.generatedAt)}</p></div>
      <div className="cx-noprint flex gap-1.5"><button type="button" className="cx-btn" onClick={() => setCustom(true)}><SlidersHorizontal className="inline h-4 w-4" /> تخصيص</button><button type="button" onClick={() => void load()} disabled={loading} className="cx-btn"><RefreshCw className={`inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
    </div>
    <div className="cx-tabs cx-noprint space-y-2"><div className="cx-hscroll">{TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} className="cx-chip" onClick={() => setTab(k)}>{l}</button>)}</div><PeriodBar value={period} onChange={setPeriod} /></div>
    <ErrorLine msg={error} />
    {tab === 'overview' && (loading && !b ? <div className="p-10 text-center"><Loader2 className="inline h-6 w-6 animate-spin" /></div> : b && <MetricsDashboard m={b.metrics} linked prefs={prefs} analytics={extras.analytics} liquidity={extras.liquidity} attention={extras.attention} onTab={(t) => setTab(t as Tab)} scope="branch" />)}
    {tab === 'alerts' && <AlertsPanel scope="branch" />}
    {tab === 'decisions' && <DecisionsPanel scope="branch" />}
    {tab === 'liquidity' && <LiquidityPanel scope="branch" />}
    {tab === 'summary' && <SummaryPanel scope="branch" />}
    {tab === 'users' && <OversightPanel scope="branch" />}
    {custom && <CustomizeDialog prefs={prefs} tabs={TABS} onChange={update} onReset={() => void reset()} onClose={() => setCustom(false)} />}
  </div>;
}
