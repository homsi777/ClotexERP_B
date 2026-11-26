import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listCashboxes, type CashboxDto } from '../../lib/api/cashboxesApi';
import { createPurchaseInvoice, type PurchaseInvoiceCreatePayload } from '../../lib/api/purchaseInvoicesApi';
import { useCurrencyWithBranchDefault } from '../../hooks/useDefaultCurrency';
import { useToast } from '../../components/NonBlockingToast';

type Kind = 'FABRIC' | 'YARN' | 'OTHER';
type Unit = 'meter' | 'yard' | 'kg' | 'package' | 'piece';
const KIND: Record<Kind, string> = { FABRIC: 'قماش', YARN: 'خيط', OTHER: 'مواد أخرى' };
/** وحدات القياس المناسبة لكل نوع مادة. */
const UNITS: Record<Kind, Unit[]> = { FABRIC: ['meter', 'yard', 'kg'], YARN: ['kg', 'package'], OTHER: ['piece', 'package', 'kg', 'meter'] };
const UNIT_LABEL: Record<Unit, string> = { meter: 'متر', yard: 'ياردة', kg: 'كيلوغرام', package: 'طرد', piece: 'قطعة' };
const CURRENCIES = ['EGP', 'USD', 'TRY', 'SYP'];

interface Line { kind: Kind; unit: Unit; name: string; designCode: string; colorName: string; colorCode: string; widthCm: string; gsm: string; qty: string; price: string; warehouseId: string }
const blank = (kind: Kind = 'FABRIC'): Line => ({ kind, unit: UNITS[kind][0], name: '', designCode: '', colorName: '', colorCode: '', widthCm: '', gsm: '', qty: '', price: '', warehouseId: '' });
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
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [discount, setDiscount] = useState(''), [tax, setTax] = useState(''), [paid, setPaid] = useState(''), [cashboxId, setCashboxId] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');

  useEffect(() => {
    void listSuppliers({ pageSize: 500 }).then((r) => setSuppliers(r.data)).catch(() => undefined);
    void listWarehouses({}).then(setWarehouses).catch(() => undefined);
    void listCashboxes({ active: true }).then((r) => setCashboxes(r.data.filter((c) => c.account_kind !== 'CHECKS'))).catch(() => undefined);
  }, []);

  const lineTotal = (l: Line) => r2((Number(l.qty) || 0) * (Number(l.price) || 0));
  const subtotal = useMemo(() => r2(lines.reduce((a, l) => a + lineTotal(l), 0)), [lines]);
  const discountN = Math.max(0, Number(discount) || 0), taxN = Math.max(0, Number(tax) || 0), paidN = Math.max(0, Number(paid) || 0);
  const total = r2(Math.max(0, subtotal - discountN) + taxN);
  const remaining = r2(Math.max(0, total - paidN));
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cashboxesForCcy = cashboxes.filter((c) => c.currency_code === currency);

  const save = async (confirm: boolean) => {
    setErr('');
    try {
      if (!supplierId) throw new Error('اختر المورد');
      if (!supplierInvoiceNo.trim()) throw new Error('أدخل رقم فاتورة المورد');
      const valid = lines.filter((l) => l.name.trim() || Number(l.qty) > 0);
      if (!valid.length) throw new Error('أضف بنداً واحداً على الأقل');
      for (const [i, l] of valid.entries()) {
        if (!l.name.trim()) throw new Error(`البند ${i + 1}: اسم المادة مطلوب`);
        if (!(Number(l.qty) > 0)) throw new Error(`البند ${i + 1}: الكمية مطلوبة`);
        if (!(Number(l.price) >= 0) || l.price === '') throw new Error(`البند ${i + 1}: سعر الوحدة مطلوب`);
        if (l.kind === 'FABRIC' && l.unit === 'kg' && !(Number(l.widthCm) > 0 && Number(l.gsm) > 0)) throw new Error(`البند ${i + 1}: القماش بالكيلو يتطلب العرض والوزن النوعي (gsm)`);
      }
      if (!viaWarehouse && valid.some((l) => l.unit === 'package' || l.unit === 'piece')) throw new Error('وحدة الطرد/القطعة تتطلب «استلام عبر المخزن»');
      if (paidN > total + 0.004) throw new Error('المدفوع أكبر من إجمالي الفاتورة');
      if (confirm && paidN > 0 && !cashboxId) throw new Error('اختر الصندوق لتسجيل الدفعة');
      const noConversion = currency !== 'USD' && !manualRate;
      const rateN = Number(rate);
      if (currency !== 'USD' && manualRate && !(rateN > 0)) throw new Error('أدخل سعر الصرف اليدوي');
      setBusy(true);
      const payload: PurchaseInvoiceCreatePayload = {
        invoiceNo: '-', supplierId, supplierInvoiceNo: supplierInvoiceNo.trim(), invoiceDate: date, warehouseId: warehouseId || null, currencyCode: currency,
        ...(currency !== 'USD' && manualRate ? { exchangeRateToUsd: rateN } : {}), convertToUsd: !noConversion, notes: notes.trim() || null,
        subtotal, discountTotal: discountN, taxTotal: taxN, totalAmount: total, paidAmount: paidN, remainingAmount: remaining, receiveViaWarehouse: viaWarehouse,
        lines: valid.map((l) => ({
          description: l.name.trim(), quantity: Number(l.qty), unit: l.unit as 'meter', unitPrice: Number(l.price), lineDiscount: 0, lineTax: 0, lineTotal: lineTotal(l),
          warehouseId: l.warehouseId || null, commodityType: l.kind === 'FABRIC' ? 'FABRIC' : 'YARN',
          metadata: { materialKind: l.kind, materialName: l.name.trim(), designCode: l.designCode || undefined, colorName: l.colorName || undefined, colorCode: l.colorCode || undefined, widthCm: Number(l.widthCm) || undefined, gsm: Number(l.gsm) || undefined },
          // نوع المادة يُحفظ على السطر نفسه (يميّز القماش بالكيلو عن الخيط)
          ...({ materialKind: l.kind } as object),
        })),
        ...({ confirm, cashboxId: confirm && paidN > 0 ? cashboxId : null } as object),
      } as PurchaseInvoiceCreatePayload;
      const res = await createPurchaseInvoice(payload);
      showToast({ type: 'success', message: `${confirm ? 'تم حفظ واعتماد' : 'تم حفظ مسودة'} الفاتورة ${res.data.invoiceNo}` });
      nav(viaWarehouse ? '/purchases/receiving' : '/invoices/purchases');
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذر الحفظ'); } finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-5xl space-y-4" dir="rtl">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-900">فاتورة شراء جديدة</h1><p className="text-sm text-slate-500">سجّل فاتورة المورد وبنودها؛ يستلم المخزن البضاعة لاحقاً (كاملة أو على دفعات) دون قيد مالي ثانٍ.</p></div>
      <Link to="/purchases/receiving" className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-sm font-bold text-slate-700"><ArrowRight className="h-4 w-4" />استلام المشتريات</Link>
    </div>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-bold text-slate-600">المورد<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— اختر المورد —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">رقم فاتورة المورد<input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
      <label className="text-xs font-bold text-slate-600">تاريخ الفاتورة<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inp} mt-1 font-normal`} /></label>
      <label className="text-xs font-bold text-slate-600">العملة<select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inp} mt-1 font-normal`}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">المخزن الافتراضي<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={`${inp} mt-1 font-normal`}><option value="">— حسب البند —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      {currency !== 'USD' && <div className="text-xs font-bold text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={manualRate} onChange={(e) => setManualRate(e.target.checked)} />معادل بالدولار (سعر صرف يدوي)</label>{manualRate ? <input type="number" min="0" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={`${currency} لكل 1 USD`} className={`${inp} mt-1 font-normal`} dir="ltr" /> : <p className="mt-1 font-normal text-slate-500">مطفأ: تُسجَّل الفاتورة بعملتها {currency} فقط.</p>}</div>}
      <label className="flex items-start gap-2 rounded-xl bg-indigo-50 p-3 text-xs font-bold text-indigo-900 sm:col-span-2"><input type="checkbox" checked={viaWarehouse} onChange={(e) => setViaWarehouse(e.target.checked)} className="mt-0.5" /><span>استلام عبر المخزن<span className="block font-normal text-indigo-700">لا تُنشئ الفاتورة أتواباً ولا دفعات؛ يسجّلها المخزن عند الاستلام. أطفئه فقط لسلوك الاستلام التلقائي القديم.</span></span></label>
    </section>

    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between"><b className="text-lg text-slate-900">البنود</b><div className="flex gap-1.5">{(Object.keys(KIND) as Kind[]).map((k) => <button key={k} type="button" onClick={() => setLines([...lines, blank(k)])} className="inline-flex items-center gap-1 rounded-lg border bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"><Plus className="h-3.5 w-3.5" />{KIND[k]}</button>)}</div></div>
      {lines.map((l, i) => <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex items-center justify-between"><span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">{i + 1} · {KIND[l.kind]}</span>
          {lines.length > 1 && <button type="button" aria-label="حذف البند" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-lg border bg-white p-1.5 text-rose-600"><Trash2 className="h-4 w-4" /></button>}</div>
        <div className="grid gap-2 sm:grid-cols-6">
          <label className="text-xs font-bold text-slate-600 sm:col-span-2">{l.kind === 'YARN' ? 'نوع الخيط / النمرة' : l.kind === 'FABRIC' ? 'الخامة' : 'المادة'}<input value={l.name} onChange={(e) => set(i, { name: e.target.value })} className={`${inp} mt-1 font-normal`} /></label>
          {l.kind !== 'OTHER' && <label className="text-xs font-bold text-slate-600">كود الخامة / التصميم<input value={l.designCode} onChange={(e) => set(i, { designCode: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>}
          {l.kind !== 'OTHER' && <label className="text-xs font-bold text-slate-600">اللون<input value={l.colorName} onChange={(e) => set(i, { colorName: e.target.value })} className={`${inp} mt-1 font-normal`} /></label>}
          {l.kind !== 'OTHER' && <label className="text-xs font-bold text-slate-600">كود اللون<input value={l.colorCode} onChange={(e) => set(i, { colorCode: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>}
          {l.kind === 'FABRIC' && <label className="text-xs font-bold text-slate-600">عرض التوب (سم){l.unit === 'kg' ? ' *' : ''}<input type="number" min="0" value={l.widthCm} onChange={(e) => set(i, { widthCm: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>}
          {l.kind === 'FABRIC' && <label className="text-xs font-bold text-slate-600">الوزن النوعي gsm{l.unit === 'kg' ? ' *' : ''}<input type="number" min="0" value={l.gsm} onChange={(e) => set(i, { gsm: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>}
        </div>
        <div className="grid gap-2 sm:grid-cols-5">
          <label className="text-xs font-bold text-slate-600">وحدة القياس<select value={l.unit} onChange={(e) => set(i, { unit: e.target.value as Unit })} className={`${inp} mt-1 font-normal`}>{UNITS[l.kind].map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-600">الكمية<input type="number" min="0" step="0.001" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
          <label className="text-xs font-bold text-slate-600">سعر الوحدة ({currency})<input type="number" min="0" step="0.0001" value={l.price} onChange={(e) => set(i, { price: e.target.value })} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
          <label className="text-xs font-bold text-slate-600">المخزن<select value={l.warehouseId} onChange={(e) => set(i, { warehouseId: e.target.value })} className={`${inp} mt-1 font-normal`}><option value="">— الافتراضي —</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <div className="text-xs font-bold text-slate-600">إجمالي البند<div className="mt-1 rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-900 ring-1 ring-slate-200" dir="ltr">{nf(lineTotal(l))} {currency}</div></div>
        </div>
      </div>)}
    </section>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-2">
      <div className="space-y-2">
        <label className="block text-xs font-bold text-slate-600">ملاحظات<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inp} mt-1 font-normal`} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-bold text-slate-600">المدفوع الآن ({currency})<input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} className={`${inp} mt-1 font-normal`} dir="ltr" /></label>
          <label className="text-xs font-bold text-slate-600">الصندوق<select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} disabled={paidN <= 0} className={`${inp} mt-1 font-normal disabled:opacity-50`}><option value="">— اختر —</option>{cashboxesForCcy.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <p className="text-xs text-slate-500">بلا مدفوع تُسجَّل الفاتورة آجلة على المورد عبر دورة المحاسبة الحالية.</p>
      </div>
      <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between"><span className="text-slate-600">مجموع البنود</span><b dir="ltr">{nf(subtotal)} {currency}</b></div>
        <label className="flex items-center justify-between gap-2"><span className="text-slate-600">الخصم</span><input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${inp} w-32 font-normal`} dir="ltr" /></label>
        <label className="flex items-center justify-between gap-2"><span className="text-slate-600">الضريبة</span><input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} className={`${inp} w-32 font-normal`} dir="ltr" /></label>
        <div className="flex justify-between border-t pt-2 text-base"><span className="font-black">إجمالي الفاتورة</span><b className="text-indigo-700" dir="ltr">{nf(total)} {currency}</b></div>
        <div className="flex justify-between text-xs text-slate-500"><span>المتبقي على المورد</span><span dir="ltr">{nf(remaining)} {currency}</span></div>
      </div>
    </section>

    {err && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{err}</p>}
    <div className="flex flex-wrap justify-end gap-2 pb-24">
      <button type="button" disabled={busy} onClick={() => void save(false)} className="rounded-xl border bg-white px-5 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">حفظ كمسودة</button>
      <button type="button" disabled={busy} onClick={() => void save(true)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}حفظ واعتماد</button>
    </div>
  </div>;
}
