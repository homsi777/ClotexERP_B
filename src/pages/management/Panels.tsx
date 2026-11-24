import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Loader2, Printer, RefreshCw } from 'lucide-react';
import * as api from '../../lib/api/managementApi';
import { fetchChatPeers } from '../../lib/api/chatApi';
import type { AlertRow, AlertSettings, AlertType } from '../../lib/api/managementApi';
import { ErrorLine, errMsg, nf, when } from './kit';

const sevLbl: Record<string, string> = { HIGH: 'عالية', MEDIUM: 'متوسطة', LOW: 'منخفضة' };
const sevTone: Record<string, string> = { HIGH: 'bad', MEDIUM: 'warn', LOW: 'neutral' };

function AlertItem({ a, users, onAct }: { a: AlertRow; users: Array<{ id: string; name: string }>; onAct: (a: AlertRow, action: 'ack' | 'snooze' | 'note' | 'reopen' | 'assign', extra?: { until?: string; note?: string; assigneeUserId?: string | null }) => void }) {
  const [snooze, setSnooze] = useState('');
  return <li className="cx-card p-3 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5"><span className={`cx-badge ${sevTone[a.severity]}`}>{sevLbl[a.severity]}</span><span className="cx-badge neutral">{a.department}</span>
          {a.status !== 'OPEN' && <span className="cx-badge neutral">{a.status === 'ACKNOWLEDGED' ? 'تم الاطلاع' : a.status === 'SNOOZED' ? 'مؤجَّل' : a.status}</span>}</div>
        <Link to={a.href} className="block font-bold hover:underline" style={{ color: 'var(--cx-brand)' }}>{a.title}</Link>
        <p className="cx-muted text-xs"><b>السبب:</b> {a.detail}</p>
      </div>
      <div className="cx-noprint flex flex-wrap items-center gap-1 text-xs">
        {a.status === 'OPEN' && <button type="button" className="cx-btn" onClick={() => onAct(a, 'ack')}>اطلعت</button>}
        {(a.status === 'SNOOZED' || a.status === 'ACKNOWLEDGED') && <button type="button" className="cx-btn" onClick={() => onAct(a, 'reopen')}>إعادة فتح</button>}
        <button type="button" className="cx-btn" onClick={() => { const n = window.prompt('الملاحظة'); if (n) onAct(a, 'note', { note: n }); }}>ملاحظة</button>
      </div>
    </div>
    <div className="cx-noprint mt-2 flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1">إسناد إلى
        <select className="cx-input" value={a.assigneeUserId ?? ''} onChange={(e) => onAct(a, 'assign', { assigneeUserId: e.target.value || null })}><option value="">— لا أحد —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="flex items-center gap-1">تأجيل حتى <input type="date" className="cx-input" value={snooze} min={new Date(Date.now() + 864e5).toISOString().slice(0, 10)} onChange={(e) => setSnooze(e.target.value)} /></label>
      <button type="button" className="cx-btn" disabled={!snooze} onClick={() => { onAct(a, 'snooze', { until: snooze }); setSnooze(''); }}>تأجيل</button>
    </div>
    <p className="cx-muted mt-1 text-[.68rem]">{a.assigneeName ? `المسؤول: ${a.assigneeName} · ` : ''}{a.status === 'SNOOZED' ? `مؤجَّل حتى ${a.snoozedUntil} · ` : ''}أول ظهور {when(a.firstSeenAt)}{a.updatedByName ? ` · آخر إجراء: ${a.updatedByName} (${when(a.updatedAt)})` : ''}{a.note ? ` · ملاحظة: ${a.note}` : ''}</p>
  </li>;
}

function RulesEditor({ types, settings, onSave }: { types: AlertType[]; settings: AlertSettings; onSave: (s: Partial<AlertSettings>) => Promise<void> }) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const toggle = (list: 'disabledTypes' | 'enabledOptionalTypes', t: string) => setS({ ...s, [list]: s[list].includes(t) ? s[list].filter((x) => x !== t) : [...s[list], t] });
  return <details className="cx-card p-3 text-sm"><summary className="cursor-pointer font-bold">قواعد التنبيهات لهذا الفرع</summary>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {([['inactiveCustomerDays', 'أيام خمول العميل'], ['slowStockDays', 'أيام ركود المخزون'], ['externalLateDays', 'أيام تأخر المصنعية الخارجية'], ['draftAgeDays', 'عمر المسودة (أيام)'], ['chequeDueSoonDays', 'أيام قرب استحقاق الشيك']] as Array<[keyof AlertSettings, string]>).map(([k, l]) =>
        <label key={k} className="flex items-center justify-between gap-2">{l}<input type="number" min={1} className="cx-input w-24" value={Number(s[k])} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} /></label>)}
    </div>
    <div className="mt-3 space-y-1">
      <b className="text-xs">أنواع التنبيهات (أوقف ما لا تحتاجه)</b>
      {types.map((t) => t.optional
        ? <label key={t.type} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.enabledOptionalTypes.includes(t.type)} onChange={() => toggle('enabledOptionalTypes', t.type)} />{t.label} <span className="cx-muted">— مطفأ افتراضياً</span></label>
        : <label key={t.type} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!s.disabledTypes.includes(t.type)} onChange={() => toggle('disabledTypes', t.type)} />{t.label} <span className="cx-muted">({t.dept})</span></label>)}
    </div>
    <button type="button" className="cx-btn cx-btn-primary mt-3" onClick={() => void onSave(s)}>حفظ القواعد</button>
  </details>;
}

/** مركز التنبيهات: الفرع يعالج تنبيهاته، والمالك يعالج تنبيهات أي فرع مباشرةً دون تبديله (يُسجَّل المنفِّذ والفرع). */
export function AlertsPanel({ scope, branchId, branchName }: { scope: api.Scope; branchId?: string; branchName?: string }) {
  const [owner, setOwner] = useState<Awaited<ReturnType<typeof api.fetchOwnerAlerts>>>([]);
  const [rows, setRows] = useState<AlertRow[]>([]), [types, setTypes] = useState<AlertType[]>([]), [settings, setSettings] = useState<AlertSettings | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [sev, setSev] = useState(''), [dept, setDept] = useState('');
  const bid = scope === 'owner' ? branchId : undefined;
  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      if (scope === 'owner') {
        const all = await api.fetchOwnerAlerts(); setOwner(all);
        if (bid) { const s = await api.ownerAlertSettings(bid); setSettings(s.settings); setTypes(s.types); setUsers(await api.fetchBranchUsers(bid)); }
      } else {
        const r = await api.fetchAlerts('ACTIVE'); setRows(r.alerts); setTypes(r.types);
        setSettings((await api.fetchAlertSettings()).settings);
        const peers = await fetchChatPeers().catch(() => null);
        setUsers((peers?.data.peers ?? []).filter((p) => p.kind === 'user').map((p) => ({ id: p.key, name: p.name })));
      }
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }, [scope, bid]);
  useEffect(() => { void load(); }, [load]);

  const act = async (branch: string | null, a: AlertRow, action: 'ack' | 'snooze' | 'note' | 'reopen' | 'assign', extra: { until?: string; note?: string; assigneeUserId?: string | null } = {}) => {
    try {
      const body = { key: a.key, action, ...extra };
      if (scope === 'owner' && branch) await api.ownerAlertAction(branch, body); else await api.alertAction(body);
      await load();
    } catch (e) { setErr(errMsg(e)); }
  };
  const saveRules = async (s: Partial<AlertSettings>) => { try { if (scope === 'owner' && bid) await api.ownerSaveAlertSettings(bid, s); else await api.saveAlertSettings(s); await load(); } catch (e) { setErr(errMsg(e)); } };
  const filt = (l: AlertRow[]) => l.filter((a) => (!sev || a.severity === sev) && (!dept || a.department === dept));
  const depts = [...new Set(types.map((t) => t.dept))];
  const list = (l: AlertRow[], branch: string | null, us: Array<{ id: string; name: string }>) => <ul className="space-y-2">{filt(l).map((a) => <AlertItem key={a.key} a={a} users={us} onAct={(x, ac, ex) => void act(branch, x, ac, ex)} />)}{!filt(l).length && <li className="text-sm" style={{ color: 'var(--cx-good)' }}>لا تنبيهات نشطة.</li>}</ul>;
  return <div className="space-y-3">
    <div className="cx-noprint flex flex-wrap items-center gap-2">
      <select value={sev} onChange={(e) => setSev(e.target.value)} className="cx-input"><option value="">كل الأهميات</option><option value="HIGH">عالية</option><option value="MEDIUM">متوسطة</option><option value="LOW">منخفضة</option></select>
      <select value={dept} onChange={(e) => setDept(e.target.value)} className="cx-input"><option value="">كل الأقسام</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
      <button type="button" onClick={() => void load()} className="cx-btn">{busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : <RefreshCw className="inline h-4 w-4" />}</button>
    </div>
    <ErrorLine msg={err} />
    {scope === 'owner'
      ? owner.map((b) => <section key={b.branchId} className="space-y-2"><h3 className="font-black" style={{ color: 'var(--cx-brand)' }}>{b.branch} <span className="cx-badge neutral">{b.alerts.length}</span></h3>{list(b.alerts, b.branchId, b.branchId === bid ? users : [])}</section>)
      : list(rows, null, users)}
    {scope === 'owner' && <p className="cx-muted text-xs">الإسناد متاح لتنبيهات الفرع المختار فقط ({branchName ?? '—'}). التأجيل والملاحظة والاطلاع لأي فرع مباشرةً، ويُسجَّل المنفِّذ.</p>}
    {settings && (scope === 'branch' || bid) && <RulesEditor types={types} settings={settings} onSave={saveRules} />}
  </div>;
}

export function DecisionsPanel({ scope, branchId }: { scope: api.Scope; branchId?: string }) {
  const [rows, setRows] = useState<api.DecisionItem[]>([]), [owner, setOwner] = useState<Awaited<ReturnType<typeof api.fetchOwnerAlerts>>>([]), [err, setErr] = useState('');
  useEffect(() => { (scope === 'owner' ? api.fetchOwnerAlerts().then(setOwner) : api.fetchDecisions().then(setRows)).catch((e) => setErr(errMsg(e))); }, [scope]);
  const kindLbl: Record<string, string> = { EDIT_REQUEST: 'طلب إذن تعديل', WASTE_DRAFT: 'إهلاك مادي', PRICING: 'تسعير', TRANSFER_DRAFT: 'مناقلة' };
  const list = (items: api.DecisionItem[], linked: boolean) => <ul className="space-y-2">{items.map((d) => <li key={`${d.kind}${d.id}`} className="cx-card p-3 text-sm"><div className="flex items-center gap-2"><span className="cx-badge neutral">{kindLbl[d.kind] ?? d.kind}</span>{linked ? <Link to={d.href} className="font-bold hover:underline" style={{ color: 'var(--cx-brand)' }}>{d.title}</Link> : <b>{d.title}</b>}</div><p className="cx-muted text-xs">{d.detail}</p><p className="cx-muted text-[.68rem]">{d.by ?? ''} {when(d.at)}</p></li>)}{!items.length && <li className="text-sm" style={{ color: 'var(--cx-good)' }}>لا قرارات معلّقة.</li>}</ul>;
  return <div className="space-y-3"><ErrorLine msg={err} /><p className="cx-muted text-xs">القرار يُتخذ من شاشته الأصلية بآلية الاعتماد المعتادة (لا آلية موازية).</p>
    {scope === 'owner' ? owner.map((b) => <section key={b.branchId}><h3 className="mb-1 font-black" style={{ color: 'var(--cx-brand)' }}>{b.branch}</h3>{list(b.decisions, !branchId || b.branchId === branchId)}</section>) : list(rows, true)}</div>;
}

export function LiquidityPanel({ scope, branchId }: { scope: api.Scope; branchId?: string }) {
  const [one, setOne] = useState<api.LiquidityForecast | null>(null), [owner, setOwner] = useState<Awaited<ReturnType<typeof api.fetchOwnerAlerts>>>([]), [err, setErr] = useState('');
  useEffect(() => { (scope === 'owner' ? api.fetchOwnerAlerts().then(setOwner) : api.fetchLiquidity().then(setOne)).catch((e) => setErr(errMsg(e))); }, [scope]);
  const linked = scope === 'branch' || false;
  const view = (f: api.LiquidityForecast, canLink: boolean) => {
    const L = ({ to, children }: { to: string; children: React.ReactNode }) => canLink ? <Link to={to} className="underline decoration-dotted">{children}</Link> : <>{children}</>;
    return <div className="space-y-2"><div className="cx-card overflow-x-auto p-2"><table className="cx-tbl"><thead><tr><th>الأفق</th><th>العملة</th><th>نقد مؤكَّد</th><th>شيكات مستحقة (مؤكَّد)</th><th>إجمالي مؤكَّد</th><th>تحصيل متوقَّع</th><th>مدفوعات متوقَّعة</th><th>إجمالي متوقَّع</th></tr></thead><tbody>
      {f.horizons.flatMap((h) => h.byCurrency.map((r) => <tr key={`${h.days}${r.currency}`} className="num"><td>{h.days} يوماً</td><td>{r.currency}</td><td><L to="/treasury/safes">{nf(r.confirmedCash, 2)}</L></td><td><L to="/treasury/checks-vault">{nf(r.confirmedChequesDue, 2)}</L></td><td className="font-bold">{nf(r.confirmedTotal, 2)}</td><td><L to="/customers/balances">{nf(r.forecastCollections, 2)}</L></td><td><L to="/suppliers/balances">{nf(r.forecastPayments, 2)}</L></td><td className="font-bold">{nf(r.forecastTotal, 2)}</td></tr>))}</tbody></table></div>
      {f.undatedPayables.length > 0 && <p className="cx-muted text-xs">التزامات بلا تاريخ استحقاق: {f.undatedPayables.map((p) => `${nf(p.total, 2)} ${p.currency}`).join(' · ')}</p>}
      <ul className="cx-muted list-disc pe-5 text-xs">{f.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>;
  };
  void linked;
  return <div className="space-y-3"><ErrorLine msg={err} /><p className="cx-muted text-xs">المصادر: النقد = أرصدة الصناديق، الشيكات = استحقاقات الشيكات المقبوضة، المتوقَّع = ذمم العملاء/الموردين بمواعيد التحصيل/السداد المسجَّلة. اضغط الرقم للانتقال لمصدره.</p>
    {scope === 'owner' ? owner.filter((b) => !branchId || b.branchId === branchId).map((b) => <section key={b.branchId}><h3 className="mb-1 font-black" style={{ color: 'var(--cx-brand)' }}>{b.branch}</h3>{view(b.liquidity, false)}</section>) : one && view(one, true)}</div>;
}

export function SummaryPanel({ scope, branchId }: { scope: api.Scope; branchId?: string }) {
  const [kind, setKind] = useState<'daily' | 'weekly' | 'monthly'>('daily'), [text, setText] = useState(''), [err, setErr] = useState('');
  useEffect(() => {
    setText('');
    (scope === 'owner' ? (branchId ? api.fetchOwnerSummary(branchId, kind) : Promise.reject(new Error('اختر فرعاً'))) : api.fetchSummary(kind)).then((r) => setText(r.text)).catch((e) => setErr(errMsg(e)));
  }, [kind, scope, branchId]);
  const download = () => { const blob = new Blob([text], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `summary-${kind}.txt`; a.click(); URL.revokeObjectURL(a.href); };
  return <div className="space-y-3">
    <div className="cx-hscroll">{([['daily', 'يومي'], ['weekly', 'أسبوعي'], ['monthly', 'شهري']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} className="cx-chip" onClick={() => setKind(k)}>{l}</button>)}</div>
    <ErrorLine msg={err} />
    <pre className="cx-card whitespace-pre-wrap p-3 text-sm" dir="rtl" style={{ fontFamily: 'inherit' }}>{text || '…'}</pre>
    <div className="cx-noprint flex flex-wrap gap-2"><button type="button" className="cx-btn" onClick={() => void navigator.clipboard?.writeText(text)}><Copy className="inline h-4 w-4" /> نسخ</button>
      <a className="cx-btn" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>واتساب</a>
      <a className="cx-btn" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=%20&text=${encodeURIComponent(text)}`}>تيليجرام</a>
      <button type="button" className="cx-btn" onClick={download}>تنزيل (نص)</button>
      <button type="button" className="cx-btn" onClick={() => window.print()}><Printer className="inline h-4 w-4" /> طباعة</button></div>
  </div>;
}

export function OversightPanel({ scope }: { scope: api.Scope }) {
  const [d, setD] = useState<api.Oversight | null>(null), [err, setErr] = useState('');
  useEffect(() => { api.fetchOversight(scope).then(setD).catch((e) => setErr(errMsg(e))); }, [scope]);
  if (err) return <ErrorLine msg={err} />;
  if (!d) return <Loader2 className="h-5 w-5 animate-spin" />;
  return <div className="space-y-5">
    <section><h3 className="mb-1 font-black" style={{ color: 'var(--cx-brand)' }}>المسؤوليات والمهام المفتوحة</h3>
      <p className="cx-muted mb-1 text-xs">لا يُقاس الأداء بحالة الاتصال أو آخر نشاط وحدهما؛ انظر المهام المفتوحة والمتأخرة. تعديل الصلاحيات من شاشة <Link to="/permissions" className="underline">الصلاحيات</Link> داخل الفرع المعني (لا تُعدَّل من هنا).</p>
      <div className="cx-card overflow-x-auto p-2"><table className="cx-tbl"><thead><tr><th>المستخدم</th>{scope === 'owner' && <th>الفرع</th>}<th>الدور / النمط</th><th>مسودات بيع/شراء</th><th>طلبات إذن</th><th>متابعات تحصيل متأخرة</th><th>تنبيهات مُسندة</th><th>آخر نشاط</th></tr></thead><tbody>
        {d.users.map((u) => <tr key={u.id} style={{ opacity: u.isActive ? 1 : .5 }}><td>{u.fullName || u.username}</td>{scope === 'owner' && <td>{u.branchName}</td>}<td>{u.role} / {u.permMode}{u.permMode === 'CUSTOM' ? ` (${u.grants})` : ''}</td><td className="num">{u.open.salesDrafts}/{u.open.purchaseDrafts}</td><td className="num">{u.open.editRequests}</td><td className="num" style={u.open.followUpsOverdue ? { color: 'var(--cx-bad)', fontWeight: 800 } : undefined}>{u.open.followUpsOverdue}</td><td className="num">{u.open.alertsAssigned}</td><td>{when(u.lastActivityAt)}</td></tr>)}</tbody></table></div></section>
    <section><h3 className="mb-1 font-black" style={{ color: 'var(--cx-brand)' }}>سجل تغييرات الصلاحيات</h3>
      <ul className="space-y-1 text-xs">{d.permissionLog.map((p, i) => <li key={i} className="cx-card p-2">{when(p.at)} · {p.branch} · <b>{p.changed_by}</b> عدّل <b>{p.target}</b> ({p.mode}) — أُضيف {p.added} / أُزيل {p.removed}</li>)}{!d.permissionLog.length && <li className="cx-muted">لا تغييرات مسجَّلة.</li>}</ul></section>
    <section><h3 className="mb-1 font-black" style={{ color: 'var(--cx-brand)' }}>سجل الاستثناءات الإدارية والتعديلات الحساسة</h3>
      <ul className="space-y-1 text-xs">{d.exceptions.map((x, i) => <li key={i} className="cx-card p-2">{when(x.at)} · {x.branch} · <b>{x.kind}</b> {x.ref}{x.amount != null ? ` · ${nf(x.amount, 2)} ${x.currency ?? ''}` : ''}{x.user ? ` · ${x.user}` : ''}{x.detail ? ` · ${x.detail}` : ''}</li>)}{!d.exceptions.length && <li className="cx-muted">لا استثناءات.</li>}</ul></section>
  </div>;
}
