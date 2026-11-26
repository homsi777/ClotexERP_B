import { useSearchParams } from 'react-router-dom';
import { DateInput } from '../../components/common/DateInput';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, FileCheck2, Loader2, Printer, Tag } from 'lucide-react';
import {
  createPurchaseInvoiceFromDispatchSlip,
  getIntakeDispatchSlip,
  listIntakeDispatchSlips,
  updateIntakeDispatchSlipLinePrices,
  voidIntakeDispatchSlip,
  type ApiIntakeDispatchSlip,
  type ApiIntakeDispatchSlipLine,
} from '../../lib/api/intakeDispatchSlipsApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../../components/NonBlockingToast';
import { renderIntakeDispatchSlipA4Html } from '../../lib/printing/renderIntakeDispatchSlipA4';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import i18n from '../../i18n/config';

const SLIP_TYPE_LABEL: Record<ApiIntakeDispatchSlip['slip_type'], string> = {
  PURCHASE: 'شراء',
  STOCK: 'إدخال مخزون',
  EXTERNAL: 'استلام مصنعية خارجية',
  ITEM_CREATION: 'إنشاء مادة جديدة',
};
type SlipTypeFilter = '' | ApiIntakeDispatchSlip['slip_type'];

export const IntakeDispatchSlips: React.FC = () => {
  const { t } = useTranslation('intakeOperations');
  const { showToast } = useToast();
  const [rows, setRows] = useState<ApiIntakeDispatchSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSlipId, setOpenSlipId] = useState<string | null>(null);
  const [lines, setLines] = useState<ApiIntakeDispatchSlipLine[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  // تسعير بالخامة (أساسي) وباللون (اختياري) بدل سعر لكل توب؛ يُحوَّل عند الحفظ إلى سعر لكل سطر.
  const [itemPrice, setItemPrice] = useState<Record<string, string>>({});
  const [colorPrice, setColorPrice] = useState<Record<string, string>>({});
  /** أساس السعر لكل خامة: للمتر أو للكيلو (الخامة المُدخلة بالوزن تُسعَّر بالكيلو). */
  const [basis, setBasis] = useState<Record<string, 'METER' | 'KG'>>({});
  const [colorOpen, setColorOpen] = useState<Record<string, boolean>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<SlipTypeFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'VOID'>('ALL');
  const [search, setSearch] = useState('');
  const [urlParams] = useSearchParams();
  const printOnLoad = urlParams.get('print');

  const visibleRows = rows.filter((r) => {
    if (typeFilter && r.slip_type !== typeFilter) return false;
    const day = r.created_at.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    const isVoid = r.operation_status === 'VOID';
    if (statusFilter === 'VOID' && !isVoid) return false;
    if (statusFilter === 'ACTIVE' && isVoid) return false;
    const q = search.trim().toLowerCase();
    if (q && ![r.slip_no, r.order_no, r.supplier_name ?? '', r.warehouse_name, SLIP_TYPE_LABEL[r.slip_type]].some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });

  const load = async () => {
    setLoading(true);
    try {
      setRows(await listIntakeDispatchSlips());
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // الوصول بعد «إنشاء مادة جديدة»: تُفتح الإرسالية للطباعة مباشرة.
  useEffect(() => {
    if (printOnLoad) void handlePrint(printOnLoad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOnLoad]);

  const openPricing = async (slipId: string) => {
    setOpenSlipId(slipId);
    setDetailLoading(true);
    try {
      const { lines: ls } = await getIntakeDispatchSlip(slipId);
      setLines(ls);
      setPrices(Object.fromEntries(ls.map((l) => [l.id, l.unit_price ?? ''])));
      // قيمة موحّدة موجودة مسبقاً لكل خامة تُعرض كسعر الخامة
      const seed: Record<string, string> = {};
      for (const g of new Set(ls.map((l) => l.item_name))) {
        const vals = new Set(ls.filter((l) => l.item_name === g).map((l) => l.unit_price ?? ''));
        if (vals.size === 1) seed[g] = [...vals][0];
      }
      setItemPrice(seed); setColorPrice({}); setColorOpen({});
      setBasis(Object.fromEntries([...new Set(ls.map((l) => l.item_name))].map((g) => [g, ls.filter((l) => l.item_name === g).every((l) => (l.unit_price != null ? l.price_basis === 'KG' : l.entry_basis === 'WEIGHT')) ? 'KG' : 'METER'])));
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
      setOpenSlipId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const savePrices = async () => {
    if (!openSlipId) return;
    const effective = (l: ApiIntakeDispatchSlipLine) => {
      const c = colorPrice[`${l.item_name}|${l.color_name_ar ?? ''}`];
      if (c !== undefined && c !== '') return c; // سعر اللون يتقدّم على سعر الخامة
      const i = itemPrice[l.item_name];
      if (i !== undefined && i !== '') return i;
      return prices[l.id] ?? '';
    };
    const payload = lines
      .filter((l) => effective(l) !== '')
      .map((l) => ({ lineId: l.id, unitPrice: Number(effective(l)) || 0, basis: basis[l.item_name] ?? 'METER' }));
    if (payload.length === 0) {
      showToast({ type: 'warning', message: t('enterAtLeastOnePrice') });
      return;
    }
    setSaving(true);
    try {
      await updateIntakeDispatchSlipLinePrices(openSlipId, payload);
      showToast({ type: 'success', message: t('pricesSaved') });
      setOpenSlipId(null);
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async (slipId: string) => {
    setPrintingId(slipId);
    try {
      const { slip, lines: ls } = await getIntakeDispatchSlip(slipId);
      const lang: 'ar' | 'tr' = i18n.language === 'tr' ? 'tr' : 'ar';
      const html = renderIntakeDispatchSlipA4Html({ slip, lines: ls, lang });
      const ok = openDocumentPrintWindow(html, slip.slip_no);
      if (!ok) showToast({ type: 'error', message: t('print.popupBlocked') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setPrintingId(null);
    }
  };

  const handleVoid = async (row: ApiIntakeDispatchSlip) => {
    if (!window.confirm(t('void.confirm', { slipNo: row.slip_no }))) return;
    setVoidingId(row.id);
    try {
      await voidIntakeDispatchSlip(row.id);
      showToast({ type: 'success', message: t('void.success') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('void.failed') });
    } finally {
      setVoidingId(null);
    }
  };

  const handlePostPurchaseInvoice = async (row: ApiIntakeDispatchSlip) => {
    if (!window.confirm(t('postInvoice.confirm', { slipNo: row.slip_no }))) return;
    setPostingId(row.id);
    try {
      const invoice = await createPurchaseInvoiceFromDispatchSlip(row.id);
      showToast({ type: 'success', message: t('postInvoice.success', { invoiceNo: invoice.invoiceNo }) });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('postInvoice.failed') });
    } finally {
      setPostingId(null);
    }
  };

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div>
        <h2 className="text-lg font-black text-slate-900">{t('dispatchSlipsTitle')}</h2>
        <p className="text-sm text-slate-500">{t('dispatchSlipsSubtitle')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-xs font-bold text-slate-600">نوع الحركة
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as SlipTypeFilter)} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">كل الحركات</option>
            {(Object.keys(SLIP_TYPE_LABEL) as ApiIntakeDispatchSlip['slip_type'][]).map((k) => <option key={k} value={k}>{SLIP_TYPE_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">من تاريخ
          <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 block w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-slate-600">إلى تاريخ
          <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 block w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-slate-600">الحالة
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'VOID')} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="ALL">الكل</option>
            <option value="ACTIVE">سارية</option>
            <option value="VOID">ملغاة</option>
          </select>
        </label>
        <label className="min-w-[220px] flex-1 text-xs font-bold text-slate-600">بحث
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="رقم الإرسالية، الأمر/المهمة، المورد، المستودع…" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <span className="pb-2 text-xs text-slate-500">{visibleRows.length} من {rows.length}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-right font-bold">{t('colSlipNo')}</th>
              <th className="p-3 text-right font-bold">{t('colOrderNo')}</th>
              <th className="p-3 text-right font-bold">{t('colSlipType')}</th>
              <th className="p-3 text-right font-bold">{t('colSupplier')}</th>
              <th className="p-3 text-right font-bold">التاريخ</th>
              <th className="p-3 text-right font-bold">{t('colWarehouse')}</th>
              <th className="p-3 text-right font-bold">{t('colPricing')}</th>
              <th className="p-3 text-right font-bold">{t('colStatus')}</th>
              <th className="p-3 text-right font-bold w-56">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="p-6 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</td></tr>
            )}
            {!loading && visibleRows.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-slate-500">{t('noSlipsYet')}</td></tr>
            )}
            {visibleRows.map((row) => {
              const isVoid = row.operation_status === 'VOID';
              const isPosted = Boolean(row.purchase_invoice_id);
              const fullyPriced = row.line_count > 0 && row.priced_line_count === row.line_count;
              return (
              <tr key={row.id} className={`border-t border-slate-100 hover:bg-slate-50/70 ${isVoid ? 'opacity-60' : ''}`}>
                <td className="p-3 font-mono font-bold text-indigo-700" dir="ltr">{row.slip_no}</td>
                <td className="p-3 font-mono text-slate-600" dir="ltr">{row.order_no}</td>
                <td className="p-3">{SLIP_TYPE_LABEL[row.slip_type]}</td>
                <td className="p-3 text-slate-700">{row.supplier_name ?? '—'}</td>
                <td className="p-3 text-xs text-slate-500" dir="ltr">{row.created_at.slice(0, 10).split('-').reverse().join('/')}</td>
                <td className="p-3 text-slate-700">{row.warehouse_name}</td>
                <td className="p-3 text-slate-600">
                  {row.priced_line_count}/{row.line_count}
                  {isPosted && (
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-emerald-700" dir="ltr">
                      {row.purchase_invoice_no}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  {isPosted ? (
                    <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-700">
                      {t('postInvoice.statusBadge')}
                    </span>
                  ) : isVoid ? (
                    <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
                      {t('void.statusBadge')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      {t('void.statusActive')}
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isVoid || isPosted}
                      onClick={() => void openPricing(row.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-40"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      {t('priceButton')}
                    </button>
                    <button
                      type="button"
                      disabled={printingId === row.id}
                      onClick={() => void handlePrint(row.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
                    >
                      {printingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                      {t('print.button')}
                    </button>
                    {row.slip_type === 'PURCHASE' && !isVoid && !isPosted && (
                      <button
                        type="button"
                        disabled={!fullyPriced || postingId === row.id}
                        title={!fullyPriced ? t('postInvoice.needsPricingFirst') : undefined}
                        onClick={() => void handlePostPurchaseInvoice(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                      >
                        {postingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck2 className="w-3.5 h-3.5" />}
                        {t('postInvoice.button')}
                      </button>
                    )}
                    {!isVoid && !isPosted && (
                      <button
                        type="button"
                        disabled={voidingId === row.id}
                        onClick={() => void handleVoid(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {voidingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                        {t('void.button')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openSlipId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-indigo-50">
              <h4 className="font-bold text-slate-900">{t('pricingModalTitle')}</h4>
            </div>
            <div className="p-5 max-h-[60vh] overflow-auto">
              {detailLoading ? (
                <div className="text-center text-slate-500 py-6"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">سعر واحد لكل خامة، وتسعير حسب اللون اختياري عند اختلاف الألوان.</p>
                  {[...new Set(lines.map((l) => l.item_name))].map((g) => {
                    const gl = lines.filter((l) => l.item_name === g);
                    const colors = [...new Set(gl.map((l) => l.color_name_ar ?? ''))];
                    const meters = gl.reduce((a, l) => a + Number(l.length_m), 0);
                    const kgTotal = gl.reduce((a, l) => a + (Number(l.weight_kg) || 0), 0);
                    const b = basis[g] ?? 'METER';
                    const price = Number(itemPrice[g]) || 0;
                    const estimate = price * (b === 'KG' ? kgTotal : meters);
                    return (
                      <div key={g} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div><b>{g}</b> <span className="text-xs text-slate-500">· {gl.length} توب{gl.every((l) => l.entry_basis === 'WEIGHT') ? '' : ` · ${meters.toFixed(2)} م`}{kgTotal > 0 ? ` · ${kgTotal.toFixed(1)} كغ` : ''}</span></div>
                          <div className="flex rounded-lg border border-slate-200 text-xs font-bold" role="group" aria-label="أساس السعر">
                            <button type="button" onClick={() => setBasis((p) => ({ ...p, [g]: 'METER' }))} className={`rounded-r-lg px-3 py-1 ${b === 'METER' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700'}`}>سعر المتر</button>
                            <button type="button" disabled={kgTotal <= 0} onClick={() => setBasis((p) => ({ ...p, [g]: 'KG' }))} className={`rounded-l-lg px-3 py-1 disabled:opacity-40 ${b === 'KG' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700'}`}>سعر الكيلو</button>
                          </div>
                          <label className="flex items-center gap-2 text-sm">{b === 'KG' ? 'سعر الكيلو' : 'سعر المتر'}
                            <input type="number" min={0} step="0.01" value={itemPrice[g] ?? ''} onChange={(e) => setItemPrice((p) => ({ ...p, [g]: e.target.value }))} className="w-24 rounded border border-slate-200 px-2 py-1 text-sm font-mono" dir="ltr" />
                          </label>
                        </div>
                        {b === 'KG'
                          ? <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs font-bold text-emerald-800">انتبه: السعر هنا للكيلوغرام الواحد (وليس للمتر)؛ الإجمالي = السعر × الوزن{price > 0 ? ` ≈ ${estimate.toLocaleString('en', { maximumFractionDigits: 2 })}` : ''}.</p>
                          : kgTotal > 0 && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">السعر للمتر الواحد. إن كانت الخامة مُدخلة بالوزن فاختر «سعر الكيلو».</p>}
                        {colors.length > 1 && (
                          <div className="mt-2">
                            <button type="button" className="text-xs font-bold text-indigo-700" onClick={() => setColorOpen((o) => ({ ...o, [g]: !o[g] }))}>{colorOpen[g] ? 'إخفاء' : 'تسعير حسب اللون (اختياري)'}</button>
                            {colorOpen[g] && (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {colors.map((c) => (
                                  <label key={c} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-sm">{c || 'بلا لون'}
                                    <input type="number" min={0} step="0.01" placeholder={itemPrice[g] ?? ''} value={colorPrice[`${g}|${c}`] ?? ''} onChange={(e) => setColorPrice((p) => ({ ...p, [`${g}|${c}`]: e.target.value }))} className="w-24 rounded border border-slate-200 px-2 py-1 text-sm font-mono" dir="ltr" />
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setOpenSlipId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={saving || detailLoading}
                onClick={() => void savePrices()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IntakeDispatchSlips;
