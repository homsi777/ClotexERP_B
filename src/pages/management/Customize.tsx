import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import * as api from '../../lib/api/managementApi';
import type { DashPrefs } from '../../lib/api/managementApi';
import { REGISTRY } from './Dashboard';
import { errMsg } from './kit';

/** تفضيلات اللوحة لكل مستخدم (تُحفظ على الخادم). إخفاء مؤشر = تخصيص عرض فقط، لا يغيّر أي صلاحية. */
export function useDashPrefs(scope: api.Scope) {
  const [prefs, setPrefs] = useState<DashPrefs | null>(null), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { api.fetchPrefs(scope).then((p) => setPrefs(p)).catch(() => setPrefs(null)).finally(() => setLoaded(true)); }, [scope]);
  const update = (next: DashPrefs) => {
    setPrefs(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { api.savePrefs(scope, next).catch((e) => setError(errMsg(e))); }, 400);
  };
  const reset = async () => { try { await api.resetPrefs(scope); setPrefs(null); } catch (e) { setError(errMsg(e)); } };
  return { prefs, loaded, update, reset, error };
}

export function CustomizeDialog({ prefs, tabs, onChange, onReset, onClose }: { prefs: DashPrefs | null; tabs: Array<[string, string]>; onChange: (p: DashPrefs) => void; onReset: () => void; onClose: () => void }) {
  const cur: DashPrefs = prefs ?? { hidden: [], order: [] };
  const order = [...REGISTRY].sort((a, b) => { const ia = cur.order.indexOf(a.id), ib = cur.order.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || REGISTRY.indexOf(a) - REGISTRY.indexOf(b); }).map((s) => s.id);
  const move = (id: string, d: -1 | 1) => { const i = order.indexOf(id), j = i + d; if (j < 0 || j >= order.length) return; const n = [...order]; [n[i], n[j]] = [n[j], n[i]]; onChange({ ...cur, order: n }); };
  const toggle = (id: string) => onChange({ ...cur, hidden: cur.hidden.includes(id) ? cur.hidden.filter((x) => x !== id) : [...cur.hidden, id] });
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="تخصيص اللوحة">
    <div className="cx-dash cx-card max-h-[88vh] w-full max-w-xl overflow-y-auto p-4" style={{ paddingBottom: '1rem' }} dir="rtl">
      <div className="mb-3 flex items-center justify-between"><b className="cx-title text-lg">تخصيص اللوحة</b><button type="button" onClick={onClose} className="cx-btn" aria-label="إغلاق"><X className="h-4 w-4" /></button></div>
      <p className="cx-muted mb-3 text-xs">يُحفظ لكل مستخدم. إخفاء مؤشر هنا يغيّر العرض فقط ولا يمسّ الصلاحيات أو البيانات.</p>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2 text-sm">التبويب الافتراضي<select className="cx-input" value={cur.defaultTab ?? ''} onChange={(e) => onChange({ ...cur, defaultTab: e.target.value || undefined })}><option value="">نظرة عامة</option>{tabs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex items-center justify-between gap-2 text-sm">الفترة الافتراضية<select className="cx-input" value={cur.defaultPeriod ?? ''} onChange={(e) => onChange({ ...cur, defaultPeriod: (e.target.value || undefined) as DashPrefs['defaultPeriod'] })}><option value="">الشهر</option>{([['today', 'اليوم'], ['yesterday', 'أمس'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة']] as const).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <div className="space-y-2">
        {order.map((id) => { const sec = REGISTRY.find((s) => s.id === id)!; return <details key={id} className="cx-card p-2">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-bold"><span>{sec.title}</span>
            <span className="flex gap-1" onClick={(e) => e.preventDefault()}><button type="button" className="cx-btn" aria-label="أعلى" onClick={() => move(id, -1)}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" className="cx-btn" aria-label="أسفل" onClick={() => move(id, 1)}><ArrowDown className="h-3.5 w-3.5" /></button></span></summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">{sec.tiles.map((t) => <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!cur.hidden.includes(t.id)} onChange={() => toggle(t.id)} />{t.label}</label>)}</div>
        </details>; })}
      </div>
      <div className="mt-4 flex justify-between"><button type="button" className="cx-btn" onClick={onReset}>استعادة التصميم الافتراضي</button><button type="button" className="cx-btn cx-btn-primary" onClick={onClose}>تم</button></div>
    </div>
  </div>;
}
