import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, Save } from 'lucide-react';
import {
  listCartelaStock,
  listCartelaStockColors,
  setCartelaStock,
  type StockRow,
} from '../../lib/api/cartelaCustodyApi';
import { useToast } from '../../components/NonBlockingToast';

const rowKey = (r: StockRow) => `${r.cartelaId}|${r.colorId ?? ''}`;
const baseValue = (r: StockRow) => (r.quantity === null ? '' : String(r.quantity));
const parseQty = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))));

/** حقل عدد: المسودة محفوظة في الصفحة الأم فلا تضيع عند حفظ صف آخر أو إعادة التحميل. فارغ = بلا تتبع عددي. */
function QtyEditor({ row, value, onChange, onSave, busy }: {
  row: StockRow; value: string; onChange: (v: string) => void; onSave: () => void; busy: boolean;
}) {
  const { t } = useTranslation('cartelaCustody');
  const dirty = value !== baseValue(row);
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        value={value}
        placeholder={t('stock.untracked')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && dirty && onSave()}
        className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        dir="ltr"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || busy}
        className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {value.trim() === '' && row.quantity !== null ? t('stock.stopTracking') : t('stock.save')}
      </button>
    </div>
  );
}

const availableCls = (r: StockRow) =>
  r.available === null ? 'text-slate-400' : r.available === 0 ? 'font-bold text-rose-600' : 'font-bold text-emerald-700';

export const CartelaStock: React.FC = () => {
  const { t } = useTranslation('cartelaCustody');
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [colors, setColors] = useState<StockRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [savingAll, setSavingAll] = useState(false);
  const loadedOnce = React.useRef(false);

  // إعادة تحميل صامتة بعد أول مرة: لا يُفرَّغ الجدول فلا تضيع القيم المعدّلة في الصفوف الأخرى.
  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    try {
      setRows(await listCartelaStock(search.trim()));
      loadedOnce.current = true;
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('stock.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [search, showToast, t]);

  const valueOf = (r: StockRow) => drafts[rowKey(r)] ?? baseValue(r);
  const setDraft = (r: StockRow, v: string) => setDrafts((d) => ({ ...d, [rowKey(r)]: v }));
  const allRows = [...rows, ...(openId ? colors : [])];
  const dirtyRows = allRows.filter((r) => valueOf(r) !== baseValue(r));

  const saveRows = async (list: StockRow[]) => {
    const failed: string[] = [];
    for (const r of list) {
      const n = parseQty(valueOf(r));
      const k = rowKey(r);
      if (n !== null && !Number.isFinite(n)) { failed.push(r.title); continue; }
      setBusyKeys((b) => new Set(b).add(k));
      try {
        await setCartelaStock({ cartelaId: r.cartelaId, colorId: r.colorId, quantity: n });
        setDrafts((d) => { const next = { ...d }; delete next[k]; return next; });
      } catch (e) {
        failed.push(e instanceof Error ? e.message : r.title);
      } finally {
        setBusyKeys((b) => { const next = new Set(b); next.delete(k); return next; });
      }
    }
    if (failed.length) showToast({ type: 'error', message: failed[0] });
    else showToast({ type: 'success', message: t('stock.saved') });
    await load();
    if (openId) await loadColors(openId);
  };
  const saveAll = async () => { setSavingAll(true); try { await saveRows(dirtyRows); } finally { setSavingAll(false); } };

  useEffect(() => {
    const id = setTimeout(() => void load(), 250);
    return () => clearTimeout(id);
  }, [load]);

  const loadColors = useCallback(
    async (cartelaId: string) => {
      try {
        setColors(await listCartelaStockColors(cartelaId));
      } catch (e) {
        showToast({ type: 'error', message: e instanceof Error ? e.message : t('stock.loadFailed') });
      }
    },
    [showToast, t],
  );

  const toggleColors = (cartelaId: string) => {
    if (openId === cartelaId) {
      setOpenId(null);
      return;
    }
    setOpenId(cartelaId);
    setColors([]);
    void loadColors(cartelaId);
  };

  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('stock.title')}</h1>
          <p className="max-w-2xl text-sm text-slate-500">{t('stock.subtitle')}</p>
        </div>
        <Link to="/cartela/delivery" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          {t('stock.goDelivery')}
        </Link>
      </div>

      {dirtyRows.length > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 shadow-sm">
          <span className="text-sm font-bold text-violet-900">{t('stock.pendingChanges', { count: dirtyRows.length })}</span>
          <button type="button" onClick={() => void saveAll()} disabled={savingAll}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
            {savingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('stock.saveAll')}
          </button>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('stock.search')}
        className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-right">{t('stock.colTitle')}</th>
              <th className="p-3 text-right">{t('stock.colCode')}</th>
              <th className="p-3 text-right">{t('stock.colSerial')}</th>
              <th className="p-3 text-right">{t('stock.colQty')}</th>
              <th className="p-3 text-right">{t('stock.colHeld')}</th>
              <th className="p-3 text-right">{t('stock.colAvailable')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-500">
                  {t('stock.empty')}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <React.Fragment key={r.cartelaId}>
                  <tr className="border-t border-slate-100 align-middle">
                    <td className="p-3 font-bold">{r.title}</td>
                    <td className="p-3">{r.artCode || '—'}</td>
                    <td className="p-3 font-mono" dir="ltr">{r.serialNo || '—'}</td>
                    <td className="p-3">
                      <QtyEditor row={r} value={valueOf(r)} onChange={(v) => setDraft(r, v)} onSave={() => void saveRows([r])} busy={busyKeys.has(rowKey(r)) || savingAll} />
                    </td>
                    <td className="p-3">{r.quantity === null ? '—' : r.held}</td>
                    <td className={`p-3 ${availableCls(r)}`}>{r.available === null ? '—' : r.available}</td>
                    <td className="p-3">
                      {r.colorCount > 0 && (
                        <button type="button" onClick={() => toggleColors(r.cartelaId)} className="text-xs font-bold text-violet-700 hover:underline">
                          {openId === r.cartelaId ? t('stock.hideColors') : t('stock.colors', { count: r.colorCount })}
                        </button>
                      )}
                    </td>
                  </tr>
                  {openId === r.cartelaId && (
                    <tr className="bg-slate-50">
                      <td colSpan={7} className="p-3">
                        <p className="mb-2 text-xs text-slate-500">{t('stock.colorHint')}</p>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {colors.map((c) => (
                            <div key={c.colorId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <span className="text-sm font-bold">
                                {c.colorName || c.colorCode} <span className="font-mono text-xs font-normal text-slate-500" dir="ltr">{c.colorCode}</span>
                              </span>
                              <QtyEditor row={c} value={valueOf(c)} onChange={(v) => setDraft(c, v)} onSave={() => void saveRows([c])} busy={busyKeys.has(rowKey(c)) || savingAll} />
                              <span className="text-xs text-slate-500">
                                {t('stock.colHeld')}: {c.quantity === null ? '—' : c.held} · {t('stock.colAvailable')}:{' '}
                                <b className={availableCls(c)}>{c.available === null ? '—' : c.available}</b>
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
