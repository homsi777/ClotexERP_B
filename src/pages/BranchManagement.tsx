import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchOverview } from '../lib/api/managementApi';
import type { Overview, PeriodQuery } from '../lib/api/managementApi';
import { AlertsPanel, DecisionsPanel, LiquidityPanel, MetricsGrid, OversightPanel, PeriodBar, SummaryPanel, when } from './ManagementPanels';

type Tab = 'overview' | 'alerts' | 'decisions' | 'liquidity' | 'summary' | 'users';
const TABS: Array<[Tab, string]> = [['overview', 'نظرة عامة'], ['alerts', 'مركز التنبيهات'], ['decisions', 'قرارات معلّقة'], ['liquidity', 'السيولة'], ['summary', 'ملخصات'], ['users', 'المستخدمون والاستثناءات']];

/** لوحة إدارة الفرع: مستقلة لهذا الفرع فقط، وبحسب صلاحيات المستخدم (يفرضها الخادم). */
export function BranchManagement() {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodQuery>({ period: 'month' }), [tab, setTab] = useState<Tab>('overview');
  const load = useCallback(async () => {
    if (period.period === 'custom' && !(period.from && period.to)) return;
    setLoading(true); setError('');
    try { setData(await fetchOverview('branch', period)); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر التحميل'); } finally { setLoading(false); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);
  const b = data?.branches[0];
  return <div className="space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-950">لوحة إدارة الفرع{b ? ` — ${b.name}` : ''}</h1><p className="text-sm text-slate-500">بيانات هذا الفرع فقط. المبالغ لكل عملة على حدة.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />تحديث</button>
    </div>
    <PeriodBar value={period} onChange={setPeriod} />
    <div className="flex flex-wrap gap-1.5">{TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === k ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{l}</button>)}</div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
    {tab === 'overview' && (loading && !b ? <Loader2 className="h-6 w-6 animate-spin" /> : b && <><p className="text-xs text-slate-500">الفترة: {b.metrics.period.label} · آخر تحديث {when(data?.generatedAt)}</p><MetricsGrid m={b.metrics} /></>)}
    {tab === 'alerts' && <AlertsPanel scope="branch" />}
    {tab === 'decisions' && <DecisionsPanel scope="branch" />}
    {tab === 'liquidity' && <LiquidityPanel scope="branch" />}
    {tab === 'summary' && <SummaryPanel />}
    {tab === 'users' && <OversightPanel scope="branch" />}
  </div>;
}
