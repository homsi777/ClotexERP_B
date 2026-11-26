import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listCashboxes, type CashboxDto } from '../../lib/api/cashboxesApi';
import { createPurchaseInvoice, type PurchaseInvoiceCreatePayload } from '../../lib/api/purchaseInvoicesApi';
import { createCatalogItem, createOperatingWarehouse, listCatalog, listOperatingWarehouses, type CatalogItem, type CatalogKind, type CatalogUnit, type OperatingWarehouse } from '../../lib/api/purchaseCatalogApi';
import { useCurrencyWithBranchDefault } from '../../hooks/useDefaultCurrency';
import { useToast } from '../../components/NonBlockingToast';

type Kind = CatalogKind;
type Unit = CatalogUnit;
const KIND: Record<Kind, string> = { FABRIC: 'قماش', YARN: 'خيط', OTHER: 'مواد أخرى' };
/** وحدات القياس المناسبة لكل نوع مادة. */
const UNITS: Record<Kind, Unit[]> = { FABRIC: ['meter', 'yard', 'kg'], YARN: ['kg', 'package'], OTHER: ['piece', 'package', 'kg', 'meter'] };
const UNIT_LABEL: Record<Unit, string> = { meter: 'متر', yard: 'ياردة', kg: 'كيلوغرام', package: 'طرد', piece: 'قطعة' };
const CURRENCIES = ['EGP', 'USD', 'TRY', 'SYP'];

interface Line { catalogItemId: string; whName: string; opWhId: string; kind: Kind; unit: Unit; name: string; designCode: string; colorName: string; colorCode: string; widthCm: string; gsm: string; qty: string; price: string; warehouseId: string }
const fromCatalog = (c: CatalogItem): Line => ({ catalogItemId: c.id, whName: c.operatingWarehouseName ?? '', opWhId: c.operatingWarehouseId ?? '', kind: c.materialKind, unit: c.defaultUnit, name: c.name, designCode: c.designCode ?? '', colorName: c.colorName ?? '', colorCode: c.colorCode ?? '', widthCm: c.widthCm ? String(c.widthCm) : '', gsm: c.gsm ? String(c.gsm) : '', qty: '', price: '', warehouseId: '' });
const r2 = (n: number) => Math.round(n * 100) / 100;
const nf = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inp = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

/** فاتورة شراء (للمحاسب): بنود بوحدات المتر/الكيلو/الطرد/القطعة، وإجماليات تلقائية، واستلام عبر المخزن بلا أي مخزون أو قيد مكرر. */
export function PurchaseInvoiceCreate() {
  const nav = useNavigate();
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]), [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]), [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [supplierId, setSupplierId] = useState(''), [supplierInvoiceNo, setSupplierInvoiceNo] = useState(''), [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useCurrencyWithBranchDefault<string>(CURRENCIES);
  const [manualRate, setManualRate] = useState(false), [rate, setRate] = useState('');
  const [warehouseId, setWarehouseId] = useState(''), [notes, setNotes] = useState(''), [viaWarehouse, setViaWarehouse] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]), [opWhs, setOpWhs] = useState<OperatingWarehouse[]>([]), [newItem, setNewItem] = useState(false);
  const [payMethod, setPayMethod] = useState<'CASH' | 'CREDIT'>('CREDIT'), [opWhDefault, setOpWhDefault] = useState('');
  const [discount, setDiscount] = useState(''), [tax, setTax] = useState(''), [cashboxId, setCashboxId] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');

  useEffect(() => {
    void listSuppliers({ pageSize: 500 }).then((r) => setSuppliers(r.data)).catch(() => undefined);
    void listWarehouses({}).then(setWarehouses).catch(() => undefined);
    void listCatalog().then(setCatalog).catch(() => undefined);
    void listOperatingWarehouses().then(setOpWhs).catch(() => undefined);
    void listCashboxes({ active: true }).then((r) => setCashboxes(r.data.filter((c) => c.account_kind !== 'CHECKS'))).catch(() => undefined);
  }, []);

  const lineTotal = (l: Line) => r2((Number(l.qty) || 0) * (Number(l.price) || 0));
  const subtotal = useMemo(() => r2(lines.reduce((a, l) => a + lineTotal(l), 0)), [lines]);
  const discountN = Math.max(0, Number(discount) || 0), taxN = Math.max(0, Number(tax) || 0);
  const total = r2(Math.max(0, subtotal - discountN) + taxN);
  const paidN = payMethod === 'CASH' ? total : 0;
  const remaining = r2(Math.max(0, total - paidN));
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cashboxesForCcy = cashboxes.filter((c) => c.currency_code === currency);

  const save = async (confirm: boolean) => {
    setErr('');
    try {
      if (!supplierId) throw new Error('اختر المورد');
      if (!supplierInvoiceNo.trim()) throw new Error('أدخل رقم فاتورة المورد');
      const valid = lines;
      if (!valid.length) throw new Error('أضف بنداً واحداً على الأقل من القائمة');
      for (const [i, l] of valid.entries()) {
        if (!l.name.trim()) throw new Error(`البند ${i + 1}: اسم المادة مطلوب`);
        if (!(Number(l.qty) > 0)) throw new Error(`البند ${i + 1}: الكمية مطلوبة`);
        if (!(Number(l.price) >= 0) || l.price === '') throw new Error(`البند ${i + 1}: سعر الوحدة مطلوب`);
        if (l.kind === 'OTHER' && !(l.opWhId || opWhDefault) && opWhs.length > 0) throw new Error(`البند ${i + 1}: اختر المستودع التشغيلي`);
        if (l.kind === 'FABRIC' && l.unit === 'kg' && !(Number(l.widthCm) > 0 && Number(l.gsm) > 0)) throw new Error(`البند ${i + 1}: القماش بالكيلو يتطلب العرض والوزن النوعي (gsm)`);
      }
      if (!viaWarehouse && valid.some((l) => l.unit === 'package' || l.unit === 'piece')) throw new Error('وحدة الطرد/القطعة تتطلب «استلام عبر المخزن»');
      if (payMethod === 'CASH' && !(total > 0)) throw new Error('الفاتورة النقدية تتطلب إجمالياً أكبر من صفر');
      if (confirm && payMethod === 'CASH' && !cashboxId) throw new Error('اختر الصندوق الذي دُفع منه نقداً');
      const noConversion = currency !== 'USD' && !manualRate;
      const rateN = Number(rate);
      if (currency !== 'USD' && manualRate && !(rateN > 0)) throw new Error('أدخل سعر الصرف اليدوي');
      setBusy(true);
      const payload: PurchaseInvoiceCreatePayload = {
        invoiceNo: '-', supplierId, supplierInvoiceNo: supplierInvoiceNo.trim(), invoiceDate: date, warehouseId: warehouseId || null, currencyCode: currency,
        ...(currency !== 'USD' && manualRate ? { exchangeRateToUsd: rateN } : {}), convertToUsd: !noConversion, notes: notes.trim() || null,
        subtotal, discountTotal: discountN, taxTotal: taxN, totalAmount: total, paidAmount: paidN, remainingAmount: remaining, receiveViaWarehouse: viaWarehouse, paymentMethod: payMethod,
        lines: valid.map((l) => ({
          description: l.name.trim(), quantity: Number(l.qty), unit: l.unit as 'meter', unitPrice: Number(l.price), lineDiscount: 0, lineTax: 0, lineTotal: lineTotal(l),
          catalogItemId: l.catalogItemId, warehouseId: l.warehouseId || null, commodityType: l.kind === 'FABRIC' ? 'FABRIC' : 'YARN',
          metadata: { operatingWarehouseId: l.kind === 'OTHER' ? (l.opWhId || opWhDefault || undefined) : undefined, materialKind: l.kind, materialName: l.name.trim(), designCode: l.designCode || undefined, colorName: l.colorName || undefined, colorCode: l.colorCode || undefined, widthCm: Number(l.widthCm) || undefined, gsm: Number(l.gsm) || undefined },
          // نوع المادة يُحفظ على السطر نفسه (يميّز القماش بالكيلو عن الخيط)
          ...({ materialKind: l.kind } as object),
        })),
        ...({ confirm, cashboxId: confirm && payMethod === 'CASH' ? cashboxId : null } as object),
      } as PurchaseInvoiceCreatePayload;
      const res = await createPurchaseInvoice(payload);
      showToast({ type: 'success', message: `${confirm ? 'تم حفظ واعتماد' : 'تم حفظ مسودة'} الفاتورة ${res.data.invoiceNo}` });
      nav('/invoices/purchases');
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذر الحفظ'); } finally { setBusy(false); }
  };

  const addFromCatalog = (id: string) => {
    const c = catalog.find((x) => x.id === id);
    if (!c) return;
    if (lines.some((l) => l.catalogItemId === c.id)) { setErr('هذا البند مضاف مسبقاً في الفاتورة — عدّل كميته'); return; }
    setErr(''); setLines((ls) => [...ls, fromCatalog(c)]);
  };
  const byKind = (k: Kind) => catalog.filter((c) => c.materialKind === k);

  return <div className="mx-auto max-w-5xl space-y-4" dir="rtl">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-900">فاتورة شراء جديدة</h1><p className="text-sm text-slate-500">اختر البنود من القائمة المرجعية ثم بيانات المورد والدفع؛ يستلم المخزن البضاعة لاحقاً دون قيد مالي ثانٍ.</p></div>
      <Link to="/purchases/receiving" className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-700"><ArrowRight className="h-4 w-4" />استلام المشتريات</Link>
    </div>

    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-lg text-slate-900">1 · البنود</b>
        <button type="button" onClick={() => setNewItem(true)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700"><Plus className="h-3.5 w-3.5" />إضافة بند جديد للقائمة المرجعية</button></div>
      <label className="block text-xs font-bold text-slate-600">أضف بنداً من القائمة (مرجع ثابت لا يتكرر)
        <select value="" onChange={(e) => addFromCatalog(e.target.value)} className={`${inp} mt-1 font-normal`}>
          <option value="">— اختر بنداً لإضافته —</option>
          {(Object.keys(KIND) as Kind[]).map((k) => byKind(k).length > 0 && <optgroup key={k} label={KIND[k]}>{byKind(k).map((c) => <option key={c.id} value={c.id} disabled={lines.some((l) => l.catalogItemId === c.id)}>{c.name}{c.designCode ? ` · ${c.designCode}` : ''}{c.colorName ? ` · ${c.colorName}` : ''}{c.colorCode ? ` (${c.colorCode})` : ''}</option>)}</optgroup>)}
        </select></label>
      {!catalog.length && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">القائمة فارغة — أضف أول بند بزر «إضافة بند جديد للقائمة المرجعية».</p>}
      {lines.map((l, i) => <div key={l.catalogItemId} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex items-center justify-between gap-2"><div className="min-w-0"><span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">{i + 1} · {KIND[l.kind]}</span>
          <b className="mr-2 text-sm text-slate-900">{l.name}</b><span className="text-xs text-slate-500" dir="ltr">{[l.designCode, l.colorName, l.colorCode, l.widthCm && `${l.widthCm}cm`, l.gsm && `${l.gsm}gsm`].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" aria-label="حذف البند" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-lg border bg-white p-1.5 text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
        {l.kind === 'FABRIC' && l.unit === 'kg' && (!l.widthCm || !l.gsm) && <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-600">عرض التوب (سم) *<input type="number" min="0" value={l.widthCm} onChange={(e) => set(i, { widthCm: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
          <label className="text-xs font-bold text-slate-600">الوزن النوعي gsm *<input type="number" min="0" value={l.gsm} onChange={(e) => set(i, { gsm: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label></div>}
        <div className="grid gap-2 sm:grid-cols-5">
          <label className="text-xs font-bold text-slate-600">وحدة القياس<select value={l.unit} onChange={(e) => set(i, { unit: e.target.value as Unit })} className={`${inp} mt-1 font-normal`}>{UNITS[l.kind].map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-600">الكمية<input type="number" min="0" step="0.001" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
          <label className="text-xs font-bold text-slate-600">{l.unit === 'kg' ? 'سعر الكيلو' : 'سعر الوحدة'} ({currency})<input type="number" min="0" step="0.0001" value={l.price} onChange={(e) => set(i, { price: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
          {l.kind === 'OTHER' ? <label className="text-xs font-bold text-slate-600">المستودع التشغيلي<select value={l.opWhId} onChange={(e) => set(i, { opWhId: e.target.value })} className={`${inp} mt-1 font-normal`}><option value="">{opWhDefault ? '— افتراضي الفاتورة —' : '— اختر —'}</option>{opWhs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            : <label className="text-xs font-bold text-slate-600">المخزن<select value={l.warehouseId} onChange={(e) => set(i, { warehouseId: e.target.value })} className={`${inp} mt-1 font-normal`}><option value="">— الافتراضي —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
          <div className="text-xs font-bold text-slate-600">إجمالي البند<div className="mt-1 rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-900 ring-1 ring-slate-200" dir="ltr">{nf(lineTotal(l))} {currency}</div></div>
        </div>
        {l.unit === 'kg' && <p className="text-xs font-bold text-emerald-700">انتبه: السعر هنا للكيلوغرام الواحد وليس للمتر.</p>}
      </div>)}
    </section>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      <b className="text-lg text-slate-900 sm:col-span-2 lg:col-span-4">2 · بيانات الفاتورة</b>
      <label className="text-xs font-bold text-slate-600">المورد<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— اختر المورد —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">رقم فاتورة المورد<input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
      <label className="text-xs font-bold text-slate-600">تاريخ الفاتورة<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inp} mt-1 font-normal`} /></label>
      <label className="text-xs font-bold text-slate-600">العملة<select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inp} mt-1 font-normal`}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">المخزن الافتراضي<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— حسب البند —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      {lines.some((l) => l.kind === 'OTHER') && <label className="text-xs font-bold text-slate-600">المستودع التشغيلي الافتراضي (للمواد الأخرى)<select value={opWhDefault} onChange={(e) => setOpWhDefault(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— حسب البند —</option>{opWhs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>{!opWhs.length && <span className="mt-1 block font-normal text-amber-700">لا مستودعات تشغيلية بعد — أنشئ من «المستودعات التشغيلية».</span>}</label>}
      {currency !== 'USD' && <div className="text-xs font-bold text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={manualRate} onChange={(e) => setManualRate(e.target.checked)} />معادل بالدولار (سعر صرف يدوي)</label>{manualRate ? <input type="number" min="0" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={`${currency} لكل 1 USD`} className={`${inp} mt-1 font-normal`} dir="ltr" /> : <p className="mt-1 font-normal text-slate-500">مطفأ: تُسجَّل الفاتورة بعملتها {currency} فقط.</p>}</div>}
      <label className="flex items-start gap-2 rounded-xl bg-indigo-50 p-3 text-xs font-bold text-indigo-900 sm:col-span-2"><input type="checkbox" checked={viaWarehouse} onChange={(e) => setViaWarehouse(e.target.checked)} className="mt-0.5" /><span>استلام عبر المخزن<span className="block font-normal text-indigo-700">لا تُنشئ الفاتورة أتواباً ولا دفعات؛ يسجّلها المخزن عند الاستلام. أطفئه فقط لسلوك الاستلام التلقائي القديم.</span></span></label>
    </section>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-2">
      <div className="space-y-3">
        <b className="text-lg text-slate-900">3 · طريقة الدفع</b>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="طريقة الدفع">
          {([['CASH', 'نقدي', 'يُدفع كامل الإجمالي الآن من صندوق'], ['CREDIT', 'آجل', 'يُسجَّل المبلغ ذمّة على المورد']] as const).map(([v, label, hint]) =>
            <button key={v} type="button" role="radio" aria-checked={payMethod === v} onClick={() => setPayMethod(v)} className={`rounded-xl border-2 p-3 text-right ${payMethod === v ? (v === 'CASH' ? 'border-emerald-500 bg-emerald-50' : 'border-amber-500 bg-amber-50') : 'border-slate-200 bg-white'}`}><b className="block text-base">{label}</b><span className="text-xs text-slate-600">{hint}</span></button>)}
        </div>
        {payMethod === 'CASH' && <label className="block text-xs font-bold text-slate-600">الصندوق ({currency})<select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— اختر الصندوق —</option>{cashboxesForCcy.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className="block text-xs font-bold text-slate-600">ملاحظات<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inp} mt-1 font-normal`} /></label>
      </div>
      <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between"><span className="text-slate-600">مجموع البنود</span><b dir="ltr">{nf(subtotal)} {currency}</b></div>
        <label className="flex items-center justify-between gap-2"><span className="text-slate-600">الخصم</span><input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${inp} w-32 font-normal`} dir="ltr" /></label>
        <label className="flex items-center justify-between gap-2"><span className="text-slate-600">الضريبة</span><input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} className={`${inp} w-32 font-normal`} dir="ltr" /></label>
        <div className="flex justify-between border-t pt-2 text-base"><span className="font-black">إجمالي الفاتورة</span><b className="text-indigo-700" dir="ltr">{nf(total)} {currency}</b></div>
        <div className="flex justify-between text-xs text-slate-500"><span>{payMethod === 'CASH' ? 'المدفوع نقداً' : 'المتبقي على المورد (آجل)'}</span><span dir="ltr">{nf(payMethod === 'CASH' ? paidN : remaining)} {currency}</span></div>
      </div>
    </section>

    {err && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{err}</p>}
    <p className="text-xs text-slate-500">بعد الحفظ تظهر الفاتورة في «فواتير الشراء» حيث تراجعها وتطبع كشفها.</p>
    <div className="flex flex-wrap justify-end gap-2 pb-24">
      <button type="button" disabled={busy} onClick={() => void save(false)} className="rounded-xl border bg-white px-5 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">حفظ كمسودة</button>
      <button type="button" disabled={busy} onClick={() => void save(true)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}حفظ واعتماد</button>
    </div>
    {newItem && <NewCatalogItemDialog opWhs={opWhs} onClose={() => setNewItem(false)} onCreated={(c) => { setCatalog((cs) => [...cs, c]); setLines((ls) => [...ls, fromCatalog(c)]); setNewItem(false); }} onWhCreated={(w) => setOpWhs((x) => [...x, w])} />}
  </div>;
}

/** إضافة بند إلى القائمة المرجعية (يُمنع التكرار بالاسم/الكود/اللون). المواد الأخرى تُربط بمستودع تشغيلي. */
function NewCatalogItemDialog({ opWhs, onClose, onCreated, onWhCreated }: { opWhs: OperatingWarehouse[]; onClose: () => void; onCreated: (c: CatalogItem) => void; onWhCreated: (w: OperatingWarehouse) => void }) {
  const [kind, setKind] = useState<Kind>('FABRIC'), [unit, setUnit] = useState<Unit>('meter'), [name, setName] = useState('');
  const [designCode, setDesignCode] = useState(''), [colorName, setColorName] = useState(''), [colorCode, setColorCode] = useState(''), [widthCm, setWidthCm] = useState(''), [gsm, setGsm] = useState('');
  const [opWh, setOpWh] = useState(''), [newWh, setNewWh] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const pickKind = (k: Kind) => { setKind(k); setUnit(UNITS[k][0]); };
  const addWh = async () => {
    if (!newWh.trim()) return;
    try { const w = await createOperatingWarehouse({ name: newWh.trim() }); onWhCreated({ id: w.id, name: w.name, notes: null, isActive: true, items: 0 }); setOpWh(w.id); setNewWh(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'تعذر إنشاء المستودع'); }
  };
  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const c = await createCatalogItem({ materialKind: kind, name: name.trim(), defaultUnit: unit, designCode: designCode.trim() || null, colorName: colorName.trim() || null, colorCode: colorCode.trim() || null, widthCm: Number(widthCm) || null, gsm: Number(gsm) || null, operatingWarehouseId: kind === 'OTHER' ? opWh || null : null });
      onCreated(c);
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذر الحفظ'); } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" dir="rtl" onClick={onClose}><div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
    <b className="text-lg">إضافة بند للقائمة المرجعية</b>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs font-bold text-slate-600">نوع المادة<select value={kind} onChange={(e) => pickKind(e.target.value as Kind)} className={`${inp} mt-1 font-normal`}>{(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">الوحدة الافتراضية<select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={`${inp} mt-1 font-normal`}>{UNITS[kind].map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600 sm:col-span-2">الاسم<input value={name} onChange={(e) => setName(e.target.value)} className={`${inp} mt-1 font-normal`} autoFocus /></label>
      {kind !== 'OTHER' && <>
        <label className="text-xs font-bold text-slate-600">كود الخامة / التصميم<input value={designCode} onChange={(e) => setDesignCode(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
        <label className="text-xs font-bold text-slate-600">اللون<input value={colorName} onChange={(e) => setColorName(e.target.value)} className={`${inp} mt-1 font-normal`} /></label>
        <label className="text-xs font-bold text-slate-600">كود اللون<input value={colorCode} onChange={(e) => setColorCode(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label></>}
      {kind === 'FABRIC' && <>
        <label className="text-xs font-bold text-slate-600">عرض التوب (سم)<input type="number" min="0" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
        <label className="text-xs font-bold text-slate-600">الوزن النوعي gsm<input type="number" min="0" value={gsm} onChange={(e) => setGsm(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label></>}
    </div>
    {kind === 'OTHER' && <div className="space-y-2 rounded-xl bg-slate-50 p-3">
      <label className="block text-xs font-bold text-slate-600">المستودع التشغيلي (تدخله هذه المادة عند الاستلام)<select value={opWh} onChange={(e) => setOpWh(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— بلا مستودع —</option>{opWhs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <div className="flex gap-2"><input value={newWh} onChange={(e) => setNewWh(e.target.value)} placeholder="أو أنشئ مستودعاً تشغيلياً جديداً" className={`${inp} font-normal`} /><button type="button" onClick={() => void addWh()} className="shrink-0 rounded-lg border bg-white px-3 text-xs font-bold">إنشاء</button></div></div>}
    {err && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm font-bold text-rose-700">{err}</p>}
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-bold">إلغاء</button><button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '...' : 'حفظ وإضافة للفاتورة'}</button></div>
  </div></div>;
}
