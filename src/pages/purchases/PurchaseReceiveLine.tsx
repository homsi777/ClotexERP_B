import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, Loader2, Plus, Trash2, Wand2, X } from 'lucide-react';
import * as api from '../../lib/api/purchaseReceivingApi';
import type { ReceivingInvoice, ReceivingLine } from '../../lib/api/purchaseReceivingApi';
import { createCategory, getCategoryTree, type ApiCategory } from '../../lib/api/fabricCategoriesApi';
import { getNextRollBarcode } from '../../lib/api/fabricRollsApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../components/NonBlockingToast';

/**
 * شاشة استلام بند قماش من فاتورة شراء بنفس روح «إنشاء مادة جديدة»: اختيار الخامة/الكود/اللون/كود اللون من شجرة التصنيف
 * (مع «إضافة تصنيف جديد»)، وقائمة أتواب بالباركود والطول أو الوزن. لا تُنشئ فاتورة ولا قيداً مالياً: تسجّل الكمية الفعلية فقط.
 */
const UNIT_LABEL: Record<string, string> = { meter: 'م', yard: 'ياردة', kg: 'كغ' };
const STATUS_LABEL: Record<string, string> = { NOT_RECEIVED: 'لم يُستلم', PARTIAL: 'استلام جزئي', COMPLETE: 'اكتمل الاستلام', OVER: 'زيادة' };
const nf = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const inp = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';
const bump = (b: string) => { const m = /^(.*?)(\d+)$/.exec(b); return m ? `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}` : b; };

interface RollRow { barcode: string; qty: number; lot: string; widthCm: string; gsm: string }
type Level = 1 | 2 | 3 | 4;
const LEVEL_LABEL: Record<Level, string> = { 1: 'الخامة', 2: 'كود الخامة', 3: 'اللون', 4: 'كود اللون' };

export function PurchaseReceiveLine() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { showToast } = useToast();
  const { user } = usePermissions();
  const invoiceId = sp.get('invoice') ?? '', lineId = sp.get('line') ?? '';
  const [invoice, setInvoice] = useState<ReceivingInvoice | null>(null), [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]), [tree, setTree] = useState<ApiCategory[]>([]);
  const [sel, setSel] = useState<Record<Level, string>>({ 1: '', 2: '', 3: '', 4: '' });
  const [warehouseId, setWarehouseId] = useState(''), [notes, setNotes] = useState('');
  const [rolls, setRolls] = useState<RollRow[]>([]);
  const [barcode, setBarcode] = useState(''), [qty, setQty] = useState(''), [lot, setLot] = useState(''), [widthCm, setWidthCm] = useState(''), [gsm, setGsm] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [eye, setEye] = useState(false), [newCat, setNewCat] = useState<Level | null>(null), [allowOver, setAllowOver] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const done = useRef(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  const line: ReceivingLine | undefined = invoice?.lines.find((l) => l.id === lineId);
  const unit = line?.unit ?? 'meter';
  const byWeight = unit === 'kg';
  const canOver = user?.role === 'admin' || user?.role === 'manager';

  const loadTree = useCallback(async () => { try { setTree(await getCategoryTree()); } catch { /* يبقى فارغاً */ } }, []);
  useEffect(() => {
    if (!invoiceId) return;
    void api.getReceivingInvoice(invoiceId).then((r) => setInvoice(r.invoice)).catch((e) => setErr(e instanceof Error ? e.message : 'تعذر تحميل الفاتورة'));
    void listWarehouses({}).then(setWarehouses).catch(() => undefined);
    void loadTree();
    void getNextRollBarcode().then(setBarcode).catch(() => undefined);
  }, [invoiceId, loadTree]);

  const find = (nodes: ApiCategory[], id: string): ApiCategory | null => { for (const n of nodes) { if (n.id === id) return n; const c = n.children ? find(n.children, id) : null; if (c) return c; } return null; };
  const kids = (parent: string | null): ApiCategory[] => (parent === null ? tree : find(tree, parent)?.children ?? []).filter((c) => c.is_active !== false);
  const options: Record<Level, ApiCategory[]> = { 1: kids(null), 2: sel[1] ? kids(sel[1]) : [], 3: sel[2] ? kids(sel[2]) : [], 4: sel[3] ? kids(sel[3]) : [] };
  const node = (lv: Level) => (sel[lv] ? find(tree, sel[lv]) : null);

  // تعبئة مسبقة بمطابقة بيانات بند الفاتورة مع شجرة التصنيف (إن وُجدت)
  useEffect(() => {
    if (!line || !tree.length || sel[1]) return;
    const d = line.details as Record<string, unknown>;
    const n1 = tree.find((c) => norm(c.name) === norm(d.materialName ?? line.description) || norm(c.code) === norm(d.materialName));
    if (!n1) return;
    const n2 = (n1.children ?? []).find((c) => norm(c.code) === norm(d.designCode) || norm(c.name) === norm(d.designCode));
    const n3 = n2 ? (n2.children ?? []).find((c) => norm(c.name) === norm(d.colorName)) : undefined;
    const n4 = n3 ? (n3.children ?? []).find((c) => norm(c.code) === norm(d.colorCode) || norm(c.name) === norm(d.colorCode)) : undefined;
    setSel({ 1: n1.id, 2: n2?.id ?? '', 3: n3?.id ?? '', 4: n4?.id ?? '' });
    if (d.widthCm) setWidthCm(String(d.widthCm));
    if (d.gsm) setGsm(String(d.gsm));
  }, [line, tree]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (lv: Level, id: string) => setSel((s) => { const n = { ...s, [lv]: id }; for (let k = lv + 1; k <= 4; k++) n[k as Level] = ''; return n; });

  const entered = useMemo(() => rolls.reduce((a, r) => a + r.qty, 0), [rolls]);
  const enteredInUnit = unit === 'yard' ? entered / 0.9144 : entered;
  const remaining = line?.remaining ?? 0;
  const over = enteredInUnit > remaining + 0.0005;

  const addRoll = () => {
    setErr('');
    const q = Number(qty);
    if (!(q > 0)) { setErr(byWeight ? 'أدخل وزن التوب بالكيلو' : 'أدخل طول التوب بالمتر'); return; }
    if (barcode && rolls.some((r) => r.barcode === barcode)) { setErr('الباركود مكرر في القائمة'); return; }
    setRolls((rs) => [...rs, { barcode, qty: q, lot, widthCm, gsm }]);
    setBarcode((b) => (b ? bump(b) : b)); setQty(''); qtyRef.current?.focus();
  };
  const genBarcode = async () => { try { setBarcode(await getNextRollBarcode()); } catch { /* */ } };

  const save = async () => {
    if (busy || done.current || !line || !invoice) return;
    setErr('');
    if (!sel[1]) { setErr('اختر الخامة من التصنيف'); return; }
    if (!warehouseId) { setErr('اختر المخزن'); return; }
    if (!rolls.length) { setErr('أضف توباً واحداً على الأقل إلى القائمة'); return; }
    if (over && !(canOver && allowOver)) { setErr(`الكمية المُدخلة (${nf(enteredInUnit)}) تتجاوز المتبقي (${nf(remaining)}) — ${canOver ? 'فعّل «تأكيد تجاوز المتبقي» للمتابعة' : 'تجاوز المتبقي يتطلب صلاحية المدير'}`); return; }
    setBusy(true);
    try {
      const names = { materialName: node(1)?.name ?? line.description, designCode: node(2)?.code ?? undefined, colorName: node(3)?.name ?? undefined, colorCode: node(4)?.code ?? undefined };
      await api.createReceipt({
        invoiceId: invoice.id, warehouseId, notes: notes || undefined, clientRequestId: requestId.current, allowOver: over && canOver && allowOver ? true : undefined,
        lines: [{
          invoiceLineId: line.id, materialKind: 'FABRIC', unit: unit as api.ReceiveUnit, description: line.description,
          rolls: rolls.map((r) => ({
            barcode: r.barcode || undefined, ...(byWeight ? { weightKg: r.qty } : { lengthM: r.qty }), lotNo: r.lot || undefined,
            widthCm: Number(r.widthCm) || undefined, gsm: Number(r.gsm) || undefined, ...names,
          })),
        }],
      } as api.ReceiptInput);
      done.current = true;
      showToast({ type: 'success', message: 'تم تسجيل الاستلام وإضافة الكمية للمخزن' });
      nav('/purchases/receiving');
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذر حفظ الاستلام'); } finally { setBusy(false); }
  };

  if (!invoiceId || !lineId) return <div className="p-6 text-center text-slate-600" dir="rtl">لم يُحدَّد بند للاستلام. <Link to="/purchases/receiving" className="font-bold text-indigo-700">عودة لاستلام المشتريات</Link></div>;
  if (invoice && !line) return <div className="p-6 text-center text-slate-600" dir="rtl">البند غير موجود. <Link to="/purchases/receiving" className="font-bold text-indigo-700">عودة</Link></div>;

  return <div className="mx-auto max-w-5xl space-y-4" dir="rtl">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-900">استلام بند من فاتورة شراء</h1>
        <p className="text-sm text-slate-500">عرّف الخامة وأدخل الأتواب المستلمة فعلياً؛ لا تُنشأ فاتورة ولا قيد مالي، والفاتورة الأصلية تبقى المرجع للسعر والمورد.</p></div>
      <Link to="/purchases/receiving" className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-700"><ArrowRight className="h-4 w-4" />استلام المشتريات</Link>
    </div>

    {!invoice || !line ? <div className="p-8 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div> : <>
      <section className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-5">
        <div><div className="text-xs text-slate-500">الفاتورة</div><b dir="ltr">{invoice.invoiceNo}</b><div className="text-xs text-slate-500">{invoice.supplierName}</div></div>
        <div className="sm:col-span-2"><div className="text-xs text-slate-500">البند</div><b>{line.description}</b>
          <button type="button" onClick={() => setEye(true)} className="mr-2 inline-flex items-center gap-1 rounded-lg border bg-slate-50 px-2 py-0.5 text-xs font-bold text-indigo-700" aria-label="عرض معلومات الخامة"><Eye className="h-3.5 w-3.5" />معلومات</button></div>
        <div><div className="text-xs text-slate-500">المطلوب / المستلم</div><b className="font-mono">{nf(line.quantity)} / {nf(line.received)}</b> {UNIT_LABEL[unit]}</div>
        <div><div className="text-xs text-slate-500">المتبقي · الحالة</div><b className="font-mono">{nf(line.remaining)}</b> <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">{STATUS_LABEL[line.status]}</span></div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <b className="text-lg">تعريف الخامة (من شجرة التصنيف)</b>
        <div className="grid gap-3 sm:grid-cols-2">
          {([1, 2, 3, 4] as Level[]).map((lv) => <div key={lv}>
            <label className="text-xs font-bold text-slate-600">{LEVEL_LABEL[lv]}</label>
            <div className="mt-1 flex gap-1.5">
              <select value={sel[lv]} disabled={lv > 1 && !sel[(lv - 1) as Level]} onChange={(e) => pick(lv, e.target.value)} className={`${inp} font-normal disabled:opacity-50`}>
                <option value="">— اختر —</option>
                {options[lv].map((c) => <option key={c.id} value={c.id}>{lv === 1 || lv === 3 ? c.name : c.code}{lv === 2 || lv === 4 ? '' : c.code ? ` (${c.code})` : ''}</option>)}
              </select>
              <button type="button" disabled={lv > 1 && !sel[(lv - 1) as Level]} onClick={() => setNewCat(lv)} title="إضافة تصنيف جديد" className="inline-flex shrink-0 items-center gap-1 rounded-lg border bg-slate-50 px-2 text-xs font-bold text-indigo-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />تصنيف جديد</button>
            </div>
          </div>)}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <b className="text-lg">إضافة توب</b>
        <div className="grid gap-2 sm:grid-cols-6">
          <label className="text-xs font-bold text-slate-600 sm:col-span-2">الباركود<div className="mt-1 flex gap-1.5"><input value={barcode} onChange={(e) => setBarcode(e.target.value)} className={`${inp} font-mono font-normal`} dir="ltr" /><button type="button" onClick={() => void genBarcode()} className="shrink-0 rounded-lg border bg-slate-50 px-2" aria-label="توليد باركود"><Wand2 className="h-4 w-4" /></button></div></label>
          <label className="text-xs font-bold text-slate-600">{byWeight ? 'الوزن (كغ)' : 'الطول (م)'}<input ref={qtyRef} type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRoll(); } }} className={`${inp} mt-1 font-mono font-normal`} dir="ltr" autoFocus /></label>
          <label className="text-xs font-bold text-slate-600">اللوط<input value={lot} onChange={(e) => setLot(e.target.value)} className={`${inp} mt-1 font-normal`} /></label>
          <label className="text-xs font-bold text-slate-600">العرض (سم) <span className="font-normal text-slate-400">معلومة</span><input type="number" min="0" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
          <label className="text-xs font-bold text-slate-600">gsm <span className="font-normal text-slate-400">معلومة</span><input type="number" min="0" value={gsm} onChange={(e) => setGsm(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
        </div>
        <button type="button" onClick={addRoll} className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"><Plus className="h-4 w-4" />إضافة للقائمة (Enter)</button>
        {byWeight && <p className="text-xs font-bold text-emerald-700">الاستلام بالكيلو: الكمية هي الوزن نفسه ولا يُسجَّل متر؛ العرض وgsm معلومات فقط.</p>}
      </section>

      <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-lg">الأتواب المُدخلة ({rolls.length})</b>
          <span className={`text-sm font-bold ${over ? 'text-rose-700' : 'text-slate-700'}`}>المُدخل {nf(enteredInUnit)} {UNIT_LABEL[unit]} من المتبقي {nf(remaining)}</span></div>
        {rolls.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="p-2 text-right">#</th><th className="p-2 text-right">الباركود</th><th className="p-2">{byWeight ? 'الوزن' : 'الطول'}</th><th className="p-2">اللوط</th><th className="p-2" /></tr></thead>
          <tbody>{rolls.map((r, i) => <tr key={i} className="border-t"><td className="p-2">{i + 1}</td><td className="p-2 font-mono" dir="ltr">{r.barcode || '—'}</td><td className="p-2 text-center font-mono">{nf(r.qty)} {byWeight ? 'كغ' : 'م'}</td><td className="p-2 text-center">{r.lot || '—'}</td>
            <td className="p-2"><button type="button" aria-label="حذف" onClick={() => setRolls(rolls.filter((_, j) => j !== i))} className="rounded-lg border p-1 text-rose-600"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>}
        {over && <div className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">الكمية تتجاوز المتبقي. {canOver ? <label className="mr-2 inline-flex items-center gap-1.5 font-normal"><input type="checkbox" checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} />تأكيد تجاوز المتبقي (بصلاحية المدير)</label> : 'تجاوز المتبقي يتطلب صلاحية المدير.'}</div>}
      </section>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-600">المخزن<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— اختر المخزن —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-600">ملاحظات<input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inp} mt-1 font-normal`} /></label>
      </section>

      {err && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{err}</p>}
      <p className="text-xs text-slate-500">لا تظهر الكمية في المخزون قبل الضغط على «حفظ الاستلام»، ولا يتكرر الإدخال عند تكرار الضغط.</p>
      <div className="flex justify-end gap-2 pb-24">
        <Link to="/purchases/receiving" className="rounded-xl border bg-white px-5 py-2.5 text-sm font-bold text-slate-700">إلغاء</Link>
        <button type="button" disabled={busy || !rolls.length} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}حفظ الاستلام</button>
      </div>
    </>}

    {eye && line && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={() => setEye(false)}><div className="w-full max-w-md space-y-2 rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()} dir="rtl">
      <div className="flex items-center justify-between"><b className="text-lg">معلومات الخامة</b><button type="button" onClick={() => setEye(false)} className="rounded-lg border p-1" aria-label="إغلاق"><X className="h-4 w-4" /></button></div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-slate-500">وصف البند</dt><dd className="font-bold">{line.description}</dd>
        {Object.entries(line.details as Record<string, unknown>).map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{({ materialName: 'الخامة', designCode: 'كود الخامة', colorName: 'اللون', colorCode: 'كود اللون', widthCm: 'العرض (سم)', gsm: 'gsm', lotNo: 'اللوط' } as Record<string, string>)[k] ?? k}</dt><dd className="font-mono">{String(v)}</dd></Fragment>)}
        <dt className="text-slate-500">المطلوب</dt><dd className="font-mono">{nf(line.quantity)} {UNIT_LABEL[unit]}</dd>
        <dt className="text-slate-500">المستلم</dt><dd className="font-mono">{nf(line.received)}</dd>
        <dt className="text-slate-500">المتبقي</dt><dd className="font-mono">{nf(line.remaining)}</dd>
        <dt className="text-slate-500">التصنيف المختار</dt><dd className="font-bold">{[node(1)?.name, node(2)?.code, node(3)?.name, node(4)?.code].filter(Boolean).join(' / ') || '—'}</dd>
      </dl></div></div>}

    {newCat && <NewCategoryDialog level={newCat} parent={newCat > 1 ? node((newCat - 1) as Level) : null} onClose={() => setNewCat(null)} onCreated={async (c) => { await loadTree(); pick(newCat, c.id); setNewCat(null); }} />}
  </div>;
}

/** إضافة تصنيف جديد (خامة/كود/لون/كود لون) تحت المستوى السابق — بنفس واجهة شجرة التصنيف الموجودة. */
function NewCategoryDialog({ level, parent, onClose, onCreated }: { level: Level; parent: ApiCategory | null; onClose: () => void; onCreated: (c: ApiCategory) => void | Promise<void> }) {
  const [name, setName] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const needName = level === 1 || level === 3;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const c = await createCategory({ code: (code || name).trim(), name: (name || code).trim(), parent_id: parent?.id ?? null });
      await onCreated(c);
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذر إنشاء التصنيف'); } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}><div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()} dir="rtl">
    <b className="text-lg">إضافة {LEVEL_LABEL[level]} جديد{parent ? ` تحت: ${parent.name || parent.code}` : ''}</b>
    {needName && <label className="block text-xs font-bold text-slate-600">الاسم<input value={name} onChange={(e) => setName(e.target.value)} className={`${inp} mt-1 font-normal`} autoFocus /></label>}
    <label className="block text-xs font-bold text-slate-600">{needName ? 'الكود (اختياري)' : 'الكود'}<input value={code} onChange={(e) => setCode(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" autoFocus={!needName} /></label>
    {err && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm font-bold text-rose-700">{err}</p>}
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-bold">إلغاء</button><button type="button" disabled={busy || !(name.trim() || code.trim())} onClick={() => void submit()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '...' : 'حفظ'}</button></div>
  </div></div>;
}
