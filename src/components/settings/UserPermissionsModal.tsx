import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import {
  getPermissionCatalog,
  getUserPermissions,
  saveUserPermissionMatrix,
  listPermissionTemplates,
  savePermissionTemplate,
  deletePermissionTemplate,
  type PermissionTemplateDto,
  type PermissionCatalog,
  type UserPermissionsDto,
  getUserWarehouses,
  saveUserWarehouses,
} from '../../lib/api/settingsApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';

const ACTION_ORDER = ['view', 'create', 'edit', 'delete', 'approve', 'disburse', 'price', 'costView', 'print', 'export'] as const;

const TEXT = {
  ar: {
    title: 'صلاحيات المستخدم', modeRole: 'حسب الدور (الوضع الافتراضي)', modeCustom: 'صلاحيات مخصّصة (قسم قسم)',
    roleHint: 'يعمل المستخدم حسب دوره كما كان تماماً.', customHint: 'يُحصر المستخدم بما تظلّله هنا فقط. كل صلاحية كتابة تمنح العرض تلقائياً، والخادم يرفض أي إجراء غير مظلَّل. أسماء العملاء والموردين تظهر دائماً لقوائم الاختيار.',
    presets: 'قوالب سريعة', all: 'كل الصلاحيات', readOnly: 'قراءة فقط', noFinance: 'بدون بيانات مالية', clear: 'مسح الكل',
    thisSection: 'هذا القسم:', sectionAll: 'تحديد القسم', sectionClear: 'مسح القسم',
    financial: 'مالي', search: 'بحث عن وحدة…', save: 'حفظ الصلاحيات', cancel: 'إغلاق', saving: 'جارٍ الحفظ…', saved: 'تم حفظ الصلاحيات',
    selected: 'المظلَّل', history: 'آخر التغييرات', by: 'بواسطة', added: 'أُضيف', removed: 'أُزيل', loadFailed: 'تعذر تحميل الصلاحيات',
    module: 'الوحدة', rowAll: 'الكل', adminNote: 'مدير النظام لا يُقيَّد.', financialCount: 'وحدات مالية ممنوحة',
    whTitle: 'المستودعات المسموحة', whHint: 'لا يرى المستخدم ولا ينفّذ حركات إلا على المستودعات المحدّدة هنا. صلاحياته (بيع، تسعير…) تبقى حسب دوره. بلا اختيار = كل مستودعات الفرع.', whSave: 'حفظ المستودعات', whSaved: 'تم حفظ المستودعات', whAll: 'غير مقيَّد: كل المستودعات', whRestricted: 'مقيَّد بعدد مستودعات',
    tplTitle: 'قوالب مسمّاة', tplPick: 'اختر قالباً…', tplApply: 'تطبيق', tplSave: 'حفظ الحالي كقالب', tplDelete: 'حذف القالب', tplName: 'اسم القالب', tplSaved: 'حُفظ القالب', tplNone: 'لا قوالب بعد',
    draftNote: 'فاتورة البيع: إن مُنح «إضافة» دون «تسعير/اعتماد» يحفظ الموظف مسودة (عميل + بضاعة) ويسعّرها المحاسب ويرحّلها.',
  },
  tr: {
    title: 'Kullanıcı yetkileri', modeRole: 'Role göre (varsayılan)', modeCustom: 'Özel yetkiler (bölüm bölüm)',
    roleHint: 'Kullanıcı eskisi gibi rolüne göre çalışır.', customHint: 'Kullanıcı yalnızca burada işaretlenenlerle sınırlıdır. Yazma yetkisi görüntülemeyi otomatik verir; sunucu işaretsiz işlemi reddeder. Müşteri ve tedarikçi adları seçim listeleri için her zaman görünür.',
    presets: 'Hızlı şablonlar', all: 'Tüm yetkiler', readOnly: 'Salt okunur', noFinance: 'Mali veri yok', clear: 'Temizle',
    thisSection: 'Bu bölüm:', sectionAll: 'Bölümü seç', sectionClear: 'Bölümü temizle',
    financial: 'mali', search: 'Modül ara…', save: 'Yetkileri kaydet', cancel: 'Kapat', saving: 'Kaydediliyor…', saved: 'Yetkiler kaydedildi',
    selected: 'Seçili', history: 'Son değişiklikler', by: 'yapan', added: 'eklenen', removed: 'kaldırılan', loadFailed: 'Yetkiler yüklenemedi',
    module: 'Modül', rowAll: 'Hepsi', adminNote: 'Sistem yöneticisi kısıtlanamaz.', financialCount: 'verilen mali modül',
    whTitle: 'İzinli depolar', whHint: 'Kullanıcı yalnızca burada seçilen depoları görür ve işlem yapar. Yetkileri (satış, fiyatlandırma…) rolüne göre kalır. Seçim yoksa şubenin tüm depoları.', whSave: 'Depoları kaydet', whSaved: 'Depolar kaydedildi', whAll: 'Kısıtlama yok: tüm depolar', whRestricted: 'Kısıtlı depo sayısı',
    tplTitle: 'Adlandırılmış şablonlar', tplPick: 'Şablon seç…', tplApply: 'Uygula', tplSave: 'Mevcudu şablon olarak kaydet', tplDelete: 'Şablonu sil', tplName: 'Şablon adı', tplSaved: 'Şablon kaydedildi', tplNone: 'Henüz şablon yok',
    draftNote: 'Satış faturası: «Ekle» var ama «Fiyat/Onay» yoksa çalışan taslak (müşteri + mal) kaydeder; muhasebe fiyatlar ve işler.',
  },
} as const;

export type PermUser = { id: string; username: string; full_name: string | null; role: string };

/** محرر المصفوفة (قسم قسم): يُستعمل بالنافذة وبصفحة «الصلاحيات» المستقلة. */
export const PermissionMatrixEditor: React.FC<{ user: PermUser; onSaved: (mode: 'ROLE' | 'CUSTOM') => void; onClose?: () => void }> = ({ user, onSaved, onClose }) => {
  const { i18n } = useTranslation();
  const L = TEXT[i18n.language === 'tr' ? 'tr' : 'ar'];
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [data, setData] = useState<UserPermissionsDto | null>(null);
  const [mode, setMode] = useState<'ROLE' | 'CUSTOM'>('ROLE');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const isAdmin = user.role === 'admin';
  const [allWarehouses, setAllWarehouses] = useState<ApiWarehouse[]>([]);
  const [whIds, setWhIds] = useState<Set<string>>(new Set());
  const [whSaving, setWhSaving] = useState(false);
  const [whMessage, setWhMessage] = useState('');
  useEffect(() => {
    let active = true;
    setWhMessage('');
    Promise.all([listWarehouses({ status: 'active' }), getUserWarehouses(user.id)])
      .then(([w, ids]) => { if (active) { setAllWarehouses(w); setWhIds(new Set(ids)); } })
      .catch(() => { if (active) { setAllWarehouses([]); setWhIds(new Set()); } });
    return () => { active = false; };
  }, [user.id]);
  const saveWarehouses = async () => {
    setWhSaving(true); setWhMessage(''); setError('');
    try { await saveUserWarehouses(user.id, [...whIds]); setWhMessage(L.whSaved); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWhSaving(false); }
  };
  const [templates, setTemplates] = useState<PermissionTemplateDto[]>([]);
  const [tplId, setTplId] = useState('');
  const reloadTemplates = () => listPermissionTemplates().then(setTemplates).catch(() => setTemplates([]));
  useEffect(() => { void reloadTemplates(); }, []);
  const applyTemplate = () => { const t = templates.find((x) => x.id === tplId); if (t) setCodes(new Set(t.codes)); };
  const saveAsTemplate = async () => {
    const name = window.prompt(L.tplName, templates.find((x) => x.id === tplId)?.name ?? '')?.trim();
    if (!name) return;
    try { const t = await savePermissionTemplate({ name, codes: [...codes] }); await reloadTemplates(); setTplId(t.id); setMessage(L.tplSaved); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const removeTemplate = async () => {
    if (!tplId) return;
    try { await deletePermissionTemplate(tplId); setTplId(''); await reloadTemplates(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    let active = true;
    setCatalog(null); setData(null); setError(''); setMessage('');
    Promise.all([getPermissionCatalog(), getUserPermissions(user.id)])
      .then(([c, d]) => {
        if (!active) return;
        setCatalog(c); setData(d); setMode(d.mode); setCodes(new Set(d.codes));
        setActiveGroup((g) => g || c.groups[0]?.code || '');
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : L.loadFailed); });
    return () => { active = false; };
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const code = (m: string, a: string) => `p:${m}.${a}`;
  const toggle = (c: string, on: boolean) => setCodes((prev) => { const n = new Set(prev); if (on) n.add(c); else n.delete(c); return n; });
  const setMany = (list: string[], on: boolean) => setCodes((prev) => { const n = new Set(prev); for (const c of list) { if (on) n.add(c); else n.delete(c); } return n; });

  const modules = catalog?.modules ?? [];
  type Mod = PermissionCatalog['modules'][number];
  const groupModules = useMemo(
    () => modules.filter((m) => m.group === activeGroup && (!filter.trim() || m.name.includes(filter.trim()))),
    [modules, activeGroup, filter],
  );
  const modCodes = (m: Mod) => m.actions.map((a) => code(m.code, a));
  const colAll = (a: string, list: Mod[]) => list.filter((m) => m.actions.includes(a as never)).map((m) => code(m.code, a));
  const groupCount = (g: string) => modules.filter((m) => m.group === g).flatMap(modCodes).filter((c) => codes.has(c)).length;
  const groupTotal = (g: string) => modules.filter((m) => m.group === g).flatMap(modCodes).length;

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
    <div className="flex min-h-0 flex-1 flex-col" dir={i18n.language === 'tr' ? 'ltr' : 'rtl'}>
      <div className="space-y-3 overflow-y-auto p-4">
        {!catalog && !error && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />…</div>}
        {isAdmin && <p className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">{L.adminNote}</p>}
        {catalog && !isAdmin && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['ROLE', 'CUSTOM'] as const).map((m) => (
                <label key={m} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${mode === m ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
                  <input type="radio" name={`perm-mode-${user.id}`} checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
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
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-2">
                  <span className="text-sm font-bold">{L.tplTitle}:</span>
                  <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="min-w-[10rem] rounded-lg border px-2 py-1.5 text-sm" aria-label={L.tplTitle}>
                    <option value="">{templates.length ? L.tplPick : L.tplNone}</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.codes.length})</option>)}
                  </select>
                  <button type="button" disabled={!tplId} onClick={applyTemplate} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">{L.tplApply}</button>
                  <button type="button" onClick={() => void saveAsTemplate()} className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-indigo-800">{L.tplSave}</button>
                  <button type="button" disabled={!tplId} onClick={() => void removeTemplate()} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-40">{L.tplDelete}</button>
                </div>
                <p className="text-xs text-slate-600">{L.selected}: <b>{codes.size}</b> · {L.financialCount}: <b>{financialGranted}</b></p>
                <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-900">{L.draftNote}</p>

                {/* الأقسام: قسم مستقل لكل مجال */}
                <div role="tablist" className="flex flex-wrap gap-1.5 border-b pb-2">
                  {catalog.groups.map((g) => (
                    <button key={g.code} role="tab" aria-selected={activeGroup === g.code} type="button" onClick={() => setActiveGroup(g.code)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-bold ${activeGroup === g.code ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                      {g.name} <span className={`ms-1 rounded-full px-1.5 text-[10px] ${activeGroup === g.code ? 'bg-white/25' : 'bg-white'}`}>{groupCount(g.code)}/{groupTotal(g.code)}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">{L.thisSection}</span>
                  <button type="button" onClick={() => setMany(groupModules.flatMap(modCodes), true)} className="rounded border px-2 py-1 text-xs font-bold hover:bg-slate-50">{L.sectionAll}</button>
                  <button type="button" onClick={() => setMany(groupModules.flatMap(modCodes), false)} className="rounded border px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50">{L.sectionClear}</button>
                  <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={L.search} className="ms-auto min-w-[10rem] rounded-lg border px-3 py-1.5 text-sm" />
                </div>

                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="p-2 text-right">{L.module}</th>
                        {ACTION_ORDER.map((a) => (
                          <th key={a} className="p-2 text-center text-xs">
                            <label className="flex cursor-pointer flex-col items-center gap-1">
                              {catalog.actionLabels[a]}
                              <input type="checkbox" aria-label={catalog.actionLabels[a]}
                                checked={colAll(a, groupModules).length > 0 && colAll(a, groupModules).every((c) => codes.has(c))}
                                onChange={(e) => setMany(colAll(a, groupModules), e.target.checked)} />
                            </label>
                          </th>
                        ))}
                        <th className="p-2 text-center text-xs">{L.rowAll}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupModules.map((m) => (
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
                      {groupModules.length === 0 && <tr><td colSpan={ACTION_ORDER.length + 2} className="p-4 text-center text-slate-500">—</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* N-0034: المستودعات المسموحة — لا اختيار = كل مستودعات الفرع */}
            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b className="text-sm">{L.whTitle}</b>
                  <p className="text-xs text-slate-600">{L.whHint}</p>
                </div>
                <button type="button" disabled={busy || whSaving} onClick={() => void saveWarehouses()} className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50">{whSaving ? L.saving : L.whSave}</button>
              </div>
              {allWarehouses.length === 0 ? <p className="text-xs text-slate-500">—</p> : (
                <div className="flex flex-wrap gap-2">
                  {allWarehouses.map((w) => (
                    <label key={w.id} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${whIds.has(w.id) ? 'border-indigo-500 bg-indigo-50 font-bold' : 'border-slate-200'}`}>
                      <input type="checkbox" checked={whIds.has(w.id)} onChange={(e) => setWhIds((prev) => { const n = new Set(prev); if (e.target.checked) n.add(w.id); else n.delete(w.id); return n; })} />
                      {w.name}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs font-bold text-slate-700">{whIds.size === 0 ? L.whAll : `${L.whRestricted}: ${whIds.size}`}</p>
              {whMessage && <p role="status" className="text-xs font-bold text-emerald-700">{whMessage}</p>}
            </div>

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
        {onClose && <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">{L.cancel}</button>}
        {!isAdmin && (
          <button type="button" disabled={busy || !catalog} onClick={() => void save()} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? L.saving : L.save}
          </button>
        )}
      </div>
    </div>
  );
};

export const UserPermissionsModal: React.FC<{
  user: PermUser;
  onClose: () => void;
  onSaved: (mode: 'ROLE' | 'CUSTOM') => void;
}> = ({ user, onClose, onSaved }) => {
  const { i18n } = useTranslation();
  const L = TEXT[i18n.language === 'tr' ? 'tr' : 'ar'];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={L.title}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-[var(--surface-header,#fff)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b p-4" dir={i18n.language === 'tr' ? 'ltr' : 'rtl'}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <div>
              <h3 className="text-lg font-black">{L.title}: {user.full_name || user.username}</h3>
              <p className="text-xs text-slate-500 font-mono">{user.username} · {user.role}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={L.cancel} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <PermissionMatrixEditor user={user} onSaved={onSaved} onClose={onClose} />
      </div>
    </div>
  );
};
