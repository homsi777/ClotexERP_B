import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ListTree, Loader2, Printer, Search, Table2 } from 'lucide-react';
import { listCartelaColorsIndex, type CartelaColorIndexRow } from '../../lib/api/cartelaColorApi';
import { CartelaColorLabelPrintModal } from '../../components/cartela/CartelaColorLabelPrintModal';

type View = 'table' | 'tree';

const displayName = (r: CartelaColorIndexRow) => r.name_ar || r.name_tr || '—';

/** ألوان كل الكارتيلات في شاشة واحدة: جدول بحث + شجرة (الخامة ← الكارتيلة ← الألوان) مع تحديد وطباعة ملصقات 5×2.5. */
export const CartelaColorsIndex: React.FC = () => {
  const [view, setView] = useState<View>('table');
  const [search, setSearch] = useState('');
  const [allRows, setAllRows] = useState<CartelaColorIndexRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<CartelaColorIndexRow[] | null>(null);
  const [fabricFilter, setFabricFilter] = useState('');
  const [codeFilter, setCodeFilter] = useState('');

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError('');
    try {
      setAllRows(await listCartelaColorsIndex(term));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تحميل الألوان');
    } finally {
      setLoading(false);
    }
  }, []);

  // بحث مؤجَّل نصف ثانية بعد التوقف عن الكتابة.
  useEffect(() => {
    const id = window.setTimeout(() => void load(search), 350);
    return () => window.clearTimeout(id);
  }, [search, load]);

  const fabricOptions = useMemo(() => [...new Set(allRows.map((r) => r.fabric_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [allRows]);
  const codeOptions = useMemo(
    () => [...new Set(allRows.filter((r) => !fabricFilter || r.fabric_name === fabricFilter).map((r) => r.material_code ?? '').filter(Boolean))].sort(),
    [allRows, fabricFilter],
  );
  const rows = useMemo(
    () => allRows.filter((r) => (!fabricFilter || r.fabric_name === fabricFilter) && (!codeFilter || (r.material_code ?? '') === codeFilter)),
    [allRows, fabricFilter, codeFilter],
  );

  const tree = useMemo(() => {
    const fabrics = new Map<string, Map<string, { title: string; serial: string; material: string; colors: CartelaColorIndexRow[] }>>();
    for (const r of rows) {
      const f = r.fabric_name || '—';
      if (!fabrics.has(f)) fabrics.set(f, new Map());
      const cartelas = fabrics.get(f)!;
      if (!cartelas.has(r.cartela_label_id)) {
        cartelas.set(r.cartela_label_id, { title: r.cartela_title, serial: r.cartela_serial, material: r.material_code ?? '', colors: [] });
      }
      cartelas.get(r.cartela_label_id)!.colors.push(r);
    }
    return [...fabrics.entries()].map(([name, cartelas]) => ({ name, cartelas: [...cartelas.entries()].map(([id, c]) => ({ id, ...c })) }));
  }, [rows]);

  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggleOne = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleMany = (ids: string[]) =>
    setPicked((cur) => {
      const next = new Set(cur);
      const all = ids.every((i) => next.has(i));
      for (const i of ids) {
        if (all) next.delete(i);
        else next.add(i);
      }
      return next;
    });
  const toggleOpen = (key: string) =>
    setOpenKeys((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const searchActive = search.trim().length > 0;
  const isOpen = (key: string) => searchActive || openKeys.has(key);
  const selectedRows = rows.filter((r) => picked.has(r.id));

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ألوان الكارتيلات</h1>
          <p className="text-sm text-slate-500">كل الألوان الفرعية لكل الكارتيلات — ابحث بالخامة أو كود اللون أو الباركود دون فتح الشجرة.</p>
        </div>
        <button
          type="button"
          disabled={!selectedRows.length}
          onClick={() => setPrinting(selectedRows)}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-40"
        >
          <Printer className="h-4 w-4" />
          طباعة ملصقات 5×2.5 ({selectedRows.length})
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث: اسم الخامة، كود الدسان، كود اللون، اسم اللون، الباركود…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pe-3 ps-3 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white text-sm font-bold">
          <button type="button" onClick={() => setView('table')} className={`inline-flex items-center gap-1.5 px-3 py-2 ${view === 'table' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Table2 className="h-4 w-4" /> جدول
          </button>
          <button type="button" onClick={() => setView('tree')} className={`inline-flex items-center gap-1.5 px-3 py-2 ${view === 'tree' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <ListTree className="h-4 w-4" /> شجرة
          </button>
        </div>
        <select value={fabricFilter} onChange={(e) => { setFabricFilter(e.target.value); setCodeFilter(''); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="تصفية حسب الخامة">
          <option value="">كل الخامات</option>
          {fabricOptions.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="تصفية حسب كود الخامة" dir="ltr">
          <option value="">كل أكواد الخامة</option>
          {codeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-slate-500">
          {loading ? <Loader2 className="inline h-4 w-4 animate-spin" /> : `${rows.length} لون`}
          {picked.size > 0 && ` — المحدد ${picked.size}`}
        </span>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {view === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                <th className="p-3">
                  <input type="checkbox" checked={allPicked} onChange={() => toggleMany(rows.map((r) => r.id))} aria-label="تحديد الكل" />
                </th>
                <th className="p-3">الخامة</th>
                <th className="p-3">كود الدسان</th>
                <th className="p-3">الكارتيلة</th>
                <th className="p-3">كود اللون</th>
                <th className="p-3">اسم اللون</th>
                <th className="p-3">الباركود</th>
                <th className="p-3">طباعة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggleOne(r.id)} />
                  </td>
                  <td className="p-3 font-bold text-slate-900">{r.fabric_name}</td>
                  <td className="p-3 font-mono text-xs" dir="ltr">{r.material_code || '—'}</td>
                  <td className="p-3 font-mono text-xs" dir="ltr">{r.cartela_serial || r.cartela_title}</td>
                  <td className="p-3 font-mono font-bold" dir="ltr">{r.color_code}</td>
                  <td className="p-3">{displayName(r)}</td>
                  <td className="p-3 font-mono text-xs" dir="ltr">{r.barcode_code}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => setPrinting([r])} title="طباعة ملصق هذا اللون" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
                      <Printer className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">لا توجد ألوان مطابقة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          {tree.map((fabric) => {
            const fKey = `f:${fabric.name}`;
            return (
              <div key={fKey} className="rounded-lg border border-slate-200 bg-white">
                <button type="button" onClick={() => toggleOpen(fKey)} className="flex w-full items-center gap-2 px-3 py-2.5 text-right hover:bg-slate-50" aria-expanded={isOpen(fKey)}>
                  {isOpen(fKey) ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  <span className="font-bold text-slate-900">{fabric.name}</span>
                  <span className="text-xs text-slate-500">{fabric.cartelas.reduce((s, c) => s + c.colors.length, 0)} لون</span>
                </button>
                {isOpen(fKey) &&
                  fabric.cartelas.map((c) => {
                    const cKey = `c:${c.id}`;
                    return (
                      <div key={cKey} className="border-t border-slate-100 ps-6">
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button type="button" onClick={() => toggleOpen(cKey)} className="flex flex-1 items-center gap-2 text-right" aria-expanded={isOpen(cKey)}>
                            {isOpen(cKey) ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                            <span className="font-mono text-xs" dir="ltr">{c.material || '—'}</span>
                            <span className="font-mono text-xs text-slate-500" dir="ltr">{c.serial}</span>
                            <span className="text-xs text-slate-500">{c.colors.length} لون</span>
                          </button>
                          <input type="checkbox" checked={c.colors.every((x) => picked.has(x.id))} onChange={() => toggleMany(c.colors.map((x) => x.id))} aria-label="تحديد ألوان الكارتيلة" />
                        </div>
                        {isOpen(cKey) && (
                          <ul className="space-y-1 pb-2 ps-6 pe-3">
                            {c.colors.map((x) => (
                              <li key={x.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                                <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggleOne(x.id)} />
                                <span className="font-mono font-bold" dir="ltr">{x.color_code}</span>
                                <span className="flex-1">{displayName(x)}</span>
                                <span className="font-mono text-xs text-slate-500" dir="ltr">{x.barcode_code}</span>
                                <button type="button" onClick={() => setPrinting([x])} title="طباعة ملصق هذا اللون" className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-white"><Printer className="h-3.5 w-3.5" /></button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
          {!tree.length && !loading && <p className="p-8 text-center text-slate-400">لا توجد ألوان مطابقة.</p>}
        </div>
      )}

      {printing && <CartelaColorLabelPrintModal colors={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
};
