import { DateInput } from '../common/DateInput';
import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { parseAdvancesFile, type ParsedAdvancesFile } from '../../lib/hrAdvancesExcelParser';
import { importAdvancesExcel, type ImportAdvancesResult } from '../../lib/api/payrollApi';
import { todayYmd } from '../../lib/businessDate';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  IMPORTED: 'جاهز',
  DUPLICATE: 'مستورد سابقاً',
  MISSING: 'موظف غير موجود',
  AMBIGUOUS: 'اسم ملتبس',
  INVALID: 'غير صالح',
};
const MATCH_LABEL: Record<string, string> = {
  CODE: 'بالكود',
  NAME_EXACT: 'اسم مطابق',
  NAME_PREFIX: 'بداية الاسم',
  NAME_TOKENS: 'كلمات الاسم',
  CREATED: 'سيُنشأ موظف',
};

export function AdvancesExcelImportModal({ open, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'OCT' | 'SCHED'>('OCT');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedAdvancesFile | null>(null);
  const [advanceDate, setAdvanceDate] = useState('2026-10-31');
  const [paidMonth, setPaidMonth] = useState(10);
  const [paidYear, setPaidYear] = useState(2026);
  const [currencyCode, setCurrencyCode] = useState('EGP');
  const [create, setCreate] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<ImportAdvancesResult | null>(null);
  const [result, setResult] = useState<ImportAdvancesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rowsPayload = useMemo(
    () =>
      (parsed?.rows ?? []).map((r) => ({
        rowKey: r.rowKey,
        code: r.code,
        name: r.name,
        amount: r.amount,
        advanceDate: r.advanceDate,
        dateIsEstimated: r.dateIsEstimated,
        notes: r.notes,
        comprehensiveWage: r.comprehensiveWage,
        installments: r.installments,
        createIfMissing: Boolean(create[r.rowKey]),
      })),
    [parsed, create],
  );

  if (!open) return null;

  async function runPreview(payloadRows = rowsPayload, p = parsed) {
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importAdvancesExcel({
        fileName,
        kind,
        currencyCode,
        paidThrough: kind === 'SCHED' ? { month: paidMonth, year: paidYear } : null,
        dryRun: true,
        rows: payloadRows,
      });
      setPreview(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّرت المعاينة');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setPreview(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const p = await parseAdvancesFile(file, kind, kind === 'OCT' ? advanceDate : todayYmd());
      setParsed(p);
      // الافتراضي: إنشاء الموظف المفقود في السلف المقسطة (أسماء أشخاص)، لا في صفوف بلا كود بسلف الشهر.
      const initial: Record<string, boolean> = {};
      for (const r of p.rows) initial[r.rowKey] = kind === 'SCHED' ? true : false;
      setCreate(initial);
      const payload = p.rows.map((r) => ({ ...r, createIfMissing: initial[r.rowKey] }));
      await runPreview(payload, p);
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : 'تعذّرت قراءة الملف');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function toggleCreate(rowKey: string) {
    const next = { ...create, [rowKey]: !create[rowKey] };
    setCreate(next);
    await runPreview(
      rowsPayload.map((r) => ({ ...r, createIfMissing: Boolean(next[r.rowKey]) })),
    );
  }

  async function confirm() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importAdvancesExcel({
        fileName,
        kind,
        currencyCode,
        paidThrough: kind === 'SCHED' ? { month: paidMonth, year: paidYear } : null,
        dryRun: false,
        rows: rowsPayload,
      });
      setResult(res.data);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل الاستيراد');
    } finally {
      setBusy(false);
    }
  }

  const shown = result ?? preview;
  const counts = shown
    ? {
        ok: shown.rows.filter((r) => r.status === 'IMPORTED').length,
        dup: shown.rows.filter((r) => r.status === 'DUPLICATE').length,
        bad: shown.rows.filter((r) => ['MISSING', 'AMBIGUOUS', 'INVALID'].includes(r.status)).length,
      }
    : null;
  const inputCls = 'rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4" dir="rtl">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">استيراد السلف من Excel</h3>
            <p className="mt-1 text-xs text-slate-500">
              سلف تاريخية: لا تُنشأ سندات صرف ولا حركات صندوق (المبالغ دُفعت قبل دخول النظام). الاستيراد يمكن إعادته بأمان.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="text-xs font-bold text-slate-600">
              نوع الملف
              <select className={`${inputCls} mt-1 w-full`} value={kind} disabled={busy} onChange={(e) => { setKind(e.target.value as 'OCT' | 'SCHED'); setParsed(null); setPreview(null); setResult(null); setFileName(''); }}>
                <option value="OCT">سلف الشهر (بالكود)</option>
                <option value="SCHED">السلف المقسطة (بالاسم)</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              العملة
              <input className={`${inputCls} mt-1 w-full`} value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())} />
            </label>
            {kind === 'OCT' ? (
              <label className="text-xs font-bold text-slate-600 sm:col-span-2">
                تاريخ السلف (الملف لا يذكر اليوم)
                <DateInput className={`${inputCls} mt-1 w-full`} value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} />
              </label>
            ) : (
              <div className="sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">الأقساط المخصومة حتى (شاملاً)</span>
                <div className="mt-1 flex gap-2">
                  <input type="number" min={1} max={12} className={`${inputCls} w-24`} value={paidMonth} onChange={(e) => setPaidMonth(Number(e.target.value))} />
                  <input type="number" min={2000} max={2100} className={`${inputCls} w-28`} value={paidYear} onChange={(e) => setPaidYear(Number(e.target.value))} />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">ما بعد هذا الشهر يبقى «قيد الخصم».</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void onFile(e)} />
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              اختيار الملف
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{fileName || 'لم يُختر ملف'}</span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                تم الاستيراد: {result.advancesCreated} سلفة، {result.installmentsCreated} قسط، {result.employeesCreated} موظف جديد — إجمالي {result.totalAmount.toLocaleString()} {currencyCode}
              </div>
            </div>
          )}

          {shown && parsed && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3 text-xs font-bold">
                <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">جاهز: {counts?.ok}</span>
                <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">مستورد سابقاً: {counts?.dup}</span>
                <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">يحتاج قراراً: {counts?.bad}</span>
                <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">الإجمالي: {shown.totalAmount.toLocaleString()} {currencyCode}</span>
                <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">موظفون جدد: {shown.employeesCreated}</span>
                <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">أقساط: {shown.installmentsCreated}</span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-2">الاسم بالملف</th>
                      <th className="px-2 py-2">الموظف بالنظام</th>
                      <th className="px-2 py-2">المطابقة</th>
                      <th className="px-2 py-2">المبلغ</th>
                      <th className="px-2 py-2">أقساط (مخصومة)</th>
                      <th className="px-2 py-2">الحالة</th>
                      {!result && <th className="px-2 py-2">إنشاء موظف</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.rows.map((r) => {
                      const src = parsed.rows.find((p) => p.rowKey === r.rowKey);
                      const warn = [...(src?.warnings ?? []), ...(r.note ? [r.note] : [])];
                      return (
                        <tr key={r.rowKey} className="border-t border-slate-100 align-top">
                          <td className="px-2 py-1.5 font-bold text-slate-800">{r.name}</td>
                          <td className="px-2 py-1.5">{r.employeeCode ? `${r.employeeCode} — ${r.employeeName}` : '—'}</td>
                          <td className="px-2 py-1.5">{r.matchedBy ? MATCH_LABEL[r.matchedBy] : '—'}</td>
                          <td className="px-2 py-1.5 tabular-nums">{r.amount.toLocaleString()}</td>
                          <td className="px-2 py-1.5 tabular-nums">{r.installmentsCreated ? `${r.installmentsCreated} (${r.installmentsPaid})` : '—'}</td>
                          <td className="px-2 py-1.5">
                            <span className={r.status === 'IMPORTED' ? 'text-emerald-700' : r.status === 'DUPLICATE' ? 'text-slate-500' : 'font-bold text-amber-700'}>
                              {STATUS_LABEL[r.status]}
                            </span>
                            {warn.length > 0 && <div className="mt-0.5 text-[11px] text-amber-700">{warn.join(' • ')}</div>}
                          </td>
                          {!result && (
                            <td className="px-2 py-1.5">
                              {r.status === 'MISSING' || r.matchedBy === 'CREATED' ? (
                                <input type="checkbox" checked={Boolean(create[r.rowKey])} disabled={busy} onChange={() => void toggleCreate(r.rowKey)} />
                              ) : null}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsed.skippedRows.length > 0 && (
                <p className="text-[11px] text-slate-500">صفوف تُركت: {parsed.skippedRows.map((s) => `#${s.rowNo} (${s.reason})`).join('، ')}</p>
              )}
              {!result && (
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">إلغاء</button>
                  <button type="button" disabled={busy || !counts?.ok} onClick={() => void confirm()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    استيراد {counts?.ok} سلفة
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
