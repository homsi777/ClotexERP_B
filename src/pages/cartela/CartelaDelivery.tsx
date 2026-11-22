import { DateInput } from '../../components/common/DateInput';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, Printer, Save, Trash2 } from 'lucide-react';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { createDeliveryVoucher, scanCartelaCopy, type DeliveryResult, type ScannedCopy } from '../../lib/api/cartelaCustodyApi';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { renderCartelaDeliveryVoucherHtml } from '../../lib/printing/renderCartelaDeliveryVoucher';
import { BRAND } from '../../branding';
import { useToast } from '../../components/NonBlockingToast';
import { todayYmd } from '../../lib/businessDate';

type Line = { copy: ScannedCopy; qty: number; days: string; dueDate: string };
const poolKey = (c: ScannedCopy) => `${c.cartelaId}|${c.levelColorId ?? ''}`;

const today = () => todayYmd();
const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export const CartelaDelivery: React.FC = () => {
  const { t } = useTranslation('cartelaCustody');
  const { showToast } = useToast();
  const scanRef = useRef<HTMLInputElement>(null);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [scan, setScan] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  /** معاينة السند قبل الطباعة (تفتح تلقائياً بعد الحفظ). */
  const [voucherPreview, setVoucherPreview] = useState<{ html: string; title: string } | null>(null);

  useEffect(() => {
    void listCustomers({ status: 'active', pageSize: 500 }).then((r) => setCustomers(r.data ?? [])).catch(() => undefined);
    scanRef.current?.focus();
  }, []);

  const addScan = async () => {
    const code = scan.trim();
    if (!code) return;
    setScanning(true);
    try {
      const copy = await scanCartelaCopy(code);
      if (copy.poolMode) {
        // وضع العدد: كل مسح لنفس الكارتيلة يزيد العدد بقدر المتاح من المخزون.
        const idx = lines.findIndex((l) => l.copy.poolMode && poolKey(l.copy) === poolKey(copy));
        const available = copy.stock?.available ?? 0;
        const current = idx >= 0 ? lines[idx].qty : 0;
        if (current + 1 > available) {
          showToast({ type: 'error', message: t('delivery.outOfStock', { title: copy.cartelaTitle, available }) });
        } else if (idx >= 0) {
          setLines((p) => p.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l)));
        } else {
          setLines((p) => [...p, { copy, qty: 1, days: '', dueDate: '' }]);
        }
      } else if (lines.some((l) => l.copy.barcode.toUpperCase() === copy.barcode.toUpperCase())) {
        showToast({ type: 'warning', message: t('delivery.duplicateInVoucher') });
      } else if (copy.heldBy) {
        showToast({ type: 'error', message: t('delivery.alreadyHeld', { customer: copy.heldBy.customerName, voucher: copy.heldBy.voucherNo }) });
      } else {
        setLines((p) => [...p, { copy, qty: 1, days: '', dueDate: '' }]);
      }
      setScan('');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('delivery.scanFailed') });
    } finally {
      setScanning(false);
      scanRef.current?.focus();
    }
  };

  const setDays = (i: number, v: string) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, days: v, dueDate: v && Number(v) > 0 ? addDays(deliveryDate, Number(v)) : '' } : l)));
  const setQty = (i: number, v: string) =>
    setLines((p) => p.map((l, idx) => {
      if (idx !== i) return l;
      const max = l.copy.stock?.available ?? 1;
      const n = Math.min(Math.max(Math.floor(Number(v) || 1), 1), Math.max(max, 1));
      return { ...l, qty: n };
    }));
  const setDue = (i: number, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, dueDate: v, days: '' } : l)));

  const save = async () => {
    if (!customerId || !lines.length) return;
    setSaving(true);
    try {
      const res = await createDeliveryVoucher({
        customerId,
        deliveryDate,
        notes: notes || null,
        lines: lines.map((l) => ({ barcode: l.copy.barcode, quantity: l.qty, dueDate: l.dueDate || null })),
      });
      setResult(res);
      setVoucherPreview(buildVoucher(res, lines));
      showToast({ type: 'success', message: t('delivery.saved', { no: res.voucherNo }) });
      setLines([]);
      setNotes('');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('delivery.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const buildVoucher = (r: DeliveryResult, copies: Line[]) => {
    const title = `${t('delivery.voucherTitle')} ${r.voucherNo}`;
    const html = renderCartelaDeliveryVoucherHtml(
      {
        voucherNo: r.voucherNo,
        customerName: r.customerName,
        deliveryDate: r.deliveryDate,
        notes: notes || null,
        logoSrc: BRAND.logoInline,
        brandName: BRAND.name,
        rows: copies.map((l) => ({
          barcode: l.copy.barcode,
          cartelaTitle: l.copy.cartelaTitle,
          artCode: l.copy.artCode,
          colorName: l.copy.colorName || l.copy.colorCode || null,
          qty: l.qty,
          dueDate: l.dueDate || null,
        })),
      },
      {
        title: t('delivery.voucherTitle'),
        customer: t('delivery.customer'),
        deliveryDate: t('delivery.date'),
        barcode: t('cols.barcode'),
        cartela: t('cols.cartela'),
        code: t('cols.code'),
        color: t('cols.color'),
        qty: t('delivery.qty'),
        dueDate: t('cols.dueDate'),
        dueUndefined: t('status.dueUndefined'),
        notes: t('delivery.notes'),
        receiverSignature: t('delivery.receiverSignature'),
        total: t('delivery.totalQty'),
      },
    );
    return { html, title };
  };

  // نسخ الأسطر عند الحفظ للطباعة بعد تفريغ القائمة
  const [printable, setPrintable] = useState<Line[]>([]);
  const saveAndKeep = async () => {
    setPrintable(lines);
    await save();
  };

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('delivery.title')}</h1>
          <p className="text-sm text-slate-500">{t('delivery.subtitle')}</p>
        </div>
        <Link to="/cartela/custody" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">{t('delivery.goCustody')}</Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-slate-600">{t('delivery.customer')}</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
              <option value="">—</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-600">{t('delivery.date')}</span>
            <DateInput value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-600">{t('delivery.notes')}</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex gap-2">
          <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addScan()}
            placeholder={t('delivery.scanPlaceholder')} className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono" dir="ltr" />
          <button type="button" onClick={() => void addScan()} disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50">
            {scanning && <Loader2 className="h-4 w-4 animate-spin" />}{t('delivery.add')}
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2.5 text-right">{t('cols.barcode')}</th><th className="p-2.5 text-right">{t('cols.cartela')}</th>
                <th className="p-2.5 text-right">{t('cols.code')}</th><th className="p-2.5 text-right">{t('cols.color')}</th>
                <th className="p-2.5 text-right">{t('delivery.qty')}</th>
                <th className="p-2.5 text-right">{t('delivery.days')}</th><th className="p-2.5 text-right">{t('cols.dueDate')}</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">{t('delivery.empty')}</td></tr>}
              {lines.map((l, i) => (
                <tr key={l.copy.barcode} className="border-t border-slate-100">
                  <td className="p-2.5 font-mono" dir="ltr">{l.copy.barcode}</td>
                  <td className="p-2.5 font-bold">{l.copy.cartelaTitle}</td>
                  <td className="p-2.5">{l.copy.artCode}</td>
                  <td className="p-2.5">{l.copy.colorName || l.copy.colorCode || '—'}</td>
                  <td className="p-2.5">
                    {l.copy.poolMode ? (
                      <div className="flex items-center gap-1">
                        <input type="number" min={1} max={l.copy.stock?.available ?? 1} value={l.qty} onChange={(e) => setQty(i, e.target.value)} className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm" dir="ltr" />
                        <span className="text-[11px] text-slate-500">{t('delivery.availableOf', { available: l.copy.stock?.available ?? 0 })}</span>
                      </div>
                    ) : <span>1</span>}
                  </td>
                  <td className="p-2.5"><input type="number" min={1} value={l.days} onChange={(e) => setDays(i, e.target.value)} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm" dir="ltr" /></td>
                  <td className="p-2.5"><DateInput value={l.dueDate} onChange={(e) => setDue(i, e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" dir="ltr" /></td>
                  <td className="p-2.5"><button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="text-rose-600"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">{t('delivery.hint')}</p>
        <button type="button" onClick={() => void saveAndKeep()} disabled={!customerId || !lines.length || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('delivery.save')}
        </button>
      </section>

      {result && (
        <section className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <p className="font-bold text-slate-900">{t('delivery.saved', { no: result.voucherNo })} — {result.customerName}</p>
          <button type="button" onClick={() => setVoucherPreview(buildVoucher(result, printable))}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black">
            <Printer className="h-4 w-4" />{t('delivery.previewPrint')}
          </button>
        </section>
      )}

      {voucherPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true">
          <div className="flex max-h-[94vh] w-full max-w-4xl flex-col gap-3 rounded-xl bg-white p-4">
            <h3 className="text-base font-bold text-slate-900">{voucherPreview.title}</h3>
            <iframe title={voucherPreview.title} srcDoc={voucherPreview.html} className="h-[62vh] w-full rounded-lg border border-slate-200 bg-white" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVoucherPreview(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                {t('delivery.close')}
              </button>
              <button
                type="button"
                onClick={() => openDocumentPrintWindow(voucherPreview.html, voucherPreview.title)}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black"
              >
                <Printer className="h-4 w-4" />
                {t('delivery.print')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
