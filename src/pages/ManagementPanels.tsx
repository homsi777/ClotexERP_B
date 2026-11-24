import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, Printer, Copy } from 'lucide-react';
import * as api from '../lib/api/managementApi';
import type { AlertRow, BranchMetrics, Money as MoneyT, PeriodKind, PeriodQuery, Scope } from '../lib/api/managementApi';

export const nf = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const msg = (e: unknown) => (e instanceof Error ? e.message : 'تعذر التنفيذ');

/** المبالغ لكل عملة على حدة — لا تحويل ولا جمع بين عملتين. */
export function Money({ rows }: { rows: MoneyT[] }) {
  const shown = rows.filter((r) => Math.abs(r.total) > 0.004);
  if (!shown.length) return <span className="text-slate-400">—</span>;
  return <span className="flex flex-col items-end gap-0.5" dir="ltr">{shown.map((r) => <span key={r.currency} className="font-mono text-sm font-bold">{nf(r.total, 2)} <span className="text-xs font-normal text-slate-500">{r.currency}</span></span>)}</span>;
}

const LinkCtx = createContext(true);
function Kpi({ label, href, children, hint }: { label: string; href?: string; children: React.ReactNode; hint?: string }) {
  const body = <><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-end">{children}</div>{hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}</>;
  const cls = 'block rounded-xl border bg-slate-50 p-3';
  const linked = useContext(LinkCtx);
  return href && linked ? <Link to={href} className={`${cls} hover:border-indigo-400 hover:bg-indigo-50`}>{body}</Link> : <div className={cls}>{body}</div>;
}
const Num = ({ n, d = 0, unit }: { n: number; d?: number; unit?: string }) => <span className="font-mono text-sm font-bold" dir="ltr">{nf(n, d)}{unit ? ` ${unit}` : ''}</span>;
const delta = (cur: MoneyT[], prev: MoneyT[]) => cur.filter((c) => c.total !== 0 || prev.some((p) => p.currency === c.currency)).map((c) => {
  const p = prev.find((x) => x.currency === c.currency)?.total ?? 0;
  return `${c.currency}: ${p ? `${c.total >= p ? '▲' : '▼'} ${nf(Math.abs(((c.total - p) / p) * 100), 1)}%` : 'لا مقارنة'}`;
}).join(' · ');

export function PeriodBar({ value, onChange }: { value: PeriodQuery; onChange: (p: PeriodQuery) => void }) {
  const opts: Array<[PeriodKind, string]> = [['today', 'اليوم'], ['yesterday', 'أمس'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة'], ['custom', 'مخصّص']];
  return <div className="flex flex-wrap items-center gap-2">
    {opts.map(([k, l]) => <button key={k} type="button" onClick={() => onChange({ ...value, period: k })} className={`rounded-full px-3 py-1 text-sm font-bold ${value.period === k ? 'bg-indigo-600 text-white' : 'border bg-white text-slate-700'}`}>{l}</button>)}
    {value.period === 'custom' && <>
      <input type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} className="rounded-lg border px-2 py-1 text-sm" />
      <input type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} className="rounded-lg border px-2 py-1 text-sm" />
    </>}
  </div>;
}

/** بطاقة مؤشرات فرع واحد: كل مؤشر ينقل إلى شاشته الأصلية. */
export function MetricsGrid({ m, linked = true }: { m: BranchMetrics; linked?: boolean }) {
  const bal = (rows: Array<{ currency: string; owedToUs: number; weOwe: number }>, key: 'owedToUs' | 'weOwe'): MoneyT[] => rows.map((r) => ({ currency: r.currency, total: r[key] }));
  return <LinkCtx.Provider value={linked}><div className="space-y-4">
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="المبيعات" href="/invoices/sales" hint={`مقارنة بالفترة السابقة — ${delta(m.sales.current, m.sales.previous) || 'لا بيانات'}`}><Money rows={m.sales.current} /></Kpi>
      <Kpi label="المشتريات" href="/invoices/purchases" hint={delta(m.purchases.current, m.purchases.previous)}><Money rows={m.purchases.current} /></Kpi>
      <Kpi label="أرصدة الصناديق" href="/reports"><Money rows={m.cash} /></Kpi>
      <Kpi label={`شيكات قيد التحصيل (${m.cheques.pending}${m.cheques.overdue ? ` · متأخر ${m.cheques.overdue}` : ''})`} href="/reports"><Money rows={m.cheques.pendingByCurrency} /></Kpi>
      <Kpi label="العملاء — مدينون لنا (حسب كشف الحساب)" href="/customers/balances"><Money rows={bal(m.balances.customers, 'owedToUs')} /></Kpi>
      <Kpi label="العملاء — دائنون (لهم علينا)" href="/customers/balances"><Money rows={bal(m.balances.customers, 'weOwe')} /></Kpi>
      <Kpi label="الموردون — علينا لهم" href="/suppliers/balances"><Money rows={bal(m.balances.suppliers, 'weOwe')} /></Kpi>
      <Kpi label="الموردون — لنا عندهم" href="/suppliers/balances"><Money rows={bal(m.balances.suppliers, 'owedToUs')} /></Kpi>
      <Kpi label="عملاء تجاوزوا السقف / وعد متأخر" href="/customers/balances"><Num n={m.balances.customerAlerts.limitExceeded} /> / <Num n={m.balances.customerAlerts.promiseOverdue} /></Kpi>
      <Kpi label={`عملاء غير نشطين (> ${m.inactiveCustomers.thresholdDays} يوماً)`} href="/customers/balances"><Num n={m.inactiveCustomers.count} /></Kpi>
      <Kpi label="طلبات: قيد التجهيز / مفتوحة / متأخرة" href="/invoices/sales"><Num n={m.orders.inPreparation} /> / <Num n={m.orders.open} /> / <Num n={m.orders.late} /></Kpi>
      <Kpi label="مستخدمون (نشط / متصل الآن)"><Num n={m.users.active} /> / <Num n={m.users.onlineNow} /></Kpi>
    </div>
    <h3 className="text-sm font-black text-slate-700">المخزون</h3>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="متاح (أتواب · أمتار)" href="/inventory"><Num n={m.inventory.available.rolls} /> · <Num n={m.inventory.available.meters} d={1} unit="م" /></Kpi>
      <Kpi label="محجوز" href="/inventory"><Num n={m.inventory.reserved.rolls} /> · <Num n={m.inventory.reserved.meters} d={1} unit="م" /></Kpi>
      <Kpi label="حجر / عزل" href="/inventory"><Num n={m.inventory.quarantined.rolls} /> · <Num n={m.inventory.quarantined.meters} d={1} unit="م" /></Kpi>
      <Kpi label="أتواب بلا موقع" href="/inventory/zones"><Num n={m.inventory.withoutLocation} /></Kpi>
      <Kpi label={`راكد (> ${m.inventory.slowMoving.thresholdDays} يوماً)`} href="/inventory"><Num n={m.inventory.slowMoving.rolls} /> · <Num n={m.inventory.slowMoving.meters} d={1} unit="م" /></Kpi>
      <Kpi label="تحويلات معلّقة" href="/inventory/transfers"><Num n={m.inventory.pendingTransfers} /></Kpi>
    </div>
    <h3 className="text-sm font-black text-slate-700">التصنيع الخارجي والإنتاج</h3>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="أوامر خارجية مفتوحة / متأخرة" href="/purchases/external-jobs"><Num n={m.external.open} /> / <Num n={m.external.late} /></Kpi>
      <Kpi label="استلام جزئي" href="/purchases/external-jobs"><Num n={m.external.partiallyReceived} /></Kpi>
      <Kpi label="أمتار مرسلة / مستلمة / متبقية" href="/purchases/external-jobs"><Num n={m.external.metersSent} d={1} /> / <Num n={m.external.metersReceived} d={1} /> / <Num n={m.external.metersRemaining} d={1} /></Kpi>
      <Kpi label="أوامر إنتاج مفتوحة / متأخرة"><Num n={m.production.open} /> / <Num n={m.production.late} /></Kpi>
    </div>
    <h3 className="text-sm font-black text-slate-700">المبيعات حسب البُعد (للفترة)</h3>
    <div className="grid gap-3 lg:grid-cols-4">
      {([['أفضل العملاء', m.sales.topCustomers.map((r) => [r.name, r.total, r.currency])], ['حسب الصنف', m.sales.byItem.map((r) => [r.name, r.total, r.currency])], ['حسب اللون', m.sales.byColor.map((r) => [r.name, r.total, r.currency])], ['حسب المُنشئ', m.sales.byCreator.map((r) => [r.name, r.total, r.currency])]] as Array<[string, Array<[string, number, string]>]>).map(([t, rows]) =>
        <div key={t} className="rounded-xl border p-3"><div className="mb-1 text-xs font-bold text-slate-600">{t}</div>
          {rows.length ? rows.slice(0, 8).map(([n, v, c], i) => <div key={i} className="flex justify-between gap-2 text-xs"><span className="truncate">{n}</span><span className="font-mono" dir="ltr">{nf(v, 2)} {c}</span></div>) : <span className="text-xs text-slate-400">—</span>}</div>)}
    </div>
    <div className="flex flex-wrap gap-1.5 text-xs">
      {([['فواتير بيع مسودة', m.waiting.salesDrafts], ['فواتير شراء مسودة', m.waiting.purchaseDrafts], ['بانتظار التسعير', m.waiting.pricingQueue], ['طلبات إذن', m.waiting.editRequests], ['إهلاك بانتظار الاعتماد', m.waiting.wasteDrafts]] as Array<[string, number]>).map(([l, n]) =>
        <span key={l} className={`rounded-full px-2.5 py-1 font-bold ${n > 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-500'}`}>{l}: {n}</span>)}
    </div>
    {m.unavailable.length > 0 && <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <summary className="cursor-pointer font-bold">مؤشرات غير متاحة حالياً ({m.unavailable.length}) — لا نعرض أرقاماً بديلة</summary>
      <ul className="mt-2 list-disc space-y-1 pe-5">{m.unavailable.map((u) => <li key={u.key}><b>{u.label}:</b> {u.reason}</li>)}</ul>
    </details>}
  </div></LinkCtx.Provider>;
}

const sevCls: Record<string, string> = { HIGH: 'bg-rose-100 text-rose-800', MEDIUM: 'bg-amber-100 text-amber-900', LOW: 'bg-slate-100 text-slate-700' };
const sevLbl: Record<string, string> = { HIGH: 'عالية', MEDIUM: 'متوسطة', LOW: 'منخفضة' };

function AlertItem({ a, onAct }: { a: AlertRow; onAct?: (a: AlertRow, action: 'ack' | 'snooze' | 'note' | 'reopen') => void }) {
  return <li className="rounded-xl border bg-white p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${sevCls[a.severity]}`}>{sevLbl[a.severity]}</span><Link to={a.href} className="font-bold text-indigo-700 hover:underline">{a.title}</Link></div>
      {onAct && <div className="flex gap-1 text-xs">
        {a.status === 'OPEN' && <button type="button" className="rounded border px-2 py-0.5" onClick={() => onAct(a, 'ack')}>اطلعت</button>}
        {a.status !== 'SNOOZED' && <button type="button" className="rounded border px-2 py-0.5" onClick={() => onAct(a, 'snooze')}>تأجيل 3 أيام</button>}
        {(a.status === 'SNOOZED' || a.status === 'ACKNOWLEDGED') && <button type="button" className="rounded border px-2 py-0.5" onClick={() => onAct(a, 'reopen')}>إعادة فتح</button>}
        <button type="button" className="rounded border px-2 py-0.5" onClick={() => onAct(a, 'note')}>ملاحظة</button>
      </div>}
    </div>
    <p className="mt-1 text-slate-600">{a.detail}</p>
    <p className="mt-1 text-[11px] text-slate-400">{a.status === 'SNOOZED' ? `مؤجَّل حتى ${when(a.snoozedUntil)} · ` : ''}{a.assigneeName ? `مسؤول: ${a.assigneeName} · ` : ''}أول ظهور {when(a.firstSeenAt)}{a.note ? ` · ملاحظة: ${a.note}` : ''}</p>
  </li>;
}

export function AlertsPanel({ scope }: { scope: Scope }) {
  const [rows, setRows] = useState<AlertRow[]>([]), [owner, setOwner] = useState<Awaited<ReturnType<typeof api.fetchOwnerAlerts>>>([]);
  const [settings, setSettings] = useState<api.AlertSettings | null>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [sev, setSev] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      if (scope === 'owner') setOwner(await api.fetchOwnerAlerts());
      else { setRows((await api.fetchAlerts('ACTIVE')).alerts); setSettings((await api.fetchAlertSettings()).settings); }
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);
  const act = async (a: AlertRow, action: 'ack' | 'snooze' | 'note' | 'reopen') => {
    try {
      const body: Parameters<typeof api.alertAction>[0] = { key: a.key, action };
      if (action === 'snooze') body.until = new Date(Date.now() + 3 * 864e5).toISOString();
      if (action === 'note') { const n = window.prompt('الملاحظة'); if (!n) return; body.note = n; }
      await api.alertAction(body); await load();
    } catch (e) { setErr(msg(e)); }
  };
  const saveSettings = async () => { if (!settings) return; try { setSettings(await api.saveAlertSettings(settings)); await load(); } catch (e) { setErr(msg(e)); } };
  const filt = (l: AlertRow[]) => (sev ? l.filter((a) => a.severity === sev) : l);
  return <div className="space-y-3">
    <div className="flex items-center gap-2"><select value={sev} onChange={(e) => setSev(e.target.value)} className="rounded-lg border px-2 py-1 text-sm"><option value="">كل الخطورات</option><option value="HIGH">عالية</option><option value="MEDIUM">متوسطة</option><option value="LOW">منخفضة</option></select>
      <button type="button" onClick={() => void load()} className="rounded-lg border px-2 py-1 text-sm">{busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : <RefreshCw className="inline h-4 w-4" />}</button></div>
    {err && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm font-bold text-rose-700">{err}</p>}
    {scope === 'owner' ? owner.map((b) => <section key={b.branchId}><h3 className="mb-1 font-black">{b.branch} ({b.alerts.length})</h3>
      <ul className="space-y-2">{filt(b.alerts).map((a) => <AlertItem key={a.key} a={a} />)}{!b.alerts.length && <li className="text-sm text-emerald-700">لا تنبيهات.</li>}</ul></section>)
      : <ul className="space-y-2">{filt(rows).map((a) => <AlertItem key={a.key} a={a} onAct={act} />)}{!rows.length && <li className="text-sm text-emerald-700">لا تنبيهات نشطة.</li>}</ul>}
    {scope === 'owner' && <p className="text-xs text-slate-500">للتعامل مع تنبيه (تأجيل/إسناد/ملاحظة) افتح الفرع ثم «لوحة الفرع».</p>}
    {settings && <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-bold">قواعد التنبيه لهذا الفرع</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {([['inactiveCustomerDays', 'أيام خمول العميل'], ['slowStockDays', 'أيام ركود المخزون'], ['externalLateDays', 'أيام تأخر التصنيع الخارجي'], ['draftAgeDays', 'عمر المسودة'], ['chequeDueSoonDays', 'أيام قرب استحقاق الشيك']] as Array<[keyof api.AlertSettings, string]>).map(([k, l]) =>
          <label key={k} className="flex items-center justify-between gap-2">{l}<input type="number" min={1} value={Number(settings[k])} onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) })} className="w-24 rounded border px-2 py-1" /></label>)}
      </div><button type="button" onClick={() => void saveSettings()} className="mt-2 rounded-lg bg-indigo-600 px-3 py-1 text-sm font-bold text-white">حفظ</button></details>}
  </div>;
}

export function DecisionsPanel({ scope }: { scope: Scope }) {
  const [rows, setRows] = useState<api.DecisionItem[]>([]), [err, setErr] = useState('');
  const [owner, setOwner] = useState<Awaited<ReturnType<typeof api.fetchOwnerAlerts>>>([]);
  useEffect(() => { (scope === 'owner' ? api.fetchOwnerAlerts().then(setOwner) : api.fetchDecisions().then(setRows)).catch((e) => setErr(msg(e))); }, [scope]);
  const list = (items: api.DecisionItem[]) => <ul className="space-y-2">{items.map((d) => <li key={`${d.kind}${d.id}`} className="rounded-xl border bg-white p-3 text-sm"><Link to={d.href} className="font-bold text-indigo-700 hover:underline">{d.title}</Link><p className="text-slate-600">{d.detail}</p><p className="text-[11px] text-slate-400">{d.by ?? ''} {when(d.at)}</p></li>)}{!items.length && <li className="text-sm text-emerald-700">لا قرارات معلّقة.</li>}</ul>;
  return <div className="space-y-3">{err && <p role="alert" className="text-sm font-bold text-rose-700">{err}</p>}
    <p className="text-xs text-slate-500">القرار يُتخذ من شاشته الأصلية بآلية الاعتماد المعتادة (لا آلية موازية).</p>
    {scope === 'owner' ? owner.map((b) => <section key={b.branchId}><h3 className="mb-1 font-black">{b.branch}</h3>{list(b.decisions)}</section>) : list(rows)}</div>;
}

export function LiquidityPanel({ scope }: { scope: Scope }) {
  const [one, setOne] = useState<api.LiquidityForecast | null>(null), [owner, setOwner] = useState<Awaited<ReturnType<typeof api.fetchOwnerAlerts>>>([]), [err, setErr] = useState('');
  useEffect(() => { (scope === 'owner' ? api.fetchOwnerAlerts().then(setOwner) : api.fetchLiquidity().then(setOne)).catch((e) => setErr(msg(e))); }, [scope]);
  const view = (f: api.LiquidityForecast) => <div className="space-y-2"><div className="overflow-x-auto"><table className="w-full text-right text-xs"><thead className="text-slate-500"><tr><th className="p-1">الأفق</th><th className="p-1">العملة</th><th className="p-1">نقد مؤكَّد</th><th className="p-1">شيكات مستحقة (مؤكَّد)</th><th className="p-1">إجمالي مؤكَّد</th><th className="p-1">تحصيل متوقَّع</th><th className="p-1">مدفوعات متوقَّعة</th><th className="p-1">إجمالي متوقَّع</th></tr></thead><tbody>
    {f.horizons.flatMap((h) => h.byCurrency.map((r) => <tr key={`${h.days}${r.currency}`} className="border-t font-mono" dir="ltr"><td className="p-1">{h.days}d</td><td className="p-1">{r.currency}</td><td className="p-1">{nf(r.confirmedCash, 2)}</td><td className="p-1">{nf(r.confirmedChequesDue, 2)}</td><td className="p-1 font-bold">{nf(r.confirmedTotal, 2)}</td><td className="p-1 text-slate-500">{nf(r.forecastCollections, 2)}</td><td className="p-1 text-slate-500">{nf(r.forecastPayments, 2)}</td><td className="p-1 font-bold text-slate-600">{nf(r.forecastTotal, 2)}</td></tr>))}
  </tbody></table></div>{f.undatedPayables.length > 0 && <p className="text-xs text-slate-600">التزامات بلا تاريخ استحقاق: {f.undatedPayables.map((p) => `${nf(p.total, 2)} ${p.currency}`).join(' · ')}</p>}
    <ul className="list-disc pe-5 text-xs text-slate-500">{f.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>;
  return <div className="space-y-3">{err && <p role="alert" className="text-sm font-bold text-rose-700">{err}</p>}
    {scope === 'owner' ? owner.map((b) => <section key={b.branchId}><h3 className="mb-1 font-black">{b.branch}</h3>{view(b.liquidity)}</section>) : one && view(one)}</div>;
}

export function SummaryPanel() {
  const [kind, setKind] = useState<'daily' | 'weekly' | 'monthly'>('daily'), [text, setText] = useState(''), [err, setErr] = useState('');
  useEffect(() => { api.fetchSummary(kind).then((r) => setText(r.text)).catch((e) => setErr(msg(e))); }, [kind]);
  return <div className="space-y-3">
    <div className="flex gap-2">{([['daily', 'يومي'], ['weekly', 'أسبوعي'], ['monthly', 'شهري']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-sm font-bold ${kind === k ? 'bg-indigo-600 text-white' : 'border bg-white'}`}>{l}</button>)}</div>
    {err && <p role="alert" className="text-sm font-bold text-rose-700">{err}</p>}
    <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-sm" dir="rtl">{text}</pre>
    <div className="flex gap-2 text-sm"><button type="button" className="inline-flex items-center gap-1 rounded-lg border px-3 py-1" onClick={() => void navigator.clipboard?.writeText(text)}><Copy className="h-4 w-4" />نسخ</button>
      <a className="rounded-lg border px-3 py-1" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>واتساب</a>
      <button type="button" className="inline-flex items-center gap-1 rounded-lg border px-3 py-1" onClick={() => window.print()}><Printer className="h-4 w-4" />طباعة</button></div>
  </div>;
}

export function OversightPanel({ scope }: { scope: Scope }) {
  const [d, setD] = useState<api.Oversight | null>(null), [err, setErr] = useState('');
  useEffect(() => { api.fetchOversight(scope).then(setD).catch((e) => setErr(msg(e))); }, [scope]);
  if (err) return <p role="alert" className="text-sm font-bold text-rose-700">{err}</p>;
  if (!d) return <Loader2 className="h-5 w-5 animate-spin" />;
  return <div className="space-y-5">
    <section><h3 className="mb-1 font-black">المستخدمون والمهام المفتوحة</h3>
      <p className="mb-1 text-xs text-slate-500">آخر نشاط/الاتصال ليس مقياس أداء وحده؛ انظر المهام المفتوحة والمتأخرة. تعديل الصلاحيات: افتح الفرع ثم <Link to="/permissions" className="text-indigo-700 underline">الصلاحيات</Link>.</p>
      <div className="overflow-x-auto"><table className="w-full text-right text-xs"><thead className="text-slate-500"><tr><th className="p-1">المستخدم</th>{scope === 'owner' && <th className="p-1">الفرع</th>}<th className="p-1">الدور / النمط</th><th className="p-1">مسودات بيع/شراء</th><th className="p-1">طلبات إذن</th><th className="p-1">متابعات متأخرة</th><th className="p-1">تنبيهات مُسندة</th><th className="p-1">آخر نشاط</th></tr></thead><tbody>
        {d.users.map((u) => <tr key={u.id} className={`border-t ${u.isActive ? '' : 'opacity-50'}`}><td className="p-1">{u.fullName || u.username}</td>{scope === 'owner' && <td className="p-1">{u.branchName}</td>}<td className="p-1">{u.role} / {u.permMode}{u.permMode === 'CUSTOM' ? ` (${u.grants})` : ''}</td><td className="p-1">{u.open.salesDrafts}/{u.open.purchaseDrafts}</td><td className="p-1">{u.open.editRequests}</td><td className={`p-1 ${u.open.followUpsOverdue ? 'font-bold text-rose-700' : ''}`}>{u.open.followUpsOverdue}</td><td className="p-1">{u.open.alertsAssigned}</td><td className="p-1">{when(u.lastActivityAt)}</td></tr>)}</tbody></table></div></section>
    <section><h3 className="mb-1 font-black">سجل تغييرات الصلاحيات</h3>
      <ul className="space-y-1 text-xs">{d.permissionLog.map((p, i) => <li key={i} className="rounded border p-2">{when(p.at)} · {p.branch} · <b>{p.changed_by}</b> عدّل <b>{p.target}</b> ({p.mode}) — أُضيف {p.added} / أُزيل {p.removed}</li>)}{!d.permissionLog.length && <li className="text-slate-400">لا تغييرات مسجَّلة.</li>}</ul></section>
    <section><h3 className="mb-1 font-black">سجل الاستثناءات الإدارية</h3>
      <ul className="space-y-1 text-xs">{d.exceptions.map((x, i) => <li key={i} className="rounded border p-2">{when(x.at)} · {x.branch} · <b>{x.kind}</b> {x.ref}{x.amount != null ? ` · ${nf(x.amount, 2)} ${x.currency ?? ''}` : ''}{x.user ? ` · ${x.user}` : ''}{x.detail ? ` · ${x.detail}` : ''}</li>)}{!d.exceptions.length && <li className="text-slate-400">لا استثناءات.</li>}</ul></section>
  </div>;
}

/** قسم المالك السرّي: تكلفة إدارية وربحية — لا يظهر إلا لمن يقبله الخادم. */
export function AdminCostPanel({ branchId, period }: { branchId: string; period: PeriodQuery }) {
  const [groups, setGroups] = useState<api.CostGroup[]>([]), [prof, setProf] = useState<api.Profitability | null>(null), [err, setErr] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true), [search, setSearch] = useState(''), [edit, setEdit] = useState<Record<string, string>>({}), [cur, setCur] = useState('USD');
  const load = useCallback(async () => {
    setErr('');
    try { setGroups(await api.fetchCostGroups(branchId, { onlyMissing, search })); setProf(await api.fetchProfitability(branchId, period)); } catch (e) { setErr(msg(e)); }
  }, [branchId, onlyMissing, search, period]);
  useEffect(() => { void load(); }, [load]);
  const gk = (g: api.CostGroup) => `${g.itemId}|${g.colorId ?? ''}`;
  const save = async () => {
    const rates = groups.filter((g) => Number(edit[gk(g)]) > 0).map((g) => ({ scope: (g.colorId ? 'ITEM_COLOR' : 'ITEM') as 'ITEM' | 'ITEM_COLOR', itemId: g.itemId, colorId: g.colorId, unitCostPerMeter: Number(edit[gk(g)]), currency: cur }));
    if (!rates.length) return;
    try { await api.saveCostRates(branchId, rates); setEdit({}); await load(); } catch (e) { setErr(msg(e)); }
  };
  return <div className="space-y-4">
    <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">قسم سرّي للمالك: لا يؤثر على المحاسبة ولا الذمم ولا تقييم المخزون الرسمي. التكلفة تُلتقط لحظة اعتماد البيع ولا تتغير أرباح الماضي بتغيّرها لاحقاً.</p>
    {err && <p role="alert" className="text-sm font-bold text-rose-700">{err}</p>}
    {prof && <section><h3 className="mb-1 font-black">الربحية التقديرية ({prof.period.from} → {prof.period.to})</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{prof.byCurrency.map((r) => <div key={r.currency} className="rounded-xl border p-3 text-sm" dir="ltr"><b>{r.currency}</b><div>إيراد {nf(r.revenue, 2)} · تكلفة {nf(r.cost, 2)}</div><div className="font-bold">ربح {nf(r.profit, 2)}{r.marginPct != null ? ` (${nf(r.marginPct, 1)}%)` : ''}</div><div className="text-xs text-slate-500">سطور مُسعَّرة: {r.pricedLines}</div></div>)}</div>
      {prof.unpriced.length > 0 && <p className="mt-1 text-xs text-amber-800">مبيعات بلا تكلفة إدارية (مستبعدة من الربح — لا صفر مُختلَق): {prof.unpriced.map((u) => `${u.lines} سطر / ${nf(u.revenue, 2)} ${u.currency}`).join(' · ')}</p>}
      {prof.currencyMismatch > 0 && <p className="text-xs text-amber-800">{prof.currencyMismatch} سطراً بعملة تكلفة مختلفة عن عملة البيع — مستبعدة (لا تحويل).</p>}
      <ul className="list-disc pe-5 text-xs text-slate-500">{prof.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></section>}
    <section><h3 className="mb-1 font-black">تسعير التكلفة الإدارية (للمتر)</h3>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><label><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> الناقص فقط</label>
        <input placeholder="بحث صنف" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded border px-2 py-1" />
        <input value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} className="w-20 rounded border px-2 py-1" dir="ltr" />
        <button type="button" onClick={() => void save()} className="rounded-lg bg-indigo-600 px-3 py-1 font-bold text-white">حفظ المُدخَل</button></div>
      <div className="max-h-96 overflow-auto"><table className="w-full text-right text-xs"><thead className="text-slate-500"><tr><th className="p-1">الصنف</th><th className="p-1">اللون</th><th className="p-1">أتواب</th><th className="p-1">أمتار</th><th className="p-1">التكلفة الحالية</th><th className="p-1">جديد/م</th></tr></thead><tbody>
        {groups.map((g) => <tr key={gk(g)} className="border-t"><td className="p-1">{g.itemName}</td><td className="p-1">{g.colorName ?? '—'}</td><td className="p-1">{g.rolls}</td><td className="p-1">{nf(g.meters, 1)}</td><td className="p-1" dir="ltr">{g.adminRate ? `${nf(g.adminRate.unitCostPerMeter, 4)} ${g.adminRate.currency}` : <span className="text-amber-700">غير مُسعَّر</span>}</td><td className="p-1"><input type="number" step="0.0001" min="0" value={edit[gk(g)] ?? ''} onChange={(e) => setEdit({ ...edit, [gk(g)]: e.target.value })} className="w-24 rounded border px-1" dir="ltr" /></td></tr>)}</tbody></table></div></section>
  </div>;
}
