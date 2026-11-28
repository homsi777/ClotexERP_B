import { useMemo, useRef, useState } from 'react';
import { ClipboardCopy, Loader2, Plus, ScanBarcode, Trash2, X } from 'lucide-react';
import { bulkLookupRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { classifyBulk, groupBulkRolls, parseBarcodeList, rollQty, rollUnitOf, type BulkRow, type BulkRowStatus, type BulkRules } from '../../lib/bulkBarcode';
import { ApiRequestError } from '../../lib/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** قواعد الصلاحية/التكرار الخاصة بالمستند (نفس قواعد الإدخال الفردي). */
  rules: BulkRules;
  /** تُستدعى بالأتواب الصالحة فقط بعد إعادة التحقق منها قبل الإضافة مباشرة. */
  onAdd: (rolls: FabricRollDto[]) => void;
  /** شرط لازم قبل التحقق (مثل اختيار المستودع). */
  precondition?: { ok: boolean; message: string };
}

const TONE: Record<BulkRowStatus, { row: string; badge: string; label: string }> = {
  OK: { row: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800', label: 'صالح' },
  DUPLICATE: { row: 'bg-amber-50', badge: 'bg-amber-100 text-amber-800', label: 'مكرر' },
  IN_DOCUMENT: { row: 'bg-amber-50', badge: 'bg-amber-100 text-amber-800', label: 'موجود بالمستند' },
  NOT_FOUND: { row: 'bg-rose-50', badge: 'bg-rose-100 text-rose-800', label: 'غير موجود' },
  REJECTED: { row: 'bg-rose-50', badge: 'bg-rose-100 text-rose-800', label: 'مرفوض' },
};

const nf = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** إدخال الباركودات بالجملة: لصق/تفريغ قارئ → فرز وتحقق (طلب واحد) → مراجعة → إضافة الصالح فقط. */
export function BulkBarcodeModal({ open, onClose, title, rules, onAdd, precondition }: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [busy, setBusy] = useState<'verify' | 'add' | null>(null);
  const [message, setMessage] = useState('');
  const addingRef = useRef(false);

  const parsed = useMemo(() => parseBarcodeList(text), [text]);
  const okRows = rows.filter((r) => r.status === 'OK' && r.roll);
  const { groups, totals } = useMemo(() => groupBulkRolls(okRows.map((r) => r.roll as FabricRollDto)), [okRows]);
  const problemRows = rows.filter((r) => r.status !== 'OK');

  if (!open) return null;

  const verify = async (list = parsed): Promise<BulkRow[] | null> => {
    if (precondition && !precondition.ok) { setMessage(precondition.message); return null; }
    if (!list.unique.length) { setMessage('أدخل باركودات أولاً.'); return null; }
    try {
      const found = await bulkLookupRolls(list.unique);
      return classifyBulk(list, found, rules);
    } catch (e) {
      setMessage(e instanceof ApiRequestError ? e.message : 'تعذّر التحقق من الباركودات.');
      return null;
    }
  };

  const onVerify = async () => {
    setBusy('verify'); setMessage('');
    const r = await verify();
    if (r) setRows(r);
    setBusy(null);
  };

  const onAddValid = async () => {
    if (addingRef.current || !okRows.length) return;
    addingRef.current = true; setBusy('add'); setMessage('');
    try {
      // إعادة تحقق فورية من توفر الأتواب قبل الإضافة (منع التزامن/التغيّر منذ الفرز)
      const fresh = await verify(parseBarcodeList(okRows.map((r) => r.barcode).join('\n')));
      if (!fresh) return;
      const stillOk = fresh.filter((r) => r.status === 'OK' && r.roll);
      const dropped = okRows.length - stillOk.length;
      if (stillOk.length) onAdd(stillOk.map((r) => r.roll as FabricRollDto));
      const addedKeys = new Set(stillOk.map((r) => r.key));
      const keep = [
        ...rows.filter((r) => r.status !== 'OK'),
        ...fresh.filter((r) => r.status !== 'OK' && r.status !== 'DUPLICATE'),
      ];
      setRows(keep);
      setMessage(`أُضيف ${addedKeys.size} توب${dropped > 0 ? ` — ${dropped} لم يعد متاحاً وتُرك للمراجعة` : ''}.`);
      if (!keep.length) { setText(''); onClose(); }
    } finally {
      addingRef.current = false; setBusy(null);
    }
  };

  const copyRejected = async () => {
    const list = [...new Set(problemRows.map((r) => r.barcode))].join('\n');
    if (!list) return;
    try { await navigator.clipboard.writeText(list); setMessage(`نُسخ ${list.split('\n').length} باركود للمراجعة.`); }
    catch { setMessage('تعذّر النسخ تلقائياً — حدّد الباركودات يدوياً.'); }
  };

  const clearAll = () => { setText(''); setRows([]); setMessage(''); };
  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/55 p-3" dir="rtl" role="dialog" aria-modal="true">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="flex items-center gap-2 text-lg font-black text-slate-900"><ScanBarcode className="h-5 w-5 text-indigo-600" />{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg border px-2 py-1 hover:bg-slate-50" aria-label="إغلاق"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <div>
            <textarea
              dir="ltr"
              autoFocus
              value={text}
              onChange={(e) => { setText(e.target.value); }}
              placeholder={'الصق الباركودات هنا أو فرّغ ذاكرة القارئ داخل هذا المربع (سطر لكل باركود، أو مفصولة بمسافة/فاصلة/Tab)'}
              className="h-32 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-lg bg-slate-100 px-2 py-1 font-bold">عدد الباركودات: {parsed.total.toLocaleString('en-US')}</span>
              {parsed.total !== parsed.unique.length && <span className="rounded-lg bg-amber-100 px-2 py-1 font-bold text-amber-800">فريد: {parsed.unique.length.toLocaleString('en-US')} — مكرر: {(parsed.total - parsed.unique.length).toLocaleString('en-US')}</span>}
              <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 font-bold hover:bg-slate-50"><Trash2 className="h-4 w-4" />مسح القائمة</button>
              <button type="button" disabled={busy !== null || !parsed.unique.length} onClick={() => void onVerify()} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                {busy === 'verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanBarcode className="h-4 w-4" />}فرز والتحقق
              </button>
            </div>
            {message && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">{message}</p>}
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">صالح: {okRows.length}</span>
                <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">مكرر/موجود: {rows.filter((r) => r.status === 'DUPLICATE' || r.status === 'IN_DOCUMENT').length}</span>
                <span className="rounded bg-rose-100 px-2 py-1 text-rose-800">مرفوض/غير موجود: {rows.filter((r) => r.status === 'REJECTED' || r.status === 'NOT_FOUND').length}</span>
                {problemRows.length > 0 && (
                  <button type="button" onClick={() => void copyRejected()} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1 hover:bg-slate-50"><ClipboardCopy className="h-4 w-4" />نسخ المرفوضة وغير الصالحة</button>
                )}
              </div>

              <div className="max-h-[38vh] overflow-auto rounded-xl border">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr>
                      {['#', 'الباركود', 'الخامة', 'كود الخامة', 'اللون', 'كود اللون', 'اللوط', 'الأمتار', 'الوزن (كغ)', 'الوحدة', 'المستودع', 'الموقع', 'الحالة', 'السبب / ملاحظة', ''].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 text-right">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const tone = TONE[r.status];
                      const roll = r.roll;
                      const unit = roll ? rollUnitOf(roll) : null;
                      return (
                        <tr key={r.key} className={`${tone.row} border-t`}>
                          <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                          <td className="px-2 py-1.5 font-mono" dir="ltr">{r.barcode}</td>
                          <td className="px-2 py-1.5">{roll?.item_name ?? ''}</td>
                          <td className="px-2 py-1.5 font-mono">{roll?.internal_code ?? ''}</td>
                          <td className="px-2 py-1.5">{roll?.color_name_ar ?? roll?.color_name_tr ?? ''}</td>
                          <td className="px-2 py-1.5 font-mono">{roll?.color_code ?? ''}</td>
                          <td className="px-2 py-1.5 font-mono">{roll?.lot_no ?? ''}</td>
                          <td className="px-2 py-1.5 font-mono">{roll && unit === 'm' ? nf(rollQty(roll)) : ''}</td>
                          <td className="px-2 py-1.5 font-mono">{roll ? nf(Number(roll.actual_weight_kg ?? roll.calculated_weight_kg ?? 0) || 0) : ''}</td>
                          <td className="px-2 py-1.5">{unit === 'kg' ? 'كيلو' : unit === 'm' ? 'متر' : ''}</td>
                          <td className="px-2 py-1.5">{roll?.warehouse_name ?? ''}</td>
                          <td className="px-2 py-1.5">{roll?.location_name ?? ''}</td>
                          <td className="px-2 py-1.5"><span className={`rounded px-2 py-0.5 font-bold ${tone.badge}`}>{tone.label}</span></td>
                          <td className="px-2 py-1.5 text-slate-700">{r.reason}</td>
                          <td className="px-2 py-1.5"><button type="button" onClick={() => removeRow(r.key)} className="rounded border bg-white px-1.5 py-0.5 hover:bg-slate-100" aria-label="إزالة من القائمة"><X className="h-3 w-3" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {groups.length > 0 && (
                <div className="rounded-xl border">
                  <div className="border-b bg-slate-50 px-3 py-2 text-sm font-black">ملخص الأتواب الصالحة (الأمتار والكيلو منفصلان)</div>
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>{['الخامة', 'كود الخامة', 'اللون', 'كود اللون', 'الوحدة', 'الأتواب', 'الأمتار', 'الكيلو'].map((h) => <th key={h} className="px-2 py-1.5 text-right">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.key} className="border-t">
                          <td className="px-2 py-1.5">{g.material}</td><td className="px-2 py-1.5 font-mono">{g.materialCode}</td>
                          <td className="px-2 py-1.5">{g.colour}</td><td className="px-2 py-1.5 font-mono">{g.colourCode}</td>
                          <td className="px-2 py-1.5">{g.unit === 'kg' ? 'كيلو' : 'متر'}</td>
                          <td className="px-2 py-1.5 font-mono">{g.rolls}</td>
                          <td className="px-2 py-1.5 font-mono">{g.unit === 'm' ? nf(g.meters) : '—'}</td>
                          <td className="px-2 py-1.5 font-mono">{g.unit === 'kg' ? nf(g.kg) : '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 bg-slate-100 font-black">
                        <td className="px-2 py-2" colSpan={5}>الإجمالي العام</td>
                        <td className="px-2 py-2 font-mono">{totals.rolls}</td>
                        <td className="px-2 py-2 font-mono">{nf(totals.meters)} م</td>
                        <td className="px-2 py-2 font-mono">{nf(totals.kg)} كغ</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-500">لا تُؤكَّد الفاتورة ولا يُنشأ قيد عند الإضافة: تبقى مسودة قابلة للمراجعة والتعديل.</p>
          <button
            type="button"
            disabled={busy !== null || okRows.length === 0}
            onClick={() => void onAddValid()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 font-black text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            إضافة الأتواب الصالحة ({okRows.length})
          </button>
        </div>
      </div>
    </div>
  );
}
