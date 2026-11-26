import { useCallback, useEffect, useState } from 'react';
import { Loader2, PackageMinus, Plus, Warehouse } from 'lucide-react';
import * as api from '../../lib/api/purchaseCatalogApi';

const nf = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const UNIT: Record<string, string> = { meter: 'م', yard: 'ياردة', kg: 'كغ', package: 'طرد', piece: 'قطعة' };
const MOVE: Record<string, string> = { RECEIPT: 'استلام', CONSUMPTION: 'استهلاك', WASTE: 'تالف', GIFT: 'إهداء', OTHER_OUT: 'تصريف آخر', ADJUST_IN: 'تسوية' };
const DISPOSE: Array<[api.DisposeType, string]> = [['CONSUMPTION', 'استهلاك'], ['WASTE', 'تالف'], ['GIFT', 'إهداء'], ['OTHER_OUT', 'تصريف آخر']];
const msg = (e: unknown) => (e instanceof Error ? e.message : 'تعذر التنفيذ');
const inp = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

/** المستودعات التشغيلية: للمواد فقط (غير مرتبطة بمستودعات الأقمشة)، أرصدة وتصريف ومتابعة الكميات. بلا أي بيانات مالية. */
export function OperatingWarehouses() {
  const [whs, setWhs] = useState<api.OperatingWarehouse[]>([]), [sel, setSel] = useState(''), [stock, setStock] = useState<api.OperatingStockRow[]>([]), [moves, setMoves] = useState<api.OperatingMovement[]>([]);
  const [name, setName] = useState(''), [err, setErr] = useState(''), [loading, setLoading] = useState(false);
  const [disp, setDisp] = useState<api.OperatingStockRow | null>(null), [qty, setQty] = useState(''), [type, setType] = useState<api.DisposeType>('CONSUMPTION'), [note, setNote] = useState(''), [busy, setBusy] = useState(false);

  const loadWhs = useCallback(async () => { try { const w = await api.listOperatingWarehouses(); setWhs(w); setSel((cur) => cur || w[0]?.id || ''); } catch (e) { setErr(msg(e)); } }, []);
  const loadStock = useCallback(async (id: string) => {
    if (!id) { setStock([]); setMoves([]); return; }
    setLoading(true);
    try { const [s, m] = await Promise.all([api.listOperatingStock(id), api.listOperatingMovements(id)]); setStock(s); setMoves(m); } catch (e) { setErr(msg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadWhs(); }, [loadWhs]);
  useEffect(() => { void loadStock(sel); }, [sel, loadStock]);

  const create = async () => {
    setErr('');
    try { const w = await api.createOperatingWarehouse({ name: name.trim() }); setName(''); await loadWhs(); setSel(w.id); } catch (e) { setErr(msg(e)); }
  };
  const dispose = async () => {
    if (!disp) return;
    setBusy(true); setErr('');
    try { await api.disposeOperatingStock({ warehouseId: sel, catalogItemId: disp.catalogItemId, quantity: Number(qty), type, notes: note.trim() || undefined }); setDisp(null); setQty(''); setNote(''); await loadStock(sel); await loadWhs(); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-5xl space-y-4" dir="rtl">
    <div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><Warehouse className="h-6 w-6" />المستودعات التشغيلية</h1>
      <p className="text-sm text-slate-500">مستودعات للمواد فقط (غير الأقمشة)؛ تدخلها المواد عند استلام فاتورة الشراء، ومنها تُصرَّف الكميات (استهلاك/تالف/إهداء) لمتابعة الرصيد.</p></div>

    <section className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="min-w-48 flex-1 text-xs font-bold text-slate-600">المستودع<select value={sel} onChange={(e) => setSel(e.target.value)} className={`${inp} mt-1 font-normal`}>{!whs.length && <option value="">لا مستودعات بعد</option>}{whs.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.items} صنف)</option>)}</select></label>
      <label className="min-w-48 flex-1 text-xs font-bold text-slate-600">مستودع تشغيلي جديد<input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: مستودع الإكسسوارات" className={`${inp} mt-1 font-normal`} /></label>
      <button type="button" disabled={!name.trim()} onClick={() => void create()} className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Plus className="h-4 w-4" />إنشاء</button>
    </section>
    {err && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{err}</p>}

    <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[560px] text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="p-2 text-right">المادة</th><th className="p-2">المستلم</th><th className="p-2">المصرَّف</th><th className="p-2">الرصيد</th><th className="p-2">الوحدة</th><th className="p-2" /></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={6} className="p-6 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></td></tr>}
          {!loading && !stock.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا مواد في هذا المستودع بعد. تُضاف عند استلام فاتورة شراء لبند من نوع «مواد أخرى» مرتبط بهذا المستودع.</td></tr>}
          {stock.map((r) => <tr key={r.catalogItemId} className="border-t"><td className="p-2 font-bold">{r.name}</td><td className="p-2 text-center font-mono">{nf(r.received)}</td><td className="p-2 text-center font-mono">{nf(r.disposed)}</td><td className="p-2 text-center font-mono font-black">{nf(r.quantity)}</td><td className="p-2 text-center">{UNIT[r.unit] ?? r.unit}</td>
            <td className="p-2"><button type="button" disabled={r.quantity <= 0} onClick={() => { setDisp(r); setQty(''); setErr(''); }} className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"><PackageMinus className="h-3.5 w-3.5" />تصريف</button></td></tr>)}
        </tbody></table>
    </section>

    {moves.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><b className="text-sm">آخر الحركات</b>
      <ul className="mt-2 divide-y text-sm">{moves.slice(0, 40).map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span><b>{MOVE[m.type] ?? m.type}</b> · {m.itemName} · <span className="font-mono">{nf(m.quantity)}</span> {UNIT[m.unit] ?? m.unit}{m.notes ? ` — ${m.notes}` : ''}</span><span className="text-xs text-slate-500">{m.by ?? ''} · {new Date(m.createdAt).toLocaleString('en-GB')}</span></li>)}</ul></section>}

    {disp && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={() => setDisp(null)}><div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()} dir="rtl">
      <b className="text-lg">تصريف: {disp.name}</b><p className="text-xs text-slate-500">الرصيد المتاح {nf(disp.quantity)} {UNIT[disp.unit] ?? disp.unit}</p>
      <label className="block text-xs font-bold text-slate-600">نوع التصريف<select value={type} onChange={(e) => setType(e.target.value as api.DisposeType)} className={`${inp} mt-1 font-normal`}>{DISPOSE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="block text-xs font-bold text-slate-600">الكمية<input type="number" min="0" step="0.001" max={disp.quantity} value={qty} onChange={(e) => setQty(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" autoFocus /></label>
      <label className="block text-xs font-bold text-slate-600">ملاحظة (اختياري)<input value={note} onChange={(e) => setNote(e.target.value)} className={`${inp} mt-1 font-normal`} /></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setDisp(null)} className="rounded-xl border px-4 py-2 text-sm font-bold">إلغاء</button><button type="button" disabled={busy || !(Number(qty) > 0) || Number(qty) > disp.quantity} onClick={() => void dispose()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '...' : 'تأكيد التصريف'}</button></div>
    </div></div>}
  </div>;
}
