import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, Printer, Save, Trash2 } from 'lucide-react';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { createDeliveryVoucher, scanCartelaCopy, type DeliveryResult, type ScannedCopy } from '../../lib/api/cartelaCustodyApi';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { useToast } from '../../components/NonBlockingToast';

type Line = { copy: ScannedCopy; days: string; dueDate: string };

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
      if (lines.some((l) => l.copy.barcode.toUpperCase() === copy.barcode.toUpperCase())) {
        showToast({ type: 'warning', message: t('delivery.duplicateInVoucher') });
      } else if (copy.heldBy) {
        showToast({ type: 'error', message: t('delivery.alreadyHeld', { customer: copy.heldBy.customerName, voucher: copy.heldBy.voucherNo }) });
      } else {
        setLines((p) => [...p, { copy, days: '', dueDate: '' }]);
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
  const setDue = (i: number, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, dueDate: v, days: '' } : l)));

  const save = async () => {
    if (!customerId || !lines.length) return;
    setSaving(true);
    try {
      const res = await createDeliveryVoucher({
        customerId,
        deliveryDate,
        notes: notes || null,
        lines: lines.map((l) => ({ barcode: l.copy.barcode, dueDate: l.dueDate || null })),
      });
      setResult(res);
      showToast({ type: 'success', message: t('delivery.saved', { no: res.voucherNo }) });
      setLines([]);
      setNotes('');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('delivery.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const printVoucher = (r: DeliveryResult, copies: Line[]) => {
    const dueByBarcode = new Map(r.lines.map((l) => [l.barcode, l.dueDate]));
    const rows = (copies.length ? copies.map((l) => l.copy) : []).map((c) => `<tr><td>${esc(c.barcode)}</td><td>${esc(c.cartelaTitle)}</td><td>${esc(c.artCode)}</td><td>${esc(c.colorName || c.colorCode || '—')}</td><td>${dueByBarcode.get(c.barcode) || t('status.dueUndefined')}</td></tr>`).join('');
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;padding:24px">
      <h2>${esc(t('delivery.voucherTitle'))} ${esc(r.voucherNo)}</h2>
      <p>${esc(t('delivery.customer'))}: <b>${esc(r.customerName)}</b> — ${esc(t('delivery.date'))}: <b>${esc(r.deliveryDate)}</b></p>
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr><th>${esc(t('cols.barcode'))}</th><th>${esc(t('cols.cartela'))}</th><th>${esc(t('cols.code'))}</th><th>${esc(t('cols.color'))}</th><th>${esc(t('cols.dueDate'))}</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <p style="margin-top:48px">${esc(t('delivery.receiverSignature'))}: ____________________</p></div>`;
    openDocumentPrintWindow(html, `${t('delivery.voucherTitle')} ${r.voucherNo}`);
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
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />
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
                <th className="p-2.5 text-right">{t('delivery.days')}</th><th className="p-2.5 text-right">{t('cols.dueDate')}</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">{t('delivery.empty')}</td></tr>}
              {lines.map((l, i) => (
                <tr key={l.copy.barcode} className="border-t border-slate-100">
                  <td className="p-2.5 font-mono" dir="ltr">{l.copy.barcode}</td>
                  <td className="p-2.5 font-bold">{l.copy.cartelaTitle}</td>
                  <td className="p-2.5">{l.copy.artCode}</td>
                  <td className="p-2.5">{l.copy.colorName || l.copy.colorCode || '—'}</td>
                  <td className="p-2.5"><input type="number" min={1} value={l.days} onChange={(e) => setDays(i, e.target.value)} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm" dir="ltr" /></td>
                  <td className="p-2.5"><input type="date" value={l.dueDate} onChange={(e) => setDue(i, e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" dir="ltr" /></td>
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
          <button type="button" onClick={() => printVoucher(result, printable)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black">
            <Printer className="h-4 w-4" />{t('delivery.print')}
          </button>
        </section>
      )}
    </div>
  );
};
