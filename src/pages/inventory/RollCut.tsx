import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Printer, Scissors, Search } from 'lucide-react';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { listCashboxes, type CashboxDto } from '../../lib/api/cashboxesApi';
import { listExchangeRates, type ExchangeRateDto } from '../../lib/api/exchangeRatesApi';
import {
  cutAndSellRoll,
  listRollCuts,
  priceRollCut,
  type RollCutLogItem,
  type RollCutResult,
} from '../../lib/api/rollCutApi';
import { previewCutLabels, type RollLabelPreviewDto, type LabelTemplateDto } from '../../lib/api/labelsApi';
import { printRollLabels, repeatRollLabel } from '../../lib/printing/printRollLabels';
import { useToast } from '../../components/NonBlockingToast';
import { useCurrencyWithBranchDefault } from '../../hooks/useDefaultCurrency';
import { usePermissions } from '../../hooks/usePermissions';

const num = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const RollCut: React.FC = () => {
  const { t } = useTranslation('rollCut');
  const { showToast } = useToast();
  const scanRef = useRef<HTMLInputElement>(null);
  // التسعير صلاحية (invoices.price): من لا يملكها يحفظ القص فقط وتبقى الفاتورة معلّقة للمحاسب. الخادم يفرض ذلك أيضاً.
  const { has } = usePermissions();
  const canPrice = has('invoices.price');
  const [deferPricing, setDeferPricing] = useState(false);
  const priceNow = canPrice && !deferPricing;
  const [pricingId, setPricingId] = useState<string | null>(null);
  const [pricingValue, setPricingValue] = useState('');

  const [scan, setScan] = useState('');
  const [looking, setLooking] = useState(false);
  const [roll, setRoll] = useState<FabricRollDto | null>(null);

  const [cutLength, setCutLength] = useState('');
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  // عملة البيع = العملة الافتراضية للفرع (مصر=الجنيه)، لا عملة تكلفة التوب؛ تُغيَّر يدوياً.
  const [currency, setCurrency] = useCurrencyWithBranchDefault();
  const [rates, setRates] = useState<ExchangeRateDto[]>([]);
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [cashboxId, setCashboxId] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [result, setResult] = useState<RollCutResult | null>(null);
  const [labels, setLabels] = useState<{ cut: RollLabelPreviewDto; remaining: RollLabelPreviewDto | null; template: LabelTemplateDto | null } | null>(null);
  const [cutCopies, setCutCopies] = useState(1);
  const [remainingCopies, setRemainingCopies] = useState(1);
  const [printing, setPrinting] = useState(false);

  const [log, setLog] = useState<RollCutLogItem[]>([]);
  const [logSearch, setLogSearch] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [cust, cb, rt] = await Promise.all([
          listCustomers({ status: 'active', pageSize: 500 }),
          listCashboxes({ active: true }),
          listExchangeRates(),
        ]);
        setCustomers(cust.data ?? []);
        setCashboxes(cb.data ?? []);
        setRates(rt.data ?? []);
      } catch {
        /* القوائم اختيارية — لا تُعطِّل الشاشة */
      }
    })();
    void refreshLog();
    scanRef.current?.focus();
  }, []);

  const refreshLog = useCallback(async (search?: string) => {
    try {
      setLog(await listRollCuts({ search, limit: 100 }));
    } catch {
      /* السجل غير حرِج */
    }
  }, []);

  const currentLength = roll ? Number(roll.length_m) : 0;
  const cutNum = Number(cutLength);
  const remaining = useMemo(() => {
    if (!roll || !Number.isFinite(cutNum) || cutNum <= 0) return null;
    return Math.round((currentLength - cutNum) * 100) / 100;
  }, [roll, cutNum, currentLength]);

  const lineTotal = useMemo(() => {
    const p = Number(unitPrice);
    if (!Number.isFinite(cutNum) || !Number.isFinite(p)) return 0;
    return Math.round(cutNum * p * 100) / 100;
  }, [cutNum, unitPrice]);

  const resetForm = () => {
    setRoll(null);
    setScan('');
    setCutLength('');
    setUnitPrice('');
    setPaidAmount('');
    setNotes('');
    setResult(null);
    setLabels(null);
    scanRef.current?.focus();
  };

  const lookup = async () => {
    const code = scan.trim();
    if (!code) return;
    setLooking(true);
    setRoll(null);
    setResult(null);
    setLabels(null);
    try {
      const res = await listFabricRolls({ barcode: code, pageSize: 10 });
      const exact = res.data.find((r) => r.barcode === code) ?? res.data[0] ?? null;
      if (!exact) {
        showToast({ type: 'warning', message: t('notFound') });
        return;
      }
      if (exact.status !== 'AVAILABLE' && exact.status !== 'RESERVED') {
        showToast({ type: 'warning', message: t('notAvailable') });
      }
      setRoll(exact);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('lookupFailed') });
    } finally {
      setLooking(false);
    }
  };

  const canSubmit =
    roll &&
    Number.isFinite(cutNum) && cutNum > 0 && cutNum <= currentLength + 1e-6 &&
    customerId &&
    (!priceNow || Number(unitPrice) > 0) &&
    !saving;

  const submit = async () => {
    if (!roll || !canSubmit) return;
    setSaving(true);
    try {
      const res = await cutAndSellRoll({
        originalRollId: roll.id,
        cutLengthM: cutNum,
        customerId,
        ...(priceNow ? { unitPrice: Number(unitPrice) } : { deferPricing: true }),
        currencyCode: currency,
        paidAmount: priceNow && paidAmount ? Number(paidAmount) : 0,
        cashboxId: priceNow ? cashboxId || null : null,
        notes: notes || null,
      });
      setResult(res);
      showToast({ type: 'success', message: res.invoice ? t('cutDone', { invoice: res.invoice.invoiceNo }) : t('cutSavedPending') });
      void refreshLog(logSearch);
      await loadLabels(res.originalRoll.id, res.cutPiece.id);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('cutFailed') });
    } finally {
      setSaving(false);
    }
  };

  const loadLabels = async (originalRollId: string, cutPieceRollId: string) => {
    try {
      const res = await previewCutLabels(originalRollId, cutPieceRollId);
      const cut = res.data.find((r) => r.rollId === cutPieceRollId);
      const rem = res.data.find((r) => r.rollId === originalRollId) ?? null;
      if (cut) setLabels({ cut, remaining: rem, template: res.template });
    } catch {
      /* الطباعة اختيارية بعد نجاح القص */
    }
  };

  const doPrint = async () => {
    if (!labels) return;
    setPrinting(true);
    try {
      const rolls = [
        ...repeatRollLabel(labels.cut, cutCopies),
        ...(labels.remaining ? repeatRollLabel(labels.remaining, remainingCopies) : []),
      ];
      if (!rolls.length) {
        showToast({ type: 'warning', message: t('chooseCopies') });
        return;
      }
      const r = await printRollLabels(rolls, { template: labels.template });
      showToast({ type: r.ok ? 'success' : 'error', message: r.ok ? t('printSent') : r.error || t('printFailed') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('printFailed') });
    } finally {
      setPrinting(false);
    }
  };

  const submitPricing = async (item: RollCutLogItem) => {
    const p = Number(pricingValue);
    if (!(p > 0)) return;
    try {
      const r = await priceRollCut(item.id, { unitPrice: p, currencyCode: currency });
      showToast({ type: 'success', message: t('priced', { invoice: r.invoice.invoiceNo }) });
      setPricingId(null);
      setPricingValue('');
      void refreshLog(logSearch);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('cutFailed') });
    }
  };

  const reprint = async (item: RollCutLogItem) => {
    await loadLabels(item.original_roll_id, item.cut_piece_roll_id);
    setResult({
      pricingStatus: item.pricing_status,
      invoice: item.sales_invoice_id && item.sales_invoice_no ? { id: item.sales_invoice_id, invoiceNo: item.sales_invoice_no } : null,
      originalRoll: { id: item.original_roll_id, barcode: item.original_barcode, remainingLengthM: Number(item.original_length_after_m) },
      cutPiece: { id: item.cut_piece_roll_id, barcode: item.cut_barcode, lengthM: Number(item.cut_length_m) },
      cutLogId: item.id,
    });
    setRoll(null);
    showToast({ type: 'success', message: t('reprintReady') });
  };

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center text-violet-700">
          <Scissors className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500">{t('subtitle')}</p>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex gap-2">
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void lookup()}
            placeholder={t('scanPlaceholder')}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono"
            dir="ltr"
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={looking}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
          >
            {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {t('lookup')}
          </button>
        </div>

        {roll && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t('barcode')}</span><b className="font-mono" dir="ltr">{roll.barcode}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('item')}</span><b>{roll.item_name || '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('color')}</span><b>{roll.color_name_ar || roll.color_code || '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('warehouse')}</span><b>{roll.warehouse_name || '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('currentLength')}</span><b className="text-indigo-700">{num(currentLength)} م</b></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('status')}</span><b>{roll.status}</b></div>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-bold text-slate-600">{t('cutLength')}</span>
                <input type="number" min={0} step={0.01} value={cutLength} onChange={(e) => setCutLength(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />
                {remaining !== null && (
                  <span className={`mt-1 block text-xs font-bold ${remaining < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {remaining < 0 ? t('exceedsLength') : t('remainingAfter', { value: num(remaining) })}
                  </span>
                )}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">{t('customer')}</span>
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                    <option value="">—</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                {priceNow && (<>
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">{t('unitPrice')}</span>
                  <input type="number" min={0} step={0.01} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />
                </label>
                </>)}
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">{t('currency')}</span>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                    <option value="USD">USD</option>
                    {rates.filter((r) => r.currency_code !== 'USD' && r.is_active).map((r) => (
                      <option key={r.currency_code} value={r.currency_code}>{r.currency_code}</option>
                    ))}
                  </select>
                </label>
                {priceNow && (<>
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">{t('paidAmount')}</span>
                  <input type="number" min={0} step={0.01} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />
                </label>
                <label className="block col-span-2">
                  <span className="text-xs font-bold text-slate-600">{t('cashbox')}</span>
                  <select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                    <option value="">{t('noCashbox')}</option>
                    {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency_code})</option>)}
                  </select>
                </label>
                </>)}
              </div>
              {canPrice && (
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  <input type="checkbox" checked={deferPricing} onChange={(e) => setDeferPricing(e.target.checked)} />
                  {t('deferPricing')}
                </label>
              )}
              {priceNow ? (
                <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2 text-sm">
                  <span className="font-bold text-slate-700">{t('invoiceTotal')}</span>
                  <b className="text-indigo-700">{num(lineTotal)} {currency}</b>
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{t('pendingNotice')}</div>
              )}
              <button type="button" onClick={() => void submit()} disabled={!canSubmit}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                {priceNow ? t('cutAndSell') : t('cutSave')}
              </button>
            </div>
          </div>
        )}
      </section>

      {result && (
        <section className="bg-white rounded-xl border border-emerald-200 shadow-sm p-5 space-y-4">
          <h2 className="font-bold text-slate-900">{result.invoice ? t('resultTitle', { invoice: result.invoice.invoiceNo }) : t('resultPendingTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-bold text-violet-700">{t('cutPiece')}</p>
              <p className="font-mono font-bold text-lg" dir="ltr">{result.cutPiece.barcode}</p>
              <p className="text-sm text-slate-600">{num(result.cutPiece.lengthM)} م</p>
              <label className="mt-2 block text-xs font-bold text-slate-600">{t('copies')}
                <input type="number" min={0} max={99} value={cutCopies} onChange={(e) => setCutCopies(Number(e.target.value))}
                  className="mt-1 w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" dir="ltr" />
              </label>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold text-slate-500">{t('remainingRoll')}</p>
              <p className="font-mono font-bold text-lg" dir="ltr">{result.originalRoll.barcode}</p>
              <p className="text-sm text-slate-600">{num(result.originalRoll.remainingLengthM)} م</p>
              {result.originalRoll.remainingLengthM > 0 ? (
                <label className="mt-2 block text-xs font-bold text-slate-600">{t('copies')}
                  <input type="number" min={0} max={99} value={remainingCopies} onChange={(e) => setRemainingCopies(Number(e.target.value))}
                    className="mt-1 w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" dir="ltr" />
                </label>
              ) : (
                <p className="mt-2 text-xs text-slate-400">{t('rollFullySold')}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void doPrint()} disabled={printing || !labels}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50">
              {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {t('printStickers')}
            </button>
            <button type="button" onClick={resetForm}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
              {t('newCut')}
            </button>
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="font-bold text-slate-900">{t('logTitle')}</h3>
          <div className="flex gap-2">
            <input value={logSearch} onChange={(e) => setLogSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void refreshLog(logSearch)}
              placeholder={t('logSearchPlaceholder')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm max-w-xs" />
            <button type="button" onClick={() => void refreshLog(logSearch)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">{t('refresh')}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3 text-right font-bold">{t('colInvoice')}</th>
                <th className="p-3 text-right font-bold">{t('colItem')}</th>
                <th className="p-3 text-right font-bold">{t('colOriginal')}</th>
                <th className="p-3 text-right font-bold">{t('colCut')}</th>
                <th className="p-3 text-right font-bold">{t('colCutLen')}</th>
                <th className="p-3 text-right font-bold">{t('colRemaining')}</th>
                <th className="p-3 text-right font-bold">{t('colDate')}</th>
                <th className="p-3 text-right font-bold">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-slate-500">{t('logEmpty')}</td></tr>
              )}
              {log.map((item) => (
                <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="p-3 font-mono font-bold" dir="ltr">{item.sales_invoice_no ?? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-sans text-amber-800">{t('pendingBadge')}</span>}</td>
                  <td className="p-3">{item.item_name || '—'}</td>
                  <td className="p-3 font-mono" dir="ltr">{item.original_barcode}</td>
                  <td className="p-3 font-mono text-violet-700" dir="ltr">{item.cut_barcode}</td>
                  <td className="p-3">{num(Number(item.cut_length_m))} م</td>
                  <td className="p-3">{num(Number(item.original_length_after_m))} م</td>
                  <td className="p-3 text-xs text-slate-500">{new Date(item.created_at).toLocaleString('ar-SY')}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => void reprint(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white">
                      <Printer className="w-3.5 h-3.5" />{t('reprint')}
                    </button>
                    {item.pricing_status === 'PENDING' && canPrice && (
                      pricingId === item.id ? (
                        <span className="ms-2 inline-flex items-center gap-1">
                          <input type="number" min={0} step={0.01} value={pricingValue} onChange={(e) => setPricingValue(e.target.value)}
                            placeholder={`${t('unitPrice')} (${currency})`} className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs" dir="ltr" />
                          <button type="button" onClick={() => void submitPricing(item)} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white">{t('confirmPrice')}</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => { setPricingId(item.id); setPricingValue(''); }}
                          className="ms-2 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-white">{t('priceNow')}</button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
