import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Printer, Undo2 } from 'lucide-react';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { listCartelaLabels, type CartelaLabelListItem } from '../../lib/api/cartelaApi';
import { apiFetch } from '../../lib/api/client';
import {
  extendCartelaDue,
  generateCartelaCopies,
  getCustomerCartelaStatement,
  listCustodyRows,
  returnCartelaCopies,
  type CustodyRow,
  type CustodyStatus,
} from '../../lib/api/cartelaCustodyApi';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { useToast } from '../../components/NonBlockingToast';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const today = () => new Date().toISOString().slice(0, 10);
const TONE: Record<CustodyStatus, string> = {
  HELD: 'bg-sky-100 text-sky-800',
  LATE: 'bg-rose-100 text-rose-800',
  RETURNED: 'bg-emerald-100 text-emerald-800',
};

export const CartelaCustody: React.FC = () => {
  const { t } = useTranslation('cartelaCustody');
  const { showToast } = useToast();
  const [params] = useSearchParams();
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | 'OPEN' | CustodyStatus>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<CustodyRow[]>([]);
  const [summary, setSummary] = useState<{ heldNow: number; late: number; noDue: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const [retScan, setRetScan] = useState('');
  const [retList, setRetList] = useState<string[]>([]);
  const [retDate, setRetDate] = useState(today());
  const [extId, setExtId] = useState<string | null>(null);
  const [extDate, setExtDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (customerId) {
        const r = await getCustomerCartelaStatement(customerId, { from: from || undefined, to: to || undefined, status });
        setRows(r.rows);
        setSummary(r.summary);
      } else {
        setRows(await listCustodyRows({ search: search || undefined, from: from || undefined, to: to || undefined, status }));
        setSummary(null);
      }
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [customerId, search, from, to, status, showToast, t]);

  useEffect(() => { void listCustomers({ status: 'active', pageSize: 500 }).then((r) => setCustomers(r.data ?? [])).catch(() => undefined); }, []);
  useEffect(() => { void load(); }, [load]);

  const addReturn = () => {
    const c = retScan.trim();
    if (!c) return;
    // المسح المتكرر يُحتسب نسخة إضافية (وضع العدد)؛ الخادم يتجاهل تكرار نسخة بعينها.
    setRetList((p) => [...p, c]);
    setRetScan('');
  };
  const confirmReturn = async () => {
    if (!customerId || !retList.length) return;
    try {
      const r = await returnCartelaCopies({ customerId, barcodes: retList, returnedOn: retDate });
      showToast({ type: 'success', message: t('return.done', { count: r.returned.length }) });
      setRetList([]);
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('return.failed') });
    }
  };
  const saveExtend = async (row: CustodyRow) => {
    if (!extDate) return;
    try {
      await extendCartelaDue({ lineId: row.lineId, newDueDate: extDate });
      showToast({ type: 'success', message: t('extend.done') });
      setExtId(null);
      setExtDate('');
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('extend.failed') });
    }
  };

  const statusText = (r: CustodyRow) =>
    r.status === 'LATE' ? `${t('status.LATE')} (${r.daysLate} ${t('days')})` : t(`status.${r.status}`);

  const print = () => {
    const cust = customers.find((c) => c.id === customerId);
    const body = rows.map((r) => `<tr><td>${esc(r.barcode)}</td><td>${esc(r.cartelaTitle)}</td><td>${esc(r.artCode)}</td><td>${esc(r.colorName || r.colorCode || '—')}</td><td>${esc(r.voucherNo)}</td><td>${r.deliveredOn}</td><td>${r.dueDate ?? esc(t('status.dueUndefined'))}</td><td>${r.returnedOn ?? '—'}</td><td>${r.daysHeld}</td><td>${esc(statusText(r))}</td></tr>`).join('');
    const sum = summary ? `<p>${esc(t('summary.heldNow'))}: <b>${summary.heldNow}</b> — ${esc(t('summary.late'))}: <b>${summary.late}</b></p>` : '';
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;padding:20px"><h2>${esc(t('statementTitle'))}${cust ? ` — ${esc(cust.name)}` : ''}</h2>${sum}
      <table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>
      <th>${esc(t('cols.barcode'))}</th><th>${esc(t('cols.cartela'))}</th><th>${esc(t('cols.code'))}</th><th>${esc(t('cols.color'))}</th><th>${esc(t('cols.voucher'))}</th><th>${esc(t('cols.deliveredOn'))}</th><th>${esc(t('cols.dueDate'))}</th><th>${esc(t('cols.returnedOn'))}</th><th>${esc(t('cols.daysHeld'))}</th><th>${esc(t('cols.status'))}</th></tr></thead><tbody>${body}</tbody></table></div>`;
    openDocumentPrintWindow(html, t('statementTitle'));
  };

  // توليد نسخ بباركود مستقل
  const [genOpen, setGenOpen] = useState(false);
  const [carts, setCarts] = useState<CartelaLabelListItem[]>([]);
  const [genCart, setGenCart] = useState('');
  const [genColors, setGenColors] = useState<{ id: string; color_code: string; name_ar: string }[]>([]);
  const [genColor, setGenColor] = useState('');
  const [genCount, setGenCount] = useState('1');
  const [genOut, setGenOut] = useState<string[]>([]);
  useEffect(() => { if (genOpen && !carts.length) void listCartelaLabels('').then(setCarts).catch(() => undefined); }, [genOpen, carts.length]);
  useEffect(() => {
    setGenColor('');
    setGenColors([]);
    if (!genCart) return;
    void apiFetch<{ ok: boolean; data: { id: string; color_code: string; name_ar: string }[] }>(`/api/cartela/${genCart}/colors`)
      .then((r) => setGenColors(r.data ?? [])).catch(() => undefined);
  }, [genCart]);
  const generate = async () => {
    try {
      const r = await generateCartelaCopies({ cartelaId: genCart, colorId: genColor || null, count: Number(genCount) });
      setGenOut(r.barcodes);
      showToast({ type: 'success', message: t('gen.done', { count: r.barcodes.length }) });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('gen.failed') });
    }
  };

  const th = 'p-2.5 text-right font-bold whitespace-nowrap';
  const td = 'p-2.5 whitespace-nowrap';
  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500">{t('subtitle')}</p>
        </div>
        <Link to="/cartela/delivery" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700">{t('newVoucher')}</Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <label className="block lg:col-span-2"><span className="text-xs font-bold text-slate-600">{t('filters.customer')}</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
              <option value="">{t('filters.allCustomers')}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          {!customerId && (
            <label className="block lg:col-span-2"><span className="text-xs font-bold text-slate-600">{t('filters.search')}</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('filters.searchPlaceholder')} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          )}
          <label className="block"><span className="text-xs font-bold text-slate-600">{t('filters.status')}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
              <option value="ALL">{t('filters.all')}</option><option value="OPEN">{t('filters.open')}</option>
              <option value="HELD">{t('status.HELD')}</option><option value="LATE">{t('status.LATE')}</option><option value="RETURNED">{t('status.RETURNED')}</option>
            </select></label>
          <label className="block"><span className="text-xs font-bold text-slate-600">{t('filters.from')}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" dir="ltr" /></label>
          <label className="block"><span className="text-xs font-bold text-slate-600">{t('filters.to')}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" dir="ltr" /></label>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      </section>

      {summary && (
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs font-bold text-sky-800">{t('summary.heldNow')}</p><p className="text-3xl font-black text-sky-900">{summary.heldNow}</p></div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-xs font-bold text-rose-800">{t('summary.late')}</p><p className="text-3xl font-black text-rose-900">{summary.late}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-600">{t('summary.noDue')}</p><p className="text-3xl font-black text-slate-800">{summary.noDue}</p></div>
        </section>
      )}

      {customerId && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="font-bold text-slate-900">{t('return.title')}</h2>
          <div className="flex flex-wrap gap-2">
            <input value={retScan} onChange={(e) => setRetScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addReturn()} placeholder={t('return.scanPlaceholder')}
              className="flex-1 min-w-[14rem] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" dir="ltr" />
            <input type="date" value={retDate} onChange={(e) => setRetDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" dir="ltr" />
            <button type="button" onClick={addReturn} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">{t('return.add')}</button>
          </div>
          {retList.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {Array.from(new Set(retList.map((x) => x.toUpperCase()))).map((b) => {
                const n = retList.filter((x) => x.toUpperCase() === b).length;
                return (
                  <span key={b} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 font-mono text-xs" dir="ltr">
                    {b}{n > 1 ? ` ×${n}` : ''}
                    <button type="button" onClick={() => setRetList((p) => { const i = p.findIndex((x) => x.toUpperCase() === b); return i < 0 ? p : p.filter((_, k) => k !== i); })} className="text-rose-600">×</button>
                  </span>
                );
              })}
              <button type="button" onClick={() => void confirmReturn()} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
                <Undo2 className="h-4 w-4" />{t('return.confirm', { count: retList.length })}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{customerId ? t('statementTitle') : t('trackingTitle')}</h2>
          <button type="button" onClick={print} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Printer className="h-4 w-4" />{t('print')}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {!customerId && <th className={th}>{t('cols.customer')}</th>}
                <th className={th}>{t('cols.barcode')}</th><th className={th}>{t('cols.cartela')}</th><th className={th}>{t('cols.code')}</th><th className={th}>{t('cols.color')}</th>
                <th className={th}>{t('cols.voucher')}</th><th className={th}>{t('cols.deliveredOn')}</th><th className={th}>{t('cols.dueDate')}</th>
                <th className={th}>{t('cols.returnedOn')}</th><th className={th}>{t('cols.daysHeld')}</th><th className={th}>{t('cols.status')}</th><th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12} className="p-6 text-center text-slate-500">{t('empty')}</td></tr>}
              {rows.map((r) => (
                <tr key={r.lineId} className="border-t border-slate-100 hover:bg-slate-50/70">
                  {!customerId && <td className={`${td} font-bold`}>{r.customerName}</td>}
                  <td className={`${td} font-mono`} dir="ltr">{r.barcode}</td>
                  <td className={td}>{r.cartelaTitle}</td><td className={td}>{r.artCode}</td><td className={td}>{r.colorName || r.colorCode || '—'}</td>
                  <td className={`${td} font-mono`} dir="ltr">{r.voucherNo}</td>
                  <td className={td}>{r.deliveredOn}</td>
                  <td className={td}>{r.dueDate ?? <span className="text-slate-400">{t('status.dueUndefined')}</span>}</td>
                  <td className={td}>{r.returnedOn ?? '—'}</td>
                  <td className={td}>{r.daysHeld}</td>
                  <td className={td}><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[r.status]}`}>{statusText(r)}</span></td>
                  <td className={td}>
                    {r.status !== 'RETURNED' && (extId === r.lineId ? (
                      <span className="inline-flex items-center gap-1">
                        <input type="date" value={extDate} onChange={(e) => setExtDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" dir="ltr" />
                        <button type="button" onClick={() => void saveExtend(r)} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white">{t('extend.save')}</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => { setExtId(r.lineId); setExtDate(r.dueDate ?? ''); }} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-white">
                        {r.dueDate ? t('extend.extend') : t('extend.setDue')}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <button type="button" onClick={() => setGenOpen((o) => !o)} className="font-bold text-slate-900">{t('gen.title')} {genOpen ? '▲' : '▼'}</button>
        {genOpen && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-500">{t('gen.hint')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <select value={genCart} onChange={(e) => setGenCart(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm min-w-[12rem]">
                <option value="">{t('gen.chooseCartela')}</option>
                {carts.map((c) => <option key={c.id} value={c.id}>{c.title} — {c.art_code}</option>)}
              </select>
              <select value={genColor} onChange={(e) => setGenColor(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
                <option value="">{t('gen.noColor')}</option>
                {genColors.map((c) => <option key={c.id} value={c.id}>{c.name_ar || c.color_code}</option>)}
              </select>
              <input type="number" min={1} max={200} value={genCount} onChange={(e) => setGenCount(e.target.value)} className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm" dir="ltr" />
              <button type="button" onClick={() => void generate()} disabled={!genCart} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t('gen.generate')}</button>
            </div>
            {genOut.length > 0 && <p className="font-mono text-sm" dir="ltr">{genOut.join('  •  ')}</p>}
          </div>
        )}
      </section>
    </div>
  );
};
