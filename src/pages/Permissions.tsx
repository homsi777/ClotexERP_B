import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, Users } from 'lucide-react';
import { listSystemUsers, type ApiUser } from '../lib/api/settingsApi';
import { PermissionMatrixEditor } from '../components/settings/UserPermissionsModal';

/** قسم مستقل «الصلاحيات»: اختيار المستخدم ثم تحديد ما يراه ويضيفه ويعدّله ويحذفه، قسماً قسماً. */
export const Permissions: React.FC = () => {
  const { i18n } = useTranslation();
  const tr = i18n.language === 'tr';
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    listSystemUsers()
      .then((rows) => { if (active) { setUsers(rows); setSelectedId((cur) => cur || rows.find((u) => u.role !== 'admin')?.id || ''); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(
    () => users.filter((u) => !search.trim() || `${u.full_name ?? ''} ${u.username}`.toLowerCase().includes(search.trim().toLowerCase())),
    [users, search],
  );
  const selected = users.find((u) => u.id === selectedId) ?? null;

  return (
    <div className="space-y-4" dir={tr ? 'ltr' : 'rtl'}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-indigo-600" />
        <div>
          <h1 className="text-2xl font-black text-[var(--text-heading)]">{tr ? 'Yetkiler' : 'الصلاحيات'}</h1>
          <p className="text-sm text-[var(--text-muted)]">{tr ? 'Her kullanıcı için bölüm bölüm: ne görür, ne ekler, düzenler, siler.' : 'لكل مستخدم قسماً قسماً: ماذا يرى وماذا يضيف ويعدّل ويحذف ويعتمد.'}</p>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)]">
          <div className="flex items-center gap-2 border-b p-3 font-bold"><Users className="h-4 w-4" />{tr ? 'Kullanıcılar' : 'المستخدمون'}</div>
          <div className="p-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr ? 'Ara…' : 'بحث…'} className="mb-2 w-full rounded-lg border px-3 py-1.5 text-sm" />
            {loading && <Loader2 className="mx-auto h-4 w-4 animate-spin" />}
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
              {filtered.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => setSelectedId(u.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm ${selectedId === u.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'}`}>
                    <span><b className="block">{u.full_name || u.username}</b><span className={`text-xs ${selectedId === u.id ? 'text-white/80' : 'text-slate-500'}`}>{u.username} · {u.role}</span></span>
                    {u.perm_mode === 'CUSTOM' && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${selectedId === u.id ? 'bg-white/25' : 'bg-indigo-100 text-indigo-800'}`}>{tr ? 'özel' : 'مخصّص'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="min-h-[24rem] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)]">
          {selected ? (
            <PermissionMatrixEditor
              key={selected.id}
              user={selected}
              onSaved={(mode) => setUsers((cur) => cur.map((u) => (u.id === selected.id ? { ...u, perm_mode: mode } : u)))}
            />
          ) : (
            <p className="p-6 text-center text-[var(--text-muted)]">{tr ? 'Bir kullanıcı seçin' : 'اختر مستخدماً'}</p>
          )}
        </section>
      </div>
    </div>
  );
};
