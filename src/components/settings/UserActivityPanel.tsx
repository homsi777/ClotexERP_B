import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, RefreshCw, RotateCcw, ShieldOff, Trash2 } from 'lucide-react';
import {
  blockSystemUser, deleteSystemUser, fetchSessionLog, fetchUsersPresence, restoreSystemUser, unblockSystemUser,
  type PresenceRowDto, type SessionLogRowDto,
} from '../../lib/api/settingsApi';
import { useToast } from '../NonBlockingToast';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }) : '—');
/** مدة مقروءة: ساعات ودقائق (وثوانٍ للقصير جداً). */
export const fmtDuration = (sec: number) => {
  if (!sec || sec < 1) return '0 ث';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h ? `${h} س` : '', m ? `${m} د` : '', !h && !m ? `${s} ث` : ''].filter(Boolean).join(' ');
};
const END_LABEL: Record<string, string> = { LOGOUT: 'خروج يدوي', REVOKED: 'أُنهيت من المدير', BLOCKED: 'حظر الحساب', DELETED: 'حذف الحساب', TIMEOUT: 'انتهت بالخمول' };

type StatusFilter = 'all' | 'online' | 'offline' | 'blocked' | 'stopped' | 'deleted';

function Badge({ tone, children }: { tone: 'green' | 'slate' | 'red' | 'amber'; children: React.ReactNode }) {
  const cls = { green: 'bg-emerald-100 text-emerald-700', slate: 'bg-slate-100 text-slate-600', red: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-800' }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${cls}`}>{children}</span>;
}

/** كل المستخدمين (النشط وغير النشط والمحظور والمحذوف) مع الاتصال ووقت الاستخدام وأفعال الحظر والحذف. */
export const UserActivityPanel: React.FC<{ selfId?: string }> = ({ selfId }) => {
  const { showToast } = useToast();
  const [rows, setRows] = useState<PresenceRowDto[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all'), [from, setFrom] = useState(''), [to, setTo] = useState(''), [log, setLog] = useState<PresenceRowDto | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchUsersPresence({ from: from || undefined, to: to || undefined, includeDeleted: true })); }
    catch (e) { showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر التحميل' }); }
    finally { setLoading(false); }
  }, [from, to, showToast]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => rows.filter((r) => {
    if (status === 'online') return r.online;
    if (status === 'offline') return !r.online && !r.deleted && !r.blocked && r.isActive;
    if (status === 'blocked') return r.blocked && !r.deleted;
    if (status === 'stopped') return !r.isActive && !r.blocked && !r.deleted;
    if (status === 'deleted') return r.deleted;
    return true;
  }), [rows, status]);
  const counts = useMemo(() => ({ online: rows.filter((r) => r.online).length, blocked: rows.filter((r) => r.blocked && !r.deleted).length, deleted: rows.filter((r) => r.deleted).length }), [rows]);

  const act = async (r: PresenceRowDto, kind: 'block' | 'unblock' | 'delete' | 'restore') => {
    let reason: string | undefined;
    if (kind === 'block') { const x = window.prompt(`سبب حظر «${r.username}» (اختياري)`); if (x === null) return; reason = x; }
    else if (kind === 'delete' && !window.confirm(`حذف «${r.username}»؟ يُخفى ويُمنع من الدخول وتبقى كل سجلاته سليمة، ويمكن استعادته لاحقاً.`)) return;
    else if (kind === 'unblock' && !window.confirm(`إلغاء حظر «${r.username}»؟`)) return;
    setBusy(r.id);
    try {
      if (kind === 'block') await blockSystemUser(r.id, reason); else if (kind === 'unblock') await unblockSystemUser(r.id);
      else if (kind === 'delete') await deleteSystemUser(r.id); else await restoreSystemUser(r.id);
      showToast({ type: 'success', message: 'تم التنفيذ' }); await load();
    } catch (e) { showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر التنفيذ' }); } finally { setBusy(''); }
  };

  return <div className="space-y-3" dir="rtl">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {([['all', 'الكل'], ['online', `متصل (${counts.online})`], ['offline', 'غير متصل'], ['blocked', `محظور (${counts.blocked})`], ['stopped', 'موقوف'], ['deleted', `محذوف (${counts.deleted})`]] as Array<[StatusFilter, string]>).map(([k, l]) =>
        <button key={k} type="button" onClick={() => setStatus(k)} className={`rounded-full border px-3 py-1 font-bold ${status === k ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{l}</button>)}
      <span className="mr-auto flex items-center gap-1 text-xs text-slate-500">وقت الاستخدام من <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border px-2 py-1" /> إلى <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border px-2 py-1" /></span>
      <button type="button" onClick={() => void load()} className="rounded-lg border px-3 py-1"><RefreshCw className={`inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>
    <div className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-white">
      <table className="min-w-full text-sm"><thead className="bg-slate-50 text-slate-600"><tr>
        <th className="p-3 text-right">المستخدم</th><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">آخر دخول</th><th className="p-3 text-right">آخر نشاط</th><th className="p-3 text-right">جلسات / مدة الاستخدام</th><th className="p-3 text-center">إجراء</th></tr></thead><tbody>
        {shown.map((r) => {
          const self = r.id === selfId;
          return <tr key={r.id} className={`border-t border-slate-100 ${r.deleted ? 'opacity-60' : ''}`}>
            <td className="p-3 font-bold">{r.fullName || r.username}<div className="font-mono text-xs text-slate-500">{r.username} · {r.role}</div></td>
            <td className="p-3 space-y-1">
              {r.deleted ? <Badge tone="slate">محذوف</Badge> : r.blocked ? <Badge tone="red">محظور</Badge> : !r.isActive ? <Badge tone="amber">موقوف</Badge> : r.online ? <Badge tone="green">متصل الآن</Badge> : <Badge tone="slate">غير متصل</Badge>}
              {r.blocked && r.blockReason && <div className="text-xs text-rose-700">{r.blockReason}</div>}
            </td>
            <td className="p-3 text-xs">{when(r.lastLoginAt)}</td><td className="p-3 text-xs">{when(r.lastSeenAt)}</td>
            <td className="p-3 text-xs"><b>{r.sessionsInPeriod}</b> جلسة · <b>{fmtDuration(r.secondsInPeriod)}</b> <button type="button" className="mr-1 underline text-indigo-700" onClick={() => setLog(r)}>السجل</button></td>
            <td className="p-3 text-center whitespace-nowrap">
              {self ? <span className="text-xs text-slate-400">حسابك</span> : r.deleted
                ? <button type="button" disabled={busy === r.id} onClick={() => void act(r, 'restore')} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold"><RotateCcw className="h-3.5 w-3.5" />استعادة</button>
                : <>
                  {r.blocked
                    ? <button type="button" disabled={busy === r.id} onClick={() => void act(r, 'unblock')} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700"><ShieldOff className="h-3.5 w-3.5" />إلغاء الحظر</button>
                    : <button type="button" disabled={busy === r.id} onClick={() => void act(r, 'block')} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800"><Ban className="h-3.5 w-3.5" />حظر</button>}
                  <button type="button" disabled={busy === r.id} onClick={() => void act(r, 'delete')} className="mr-1 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700"><Trash2 className="h-3.5 w-3.5" />حذف</button></>}
            </td></tr>;
        })}
        {!shown.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">{loading ? 'جارٍ التحميل…' : 'لا مستخدمون بهذه الحالة.'}</td></tr>}
      </tbody></table>
    </div>
    {log && <SessionLogDialog user={log} from={from} to={to} onClose={() => setLog(null)} />}
  </div>;
};

/** سجل الدخول والخروج: متى دخل ومتى خرج وكم قضى، ولماذا انتهت الجلسة. */
export const SessionLogDialog: React.FC<{ user?: PresenceRowDto; from?: string; to?: string; onClose?: () => void }> = ({ user, from, to, onClose }) => {
  const [rows, setRows] = useState<SessionLogRowDto[]>([]), [loading, setLoading] = useState(true), [f, setF] = useState(from ?? ''), [t, setT] = useState(to ?? '');
  useEffect(() => { setLoading(true); fetchSessionLog({ userId: user?.id, from: f || undefined, to: t || undefined, limit: 300 }).then(setRows).catch(() => setRows([])).finally(() => setLoading(false)); }, [user?.id, f, t]);
  const total = rows.reduce((a, r) => a + r.durationSec, 0);
  const body = <div className="space-y-2" dir="rtl">
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">من <input type="date" value={f} onChange={(e) => setF(e.target.value)} className="rounded border px-2 py-1" /> إلى <input type="date" value={t} onChange={(e) => setT(e.target.value)} className="rounded border px-2 py-1" />
      <span className="mr-auto font-bold">{rows.length} جلسة · الإجمالي {fmtDuration(total)}</span></div>
    <div className="max-h-[55vh] overflow-auto rounded-xl border"><table className="min-w-full text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-600"><tr>
      {!user && <th className="p-2 text-right">المستخدم</th>}<th className="p-2 text-right">دخول</th><th className="p-2 text-right">خروج / آخر نشاط</th><th className="p-2 text-right">المدة</th><th className="p-2 text-right">السبب</th><th className="p-2 text-right">الجهاز / IP</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id} className="border-t">
        {!user && <td className="p-2 font-bold">{r.fullName || r.username}</td>}
        <td className="p-2">{when(r.connectedAt)}</td>
        <td className="p-2">{r.live ? <span className="font-bold text-emerald-700">متصل الآن</span> : when(r.endedAt ?? r.lastSeenAt)}</td>
        <td className="p-2 font-bold">{fmtDuration(r.durationSec)}</td>
        <td className="p-2">{r.live ? '—' : END_LABEL[r.endReason ?? ''] ?? r.endReason}</td>
        <td className="p-2 font-mono" dir="ltr">{r.platform ?? ''} {r.ip ?? ''}</td></tr>)}
      {!rows.length && <tr><td colSpan={6} className="p-5 text-center text-slate-500">{loading ? 'جارٍ التحميل…' : 'لا جلسات مسجَّلة (السجل يبدأ من تاريخ تفعيل الميزة).'}</td></tr>}</tbody></table></div>
    <p className="text-[11px] text-slate-500">مدة الجلسة = من الدخول إلى الخروج؛ وإن انتهت بالخمول (5 دقائق بلا نشاط) تُحسب حتى آخر نشاط.</p>
  </div>;
  if (!user) return body;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl" dir="rtl">
    <div className="mb-3 flex items-center justify-between"><b className="text-lg">سجل دخول {user.fullName || user.username}</b><button type="button" onClick={onClose} className="rounded-lg border px-3 py-1 text-sm font-bold">إغلاق</button></div>{body}</div></div>;
};
