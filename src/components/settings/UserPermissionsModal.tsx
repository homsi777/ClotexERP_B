import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import {
  getPermissionCatalog,
  getUserPermissions,
  saveUserPermissionMatrix,
  type PermissionCatalog,
  type UserPermissionsDto,
} from '../../lib/api/settingsApi';

const ACTION_ORDER = ['view', 'create', 'edit', 'delete', 'approve', 'disburse', 'price', 'costView', 'print', 'export'] as const;

const TEXT = {
  ar: {
    title: 'صلاحيات المستخدم', modeRole: 'حسب الدور (الوضع الافتراضي)', modeCustom: 'صلاحيات مخصّصة (مصفوفة)',
    roleHint: 'يعمل المستخدم حسب دوره كما كان تماماً.', customHint: 'يُحصر المستخدم بما تظلّله هنا فقط. كل صلاحية كتابة تمنح العرض تلقائياً، والخادم يرفض أي إجراء غير مظلَّل حتى لو فُتحت الصفحة.',
    presets: 'قوالب سريعة', all: 'كل الصلاحيات', readOnly: 'قراءة فقط', noFinance: 'بدون بيانات مالية', clear: 'مسح الكل',
    financial: 'مالي', search: 'بحث عن وحدة…', save: 'حفظ الصلاحيات', cancel: 'إلغاء', saving: 'جارٍ الحفظ…', saved: 'تم حفظ الصلاحيات',
    selected: 'المظلَّل', history: 'آخر التغييرات', by: 'بواسطة', added: 'أُضيف', removed: 'أُزيل', loadFailed: 'تعذر تحميل الصلاحيات',
    module: 'الوحدة', rowAll: 'الكل', adminNote: 'مدير النظام لا يُقيَّد.', financialCount: 'وحدات مالية ممنوحة',
  },
  tr: {
    title: 'Kullanıcı yetkileri', modeRole: 'Role göre (varsayılan)', modeCustom: 'Özel yetkiler (matris)',
    roleHint: 'Kullanıcı eskisi gibi rolüne göre çalışır.', customHint: 'Kullanıcı yalnızca burada işaretlenenlerle sınırlıdır. Yazma yetkisi görüntülemeyi otomatik verir; sunucu işaretsiz işlemi reddeder.',
    presets: 'Hızlı şablonlar', all: 'Tüm yetkiler', readOnly: 'Salt okunur', noFinance: 'Mali veri yok', clear: 'Temizle',
    financial: 'mali', search: 'Modül ara…', save: 'Yetkileri kaydet', cancel: 'İptal', saving: 'Kaydediliyor…', saved: 'Yetkiler kaydedildi',
    selected: 'Seçili', history: 'Son değişiklikler', by: 'yapan', added: 'eklenen', removed: 'kaldırılan', loadFailed: 'Yetkiler yüklenemedi',
    module: 'Modül', rowAll: 'Hepsi', adminNote: 'Sistem yöneticisi kısıtlanamaz.', financialCount: 'verilen mali modül',
  },
} as const;

export const UserPermissionsModal: React.FC<{
  user: { id: string; username: string; full_name: string | null; role: string };
  onClose: () => void;
  onSaved: (mode: 'ROLE' | 'CUSTOM') => void;
}> = ({ user, onClose, onSaved }) => {
  const { i18n } = useTranslation();
  const L = TEXT[i18n.language === 'tr' ? 'tr' : 'ar'];
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [data, setData] = useState<UserPermissionsDto | null>(null);
  const [mode, setMode] = useState<'ROLE' | 'CUSTOM'>('ROLE');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    let active = true;
    Promise.all([getPermissionCatalog(), getUserPermissions(user.id)])
      .then(([c, d]) => { if (!active) return; setCatalog(c); setData(d); setMode(d.mode); setCodes(new Set(d.codes)); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : L.loadFailed); });
    return () => { active = false; };
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const code = (m: string, a: string) => `p:${m}.${a}`;
  const toggle = (c: string, on: boolean) => setCodes((prev) => { const n = new Set(prev); if (on) n.add(c); else n.delete(c); return n; });
  const setMany = (list: string[], on: boolean) => setCodes((prev) => { const n = new Set(prev); for (const c of list) { if (on) n.add(c); else n.delete(c); } return n; });

  const modules = catalog?.modules ?? [];
  const visibleModules = useMemo(() => modules.filter((m) => !filter.trim() || m.name.includes(filter.trim())), [modules, filter]);
  const modCodes = (m: PermissionCatalog['modules'][number]) => m.actions.map((a) => code(m.code, a));
  const colAll = (a: string, list: PermissionCatalog['modules']) => list.filter((m) => m.actions.includes(a as never)).map((m) => code(m.code, a));

  const preset = (kind: 'all' | 'read' | 'noFinance' | 'clear') => {
    const next = new Set<string>();
    for (const m of modules) for (const a of m.actions) {
      if (kind === 'all') next.add(code(m.code, a));
      else if (kind === 'read' && a === 'view') next.add(code(m.code, a));
      else if (kind === 'noFinance' && !m.financial) next.add(code(m.code, a));
    }
    setCodes(next);
  };

  const financialGranted = modules.filter((m) => m.financial && codes.has(code(m.code, 'view'))).length;

  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await saveUserPermissionMatrix(user.id, { mode, codes: mode === 'CUSTOM' ? [...codes] : [] });
      setMessage(L.saved);
      onSaved(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={L.title}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-[var(--surface-header,#fff)] shadow-2xl" dir={i18n.language === 'tr' ? 'ltr' : 'rtl'}>
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <div>
              <h3 className="text-lg font-black">{L.title}: {user.full_name || user.username}</h3>
              <p className="text-xs text-slate-500 font-mono">{user.username} · {user.role}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={L.cancel} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {!catalog && !error && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />…</div>}
          {isAdmin && <p className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">{L.adminNote}</p>}
          {catalog && !isAdmin && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['ROLE', 'CUSTOM'] as const).map((m) => (
                  <label key={m} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${mode === m ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
                    <input type="radio" name="perm-mode" checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
                    <span><b className="block">{m === 'ROLE' ? L.modeRole : L.modeCustom}</b><span className="text-xs text-slate-600">{m === 'ROLE' ? L.roleHint : L.customHint}</span></span>
                  </label>
                ))}
              </div>

              {mode === 'CUSTOM' && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{L.presets}:</span>
                    <button type="button" onClick={() => preset('all')} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-slate-50">{L.all}</button>
                    <button type="button" onClick={() => preset('read')} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-slate-50">{L.readOnly}</button>
                    <button type="button" onClick={() => preset('noFinance')} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-900">{L.noFinance}</button>
                    <button type="button" onClick={() => preset('clear')} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50">{L.clear}</button>
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={L.search} className="ms-auto min-w-[10rem] rounded-lg border px-3 py-1.5 text-sm" />
                  </div>
                  <p className="text-xs text-slate-600">{L.selected}: <b>{codes.size}</b> · {L.financialCount}: <b>{financialGranted}</b></p>

                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="sticky top-0 bg-slate-100 text-slate-700">
                        <tr>
                          <th className="p-2 text-right">{L.module}</th>
                          {ACTION_ORDER.map((a) => (
                            <th key={a} className="p-2 text-center text-xs">
                              <label className="flex cursor-pointer flex-col items-center gap-1">
                                {catalog.actionLabels[a]}
                                <input type="checkbox" aria-label={catalog.actionLabels[a]}
                                  checked={colAll(a, visibleModules).length > 0 && colAll(a, visibleModules).every((c) => codes.has(c))}
                                  onChange={(e) => setMany(colAll(a, visibleModules), e.target.checked)} />
                              </label>
                            </th>
                          ))}
                          <th className="p-2 text-center text-xs">{L.rowAll}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catalog.groups.map((g) => {
                          const list = visibleModules.filter((m) => m.group === g.code);
                          if (!list.length) return null;
                          const groupCodes = list.flatMap(modCodes);
                          return (
                            <React.Fragment key={g.code}>
                              <tr className="bg-indigo-50">
                                <td className="p-2 font-black text-indigo-900" colSpan={ACTION_ORDER.length + 1}>{g.name}</td>
                                <td className="p-2 text-center">
                                  <input type="checkbox" aria-label={g.name} checked={groupCodes.every((c) => codes.has(c))} onChange={(e) => setMany(groupCodes, e.target.checked)} />
                                </td>
                              </tr>
                              {list.map((m) => (
                                <tr key={m.code} className="border-t hover:bg-slate-50">
                                  <td className="p-2 font-medium">
                                    {m.name}
                                    {m.financial && <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{L.financial}</span>}
                                  </td>
                                  {ACTION_ORDER.map((a) => (
                                    <td key={a} className="p-2 text-center">
                                      {m.actions.includes(a as never)
                                        ? <input type="checkbox" aria-label={`${m.name} — ${catalog.actionLabels[a]}`} checked={codes.has(code(m.code, a))} onChange={(e) => toggle(code(m.code, a), e.target.checked)} />
                                        : <span className="text-slate-300">—</span>}
                                    </td>
                                  ))}
                                  <td className="p-2 text-center">
                                    <input type="checkbox" aria-label={`${m.name} — ${L.rowAll}`} checked={modCodes(m).every((c) => codes.has(c))} onChange={(e) => setMany(modCodes(m), e.target.checked)} />
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {data && data.audit.length > 0 && (
                <details className="rounded-lg border p-3 text-xs">
                  <summary className="cursor-pointer font-bold">{L.history}</summary>
                  <ul className="mt-2 space-y-1">
                    {data.audit.map((a, i) => (
                      <li key={i}>{new Date(a.changed_at).toLocaleString(i18n.language)} — {a.changed_by_name ?? '—'} ({L.by}) · {a.mode} · {L.added}: {a.added.length} · {L.removed}: {a.removed.length}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
          {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t p-3">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">{L.cancel}</button>
          {!isAdmin && (
            <button type="button" disabled={busy || !catalog} onClick={() => void save()} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? L.saving : L.save}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
