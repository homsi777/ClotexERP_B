import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, PackagePlus, RefreshCw, X } from 'lucide-react';
import * as api from '../../lib/api/purchaseReceivingApi';
import type { LotInput, ReceiptLineInput, ReceiptView, ReceivingInvoice, ReceivingLine, RollInput } from '../../lib/api/purchaseReceivingApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';

const nf = (n: number, d = 3) => n.toLocaleString('en-US', { maximumFractionDigits: d });
const UNIT: Record<string, string> = { meter: 'م', yard: 'ياردة', kg: 'كغ', package: 'طرد', piece: 'قطعة' };
const KIND: Record<string, string> = { FABRIC: 'قماش', YARN: 'خيط', OTHER: 'مواد أخرى' };
const ST: Record<api.LineStatus, { label: string; cls: string }> = {
  NOT_RECEIVED: { label: 'لم يُستلم', cls: 'bg-slate-100 text-slate-700' }, PARTIAL: { label: 'استُلم جزئياً', cls: 'bg-amber-100 text-amber-800' },
  COMPLETE: { label: 'استُلم كاملاً', cls: 'bg-emerald-100 text-emerald-800' }, OVER: { label: 'زيادة عن الفاتورة — للمراجعة', cls: 'bg-rose-100 text-rose-800' },
};
const msg = (e: unknown) => (e instanceof Error ? e.message : 'تعذر التنفيذ');
const Chip = ({ s }: { s: api.LineStatus }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${ST[s].cls}`}>{ST[s].label}</span>;

type Draft = { invoice?: ReceivingInvoice; line?: ReceivingLine; pending?: boolean };

/** استلام المشتريات (للمخزن): بنود الفاتورة والكميات المطلوبة والمستلمة والمتبقية — بلا أسعار أو إجماليات أو دفع (الخادم لا يرسلها). */
export function PurchaseReceiving() {
  const [tab, setTab] = useState<'invoices' | 'pending'>('invoices');
  const [rows, setRows] = useState<ReceivingInvoice[]>([]), [pending, setPending] = useState<ReceiptView[]>([]), [loading, setLoading] = useState(true), [err, setErr] = useState('');
  const [wh, setWh] = useState<ApiWarehouse[]>([]), [sup, setSup] = useState<ApiSupplier[]>([]);
  const [f, setF] = useState<api.ReceivingFilters>({}), [open, setOpen] = useState<string | null>(null), [detail, setDetail] = useState<ReceiptView[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null), [linking, setLinking] = useState<ReceiptView | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setRows(await api.listReceivingInvoices(f)); setPending(await api.listReceipts(true)); } catch (e) { setErr(msg(e)); } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void listWarehouses({}).then(setWh).catch(() => undefined); void listSuppliers({ pageSize: 500 }).then((r) => setSup(r.data)).catch(() => undefined); }, []);
  const expand = async (id: string) => { if (open === id) { setOpen(null); return; } setOpen(id); try { setDetail((await api.getReceivingInvoice(id)).receipts); } catch { setDetail([]); } };

  return <div className="space-y-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-900">استلام المشتريات في المخازن</h1><p className="text-sm text-slate-500">ابحث عن فاتورة المورد وسجّل الاستلام كاملاً أو على دفعات. لا تظهر هنا الأسعار ولا إجماليات الفاتورة.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => setDraft({ pending: true })} className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-sm font-bold"><PackagePlus className="h-4 w-4" />استلام قبل وصول الفاتورة</button>
        <button type="button" onClick={() => void load()} className="rounded-xl border bg-white px-3 py-2"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
    </div>
    <div className="flex gap-2">{([['invoices', 'فواتير الشراء'], ['pending', `استلامات معلّقة (${pending.length})`]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full border px-4 py-1.5 text-sm font-black ${tab === k ? 'border-slate-800 bg-slate-800 text-white' : 'bg-white text-slate-700'}`}>{l}</button>)}</div>
    {err && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{err}</p>}

    {tab === 'invoices' && <>
      <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <input placeholder="رقم فاتورة المورد / الرقم الداخلي / المورد" value={f.search ?? ''} onChange={(e) => setF({ ...f, search: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" />
        <select value={f.supplierId ?? ''} onChange={(e) => setF({ ...f, supplierId: e.target.value || undefined })} className="rounded-lg border px-2 py-2 text-sm"><option value="">كل الموردين</option>{sup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={f.warehouseId ?? ''} onChange={(e) => setF({ ...f, warehouseId: e.target.value || undefined })} className="rounded-lg border px-2 py-2 text-sm"><option value="">كل المخازن</option>{wh.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select value={f.materialKind ?? ''} onChange={(e) => setF({ ...f, materialKind: e.target.value || undefined })} className="rounded-lg border px-2 py-2 text-sm"><option value="">كل المواد</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value || undefined })} className="rounded-lg border px-2 py-2 text-sm"><option value="">كل حالات الاستلام</option>{(Object.keys(ST) as api.LineStatus[]).map((k) => <option key={k} value={k}>{ST[k].label}</option>)}</select>
        <select value={f.invoiceStatus ?? ''} onChange={(e) => setF({ ...f, invoiceStatus: e.target.value || undefined })} className="rounded-lg border px-2 py-2 text-sm"><option value="">كل حالات الفاتورة</option><option value="DRAFT">مسودة</option><option value="CONFIRMED">مؤكدة</option></select>
        <input type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} className="rounded-lg border px-2 py-2 text-sm" aria-label="من تاريخ" />
        <input type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} className="rounded-lg border px-2 py-2 text-sm" aria-label="إلى تاريخ" />
      </div>
      {loading && !rows.length && <div className="p-8 text-center"><Loader2 className="inline h-6 w-6 animate-spin" /></div>}
      {rows.map((inv) => <section key={inv.id} className="rounded-xl border bg-white">
        <button type="button" onClick={() => void expand(inv.id)} className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-right">
          <span className="font-black">{inv.supplierInvoiceNo ? `${inv.supplierInvoiceNo} · ` : ''}<span className="font-mono text-sm text-slate-500">{inv.invoiceNo}</span></span>
          <span className="text-sm text-slate-600">{inv.supplierName} · {inv.invoiceDate}</span>
          <span className="flex items-center gap-2"><span className="text-xs text-slate-500">{inv.documentStatus === 'DRAFT' ? 'مسودة' : 'مؤكدة'}{!inv.receiveViaWarehouse ? ' · استلام تلقائي' : ''}</span><Chip s={inv.overall} /></span>
        </button>
        {open === inv.id && <div className="space-y-3 border-t p-3">
          <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-2">#</th><th className="p-2">المادة</th><th className="p-2">النوع</th><th className="p-2">المطلوب</th><th className="p-2">المستلم</th><th className="p-2">المتبقي</th><th className="p-2">الفرق</th><th className="p-2">الحالة</th><th className="p-2" /></tr></thead><tbody>
            {inv.lines.map((l) => <tr key={l.id} className="border-t">
              <td className="p-2">{l.lineNo}</td><td className="p-2 font-bold">{l.description}{l.details.designCode ? <span className="mr-1 text-xs font-normal text-slate-500">({String(l.details.designCode)})</span> : null}{l.details.colorName ? <span className="mr-1 text-xs font-normal text-slate-500">{String(l.details.colorName)}</span> : null}</td>
              <td className="p-2">{KIND[l.materialKind]}</td><td className="p-2 font-mono">{nf(l.quantity)} {UNIT[l.unit] ?? l.unit}</td><td className="p-2 font-mono">{nf(l.received)}</td><td className="p-2 font-mono">{nf(l.remaining)}</td>
              <td className={`p-2 font-mono ${l.diff !== 0 ? 'font-bold text-rose-700' : ''}`}>{l.diff > 0 ? '+' : ''}{nf(l.diff)}</td><td className="p-2"><Chip s={l.status} /></td>
              <td className="p-2">{(inv.receiveViaWarehouse || ['package', 'piece'].includes(l.unit)) && !l.autoReceived ? <button type="button" onClick={() => setDraft({ invoice: inv, line: l })} className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-bold text-white">استلام</button> : <span className="text-xs text-slate-400">{l.autoReceived ? 'تلقائي' : '—'}</span>}</td></tr>)}
          </tbody></table></div>
          {detail.length > 0 && <div><b className="text-sm">سجل الاستلامات</b><ul className="mt-1 space-y-1 text-xs text-slate-600">{detail.map((r) => <li key={r.id} className="rounded bg-slate-50 p-2"><b>{r.receiptNo}</b> · {r.warehouseName} · {new Date(r.createdAt).toLocaleString('en-GB')} · {r.createdBy ?? ''} — {r.lines.map((x) => `${x.description} ${nf(x.quantity)} ${UNIT[x.unit] ?? x.unit}${x.conversionFactor && x.conversionFactor !== 1 ? ` (= ${nf(x.quantityInInvoiceUnit)} بوحدة الفاتورة)` : ''}`).join(' · ')}</li>)}</ul></div>}
          <p className="text-xs text-slate-500">فروقات الكمية للمراجعة فقط: لا تتغير قيمة الفاتورة تلقائياً، ويتولى المحاسب معالجتها.</p>
        </div>}
      </section>)}
      {!loading && !rows.length && <p className="rounded-xl border bg-white p-6 text-center text-slate-500">لا فواتير مطابقة.</p>}
    </>}

    {tab === 'pending' && <div className="space-y-2">
      {pending.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-3 text-sm">
        <div><b>{r.receiptNo}</b> · {r.supplierName ?? 'بلا مورد'} · {r.warehouseName} · {new Date(r.createdAt).toLocaleDateString('en-GB')}<div className="text-xs text-slate-500">{r.lines.map((x) => `${x.description || KIND[x.materialKind]} ${nf(x.quantity)} ${UNIT[x.unit] ?? x.unit}`).join(' · ')}</div></div>
        <button type="button" onClick={() => setLinking(r)} className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white"><Link2 className="h-3.5 w-3.5" />ربط بفاتورة</button></div>)}
      {!pending.length && <p className="rounded-xl border bg-white p-6 text-center text-slate-500">لا استلامات معلّقة.</p>}
      <p className="text-xs text-slate-500">الاستلام المعلّق يُسجَّل بلا قيد مالي ولا قيمة افتراضية، ويُربط بالفاتورة عند وصولها.</p>
    </div>}

    {draft && <ReceiveDialog draft={draft} warehouses={wh} suppliers={sup} onClose={() => setDraft(null)} onDone={() => { setDraft(null); void load(); if (open) void expand(open).then(() => expand(open)); }} />}
    {linking && <LinkDialog receipt={linking} onClose={() => setLinking(null)} onDone={() => { setLinking(null); void load(); }} />}
  </div>;
}

function ReceiveDialog({ draft, warehouses, suppliers, onClose, onDone }: { draft: Draft; warehouses: ApiWarehouse[]; suppliers: ApiSupplier[]; onClose: () => void; onDone: () => void }) {
  const line = draft.line;
  const [warehouseId, setWarehouseId] = useState(line?.warehouseId ?? ''), [supplierId, setSupplierId] = useState(draft.invoice?.supplierId ?? ''), [notes, setNotes] = useState('');
  const [kind, setKind] = useState<api.MaterialKind>(line?.materialKind ?? 'FABRIC'), [unit, setUnit] = useState<api.ReceiveUnit>((line?.unit as api.ReceiveUnit) ?? 'meter'), [description, setDescription] = useState(line?.description ?? '');
  const [rolls, setRolls] = useState<RollInput[]>([{}]), [lots, setLots] = useState<LotInput[]>([{ weightKg: 0 }]), [qty, setQty] = useState(''), [factor, setFactor] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const byWeight = kind === 'FABRIC' && unit === 'kg';
  const sameUnit = !line || unit === line.unit || (['meter', 'yard'].includes(unit) && ['meter', 'yard'].includes(line.unit));

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (!warehouseId) throw new Error('اختر المخزن');
      if (!draft.invoice && !supplierId) throw new Error('اختر المورد للاستلام المعلّق');
      const l: ReceiptLineInput = { invoiceLineId: line?.id ?? null, description: description || undefined, materialKind: kind, unit };
      if (kind === 'FABRIC') l.rolls = rolls.filter((r) => r.lengthM || r.weightKg).map((r) => ({ ...r }));
      else if (kind === 'YARN') l.lots = lots.filter((x) => x.weightKg > 0);
      else { l.quantity = Number(qty); if (!sameUnit) l.conversionFactor = Number(factor) || undefined; }
      await api.createReceipt({ invoiceId: draft.invoice?.id ?? null, supplierId: draft.invoice ? undefined : supplierId, warehouseId, notes: notes || undefined, lines: [l] });
      onDone();
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const upd = <T,>(arr: T[], i: number, patch: Partial<T>, set: (v: T[]) => void) => set(arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const num = (v: string) => (v === '' ? undefined : Number(v));

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" dir="rtl">
    <div className="mb-3 flex items-center justify-between"><b className="text-lg">{draft.pending ? 'استلام قبل وصول الفاتورة' : `استلام: ${line?.description}`}</b><button type="button" onClick={onClose} className="rounded-lg border px-2 py-1"><X className="h-4 w-4" /></button></div>
    {line && <p className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">المطلوب {nf(line.quantity)} {UNIT[line.unit]} · المستلم {nf(line.received)} · المتبقي <b>{nf(line.remaining)}</b></p>}
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm font-bold">المخزن<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm font-normal"><option value="">— اختر —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      {!draft.invoice && <label className="text-sm font-bold">المورد<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm font-normal"><option value="">— اختر —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {!line && <label className="text-sm font-bold">نوع المادة<select value={kind} onChange={(e) => { const k = e.target.value as api.MaterialKind; setKind(k); setUnit(k === 'FABRIC' ? 'meter' : k === 'YARN' ? 'kg' : 'piece'); }} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm font-normal">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
      {!line && <label className="text-sm font-bold">وصف المادة<input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label>}
      {kind === 'FABRIC' && !line && <label className="text-sm font-bold">القياس<select value={unit} onChange={(e) => setUnit(e.target.value as api.ReceiveUnit)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm font-normal"><option value="meter">بالمتر</option><option value="yard">بالياردة</option><option value="kg">بالكيلو</option></select></label>}
    </div>

    {kind === 'FABRIC' && <div className="mt-3 space-y-2"><b className="text-sm">الأتواب {byWeight ? '(الوزن بالكيلو؛ الطول يُحسب من العرض والوزن النوعي gsm)' : ''}</b>
      {rolls.map((r, i) => <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-2 sm:grid-cols-6">
        <input placeholder="الباركود (اختياري)" value={r.barcode ?? ''} onChange={(e) => upd(rolls, i, { barcode: e.target.value || undefined }, setRolls)} className="rounded border px-2 py-1 text-sm sm:col-span-2" dir="ltr" />
        {!byWeight && <input type="number" min="0" step="0.01" placeholder="الطول (م)" value={r.lengthM ?? ''} onChange={(e) => upd(rolls, i, { lengthM: num(e.target.value) }, setRolls)} className="rounded border px-2 py-1 text-sm" dir="ltr" />}
        <input type="number" min="0" step="0.01" placeholder="الوزن (كغ)" value={r.weightKg ?? ''} onChange={(e) => upd(rolls, i, { weightKg: num(e.target.value) }, setRolls)} className="rounded border px-2 py-1 text-sm" dir="ltr" />
        <input type="number" min="0" placeholder="العرض سم" value={r.widthCm ?? ''} onChange={(e) => upd(rolls, i, { widthCm: num(e.target.value) }, setRolls)} className="rounded border px-2 py-1 text-sm" dir="ltr" />
        <input type="number" min="0" placeholder="gsm" value={r.gsm ?? ''} onChange={(e) => upd(rolls, i, { gsm: num(e.target.value) }, setRolls)} className="rounded border px-2 py-1 text-sm" dir="ltr" />
        <input placeholder="اللوط" value={r.lotNo ?? ''} onChange={(e) => upd(rolls, i, { lotNo: e.target.value || undefined }, setRolls)} className="rounded border px-2 py-1 text-sm" />
        <input placeholder="اللون" value={r.colorName ?? ''} onChange={(e) => upd(rolls, i, { colorName: e.target.value || undefined }, setRolls)} className="rounded border px-2 py-1 text-sm" />
        <input placeholder="كود اللون" value={r.colorCode ?? ''} onChange={(e) => upd(rolls, i, { colorCode: e.target.value || undefined }, setRolls)} className="rounded border px-2 py-1 text-sm" dir="ltr" />
        {!line && <input placeholder="اسم الخامة" value={r.materialName ?? ''} onChange={(e) => upd(rolls, i, { materialName: e.target.value || undefined }, setRolls)} className="rounded border px-2 py-1 text-sm sm:col-span-2" />}
        {!line && <input placeholder="كود الخامة" value={r.designCode ?? ''} onChange={(e) => upd(rolls, i, { designCode: e.target.value || undefined }, setRolls)} className="rounded border px-2 py-1 text-sm" dir="ltr" />}
      </div>)}
      <button type="button" onClick={() => setRolls([...rolls, {}])} className="rounded-lg border px-3 py-1 text-xs font-bold">+ توب</button></div>}

    {kind === 'YARN' && <div className="mt-3 space-y-2"><b className="text-sm">دفعات الخيط (الأوزان الفعلية)</b>
      {lots.map((l, i) => <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-2 sm:grid-cols-5">
        <input type="number" min="0" step="0.001" placeholder="الوزن (كغ)" value={l.weightKg || ''} onChange={(e) => upd(lots, i, { weightKg: Number(e.target.value) }, setLots)} className="rounded border px-2 py-1 text-sm" dir="ltr" />
        <input placeholder="رقم اللوط" value={l.lotNo ?? ''} onChange={(e) => upd(lots, i, { lotNo: e.target.value || undefined }, setLots)} className="rounded border px-2 py-1 text-sm" />
        <input type="number" min="0" placeholder="عدد الطرود/الشلل" value={l.packages ?? ''} onChange={(e) => upd(lots, i, { packages: num(e.target.value) }, setLots)} className="rounded border px-2 py-1 text-sm" dir="ltr" />
        <input placeholder="اللون" value={l.colorName ?? ''} onChange={(e) => upd(lots, i, { colorName: e.target.value || undefined }, setLots)} className="rounded border px-2 py-1 text-sm" />
        <input placeholder="كود اللون" value={l.colorCode ?? ''} onChange={(e) => upd(lots, i, { colorCode: e.target.value || undefined }, setLots)} className="rounded border px-2 py-1 text-sm" dir="ltr" />
        {!line && <input placeholder="نوع الخيط / النمرة" value={l.materialName ?? ''} onChange={(e) => upd(lots, i, { materialName: e.target.value || undefined }, setLots)} className="rounded border px-2 py-1 text-sm sm:col-span-2" />}
      </div>)}
      <button type="button" onClick={() => setLots([...lots, { weightKg: 0 }])} className="rounded-lg border px-3 py-1 text-xs font-bold">+ دفعة</button></div>}

    {kind === 'OTHER' && <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <label className="text-sm font-bold">الكمية المستلمة<input type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" dir="ltr" /></label>
      <label className="text-sm font-bold">الوحدة<select value={unit} onChange={(e) => setUnit(e.target.value as api.ReceiveUnit)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm font-normal"><option value="piece">قطعة</option><option value="package">طرد</option><option value="kg">كغ</option><option value="meter">متر</option></select></label>
      {!sameUnit && <label className="text-sm font-bold">معامل التحويل (وحدات الفاتورة لكل وحدة استلام)<input type="number" min="0" step="0.0001" value={factor} onChange={(e) => setFactor(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" dir="ltr" /></label>}
    </div>}

    <label className="mt-3 block text-sm font-bold">ملاحظات<input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label>
    {err && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-sm font-bold text-rose-700">{err}</p>}
    <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">إلغاء</button><button type="button" disabled={busy} onClick={() => void submit()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'جارٍ الحفظ…' : 'تسجيل الاستلام'}</button></div>
  </div></div>;
}

function LinkDialog({ receipt, onClose, onDone }: { receipt: ReceiptView; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState(''), [invs, setInvs] = useState<ReceivingInvoice[]>([]), [sel, setSel] = useState<ReceivingInvoice | null>(null), [map, setMap] = useState<Record<string, string>>({}), [fac, setFac] = useState<Record<string, string>>({}), [err, setErr] = useState('');
  useEffect(() => { const t = window.setTimeout(() => { void api.listReceivingInvoices({ search: search || undefined }).then((r) => setInvs(r.filter((i) => i.receiveViaWarehouse))).catch((e) => setErr(msg(e))); }, 250); return () => window.clearTimeout(t); }, [search]);
  const need = useMemo(() => (sel ? receipt.lines.filter((l) => { const il = sel.lines.find((x) => x.id === map[l.id]); return il && il.unit !== l.unit && !(['meter', 'yard'].includes(il.unit) && ['meter', 'yard'].includes(l.unit)); }).map((l) => l.id) : []), [sel, map, receipt]);
  const submit = async () => {
    try {
      if (!sel) throw new Error('اختر الفاتورة');
      await api.linkReceipt(receipt.id, { invoiceId: sel.id, map: receipt.lines.map((l) => ({ receiptLineId: l.id, invoiceLineId: map[l.id], conversionFactor: fac[l.id] ? Number(fac[l.id]) : undefined })) });
      onDone();
    } catch (e) { setErr(msg(e)); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" dir="rtl">
    <div className="mb-3 flex items-center justify-between"><b className="text-lg">ربط {receipt.receiptNo} بفاتورة</b><button type="button" onClick={onClose} className="rounded-lg border px-2 py-1"><X className="h-4 w-4" /></button></div>
    <input placeholder="ابحث برقم فاتورة المورد أو المورد" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2 w-full rounded-lg border px-3 py-2 text-sm" />
    {!sel && <ul className="max-h-48 space-y-1 overflow-auto">{invs.map((i) => <li key={i.id}><button type="button" onClick={() => setSel(i)} className="w-full rounded-lg border p-2 text-right text-sm hover:bg-slate-50">{i.supplierInvoiceNo ?? i.invoiceNo} · {i.supplierName} · {i.invoiceDate}</button></li>)}{!invs.length && <li className="p-2 text-sm text-slate-500">لا فواتير بوضع «استلام عبر المخزن» مطابقة.</li>}</ul>}
    {sel && <div className="space-y-2"><p className="text-sm font-bold">{sel.supplierInvoiceNo ?? sel.invoiceNo} · {sel.supplierName}</p>
      {receipt.lines.map((l) => <div key={l.id} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-3"><span className="text-sm">{l.description || KIND[l.materialKind]} — {nf(l.quantity)} {UNIT[l.unit]}</span>
        <select value={map[l.id] ?? ''} onChange={(e) => setMap({ ...map, [l.id]: e.target.value })} className="rounded border px-2 py-1 text-sm"><option value="">— بند الفاتورة —</option>{sel.lines.map((x) => <option key={x.id} value={x.id}>{x.lineNo}. {x.description} ({UNIT[x.unit]})</option>)}</select>
        {need.includes(l.id) && <input type="number" min="0" step="0.0001" placeholder="معامل التحويل" value={fac[l.id] ?? ''} onChange={(e) => setFac({ ...fac, [l.id]: e.target.value })} className="rounded border px-2 py-1 text-sm" dir="ltr" />}</div>)}
      <p className="text-xs text-slate-500">الربط بلا قيد مالي؛ تُحدَّث تكلفة الأتواب/الدفعات من بند الفاتورة (داخلياً، دون عرضها للمخزن).</p></div>}
    {err && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-sm font-bold text-rose-700">{err}</p>}
    <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">إلغاء</button><button type="button" disabled={!sel} onClick={() => void submit()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">ربط</button></div>
  </div></div>;
}
