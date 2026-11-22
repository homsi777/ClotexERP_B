import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Eye, Loader2, Printer, X } from 'lucide-react';
import type { CheckDto } from '../../lib/api/checksApi';
import { canMatrix, fetchCheckPrintData, type CheckPrintData } from '../../lib/api/checkImagesApi';
import { fetchMe, type AuthUser } from '../../lib/api/authApi';
import { renderChecksSheetA4Html } from '../../lib/printing/renderChecksSheetA4';
import { buildChecksOriginalImagesHtml, type CheckPrintInfo } from '../../lib/printing/renderChecksImagesA4';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { useToast } from '../NonBlockingToast';

type Mode = 'cards' | 'images';
type OrderBy = 'selection' | 'due' | 'received';

type Props = {
  /** الشيكات المحدَّدة بترتيب اختيار المستخدم. */
  checks: CheckDto[];
  onRemove: (id: string) => void;
  onClose: () => void;
};

const toInfo = (c: CheckDto, d?: CheckPrintData): CheckPrintInfo => ({
  check_no: c.check_no,
  bank_name: c.bank_name,
  party_name: c.party_name,
  account_holder_name: c.account_holder_name,
  amount: c.amount,
  currency_code: c.currency_code,
  received_date: c.received_date,
  due_date: c.due_date,
  status: c.status,
  delivered_at: d?.deliveredAt ?? null,
});

/** نافذة خيارات طباعة الشيكات: كروت (التصميم الحالي) أو صور أصلية، مع معلومات القبض اختيارياً ومعاينة كاملة. */
export const ChecksPrintDialog: React.FC<Props> = ({ checks, onRemove, onClose }) => {
  const { t, i18n } = useTranslation('checksVault');
  const { showToast } = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<Mode>('cards');
  const [includeInfo, setIncludeInfo] = useState(false);
  const [includeBack, setIncludeBack] = useState(false);
  const [orderBy, setOrderBy] = useState<OrderBy>('selection');
  const [printData, setPrintData] = useState<Record<string, CheckPrintData>>({});
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    void fetchMe().then(setUser).catch(() => setUser(null));
  }, []);

  const canPrint = canMatrix(user, 'treasury.checks', 'print');
  const canSeeImages = canMatrix(user, 'treasury.check_images', 'view');

  // الصور الفعّالة وتواريخ التسليم تُجلب مرة لكل مجموعة شيكات (لا تعدّل شيئاً).
  const idsKey = checks.map((c) => c.id).join(',');
  useEffect(() => {
    if (!checks.length || !canSeeImages) return;
    let alive = true;
    setLoading(true);
    fetchCheckPrintData(checks.map((c) => c.id))
      .then((rows) => alive && setPrintData(Object.fromEntries(rows.map((r) => [r.checkId, r]))))
      .catch((e) => alive && showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر تحميل صور الشيكات' }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, canSeeImages]);

  const ordered = useMemo(() => {
    if (orderBy === 'selection') return checks;
    const key = orderBy === 'due' ? 'due_date' : 'received_date';
    return [...checks].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  }, [checks, orderBy]);

  const lang = i18n.language === 'tr' ? 'tr' : 'ar';

  const built = useMemo(() => {
    if (!ordered.length) return null;
    if (mode === 'images') {
      return buildChecksOriginalImagesHtml({
        items: ordered.map((c) => ({
          info: toInfo(c, printData[c.id]),
          images: (printData[c.id]?.images ?? []).map((i) => ({ side: i.side, data: i.data })),
        })),
        includeInfo,
        includeBack,
      });
    }
    const html = renderChecksSheetA4Html({
      lang,
      includeInfo,
      checks: ordered.map((c) => ({
        id: c.id,
        check_no: c.check_no,
        bank_name: c.bank_name,
        party_name: c.party_name,
        amount: c.amount,
        currency_code: c.currency_code,
        due_date: c.due_date,
        account_holder_name: c.account_holder_name,
        received_date: c.received_date,
        status: c.status,
        delivered_at: printData[c.id]?.deliveredAt ?? null,
        image_data: printData[c.id]?.images[0]?.data ?? null,
      })),
    });
    return { html, printedImages: ordered.length, missing: [] as CheckPrintInfo[] };
  }, [ordered, mode, includeInfo, includeBack, printData, lang]);

  const missing = built?.missing ?? [];
  const printable = mode === 'images' ? ordered.length - missing.length : ordered.length;
  const blocked = !canPrint || (mode === 'images' && !canSeeImages);

  const doPrint = () => {
    if (!built || blocked || printable === 0) return;
    if (missing.length && !window.confirm(`${missing.length} شيك بلا صورة لن يُطبع (${missing.map((m) => m.check_no).join('، ')}). المتابعة بطباعة الباقي؟`)) return;
    if (!openDocumentPrintWindow(built.html, t('print.title'))) {
      showToast({ type: 'error', message: 'منع المتصفح نافذة الطباعة — اسمح بالنوافذ المنبثقة' });
      return;
    }
    onClose();
  };

  const radio = (value: Mode, label: string, hint: string, disabled = false) => (
    <label className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${mode === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <input type="radio" name="check-print-mode" className="mt-1" checked={mode === value} disabled={disabled} onChange={() => setMode(value)} />
      <span>
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/55 p-3" dir="rtl" role="dialog" aria-label="طباعة الشيكات">
      <div className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="font-black text-slate-900">طباعة الشيكات</h3>
            <p className="text-xs text-slate-500">
              المحدَّد: <b>{ordered.length}</b> — سيُطبع: <b>{printable}</b>
              {loading && <Loader2 className="ms-2 inline h-3.5 w-3.5 animate-spin" />}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="text-sm font-bold text-slate-800">نوع الطباعة</h4>
              {radio('cards', 'كروت الشيكات', 'التصميم الحالي: كرت لكل شيك ببياناته.')}
              {radio('images', 'صور الشيكات الأصلية', canSeeImages ? 'الصورة المرفوعة لكل شيك تحت بعضها بنسبة أبعادها، دون شعار.' : 'تحتاج صلاحية عرض صور الشيكات.', !canSeeImages)}
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-bold text-slate-800">معلومات إضافية</h4>
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" className="mt-1" checked={includeInfo} onChange={(e) => setIncludeInfo(e.target.checked)} />
                <span>
                  إرفاق معلومات القبض والتفاصيل
                  <span className="block text-xs text-slate-500">من استُلم منه، تاريخ الاستلام، رقم الشيك، البنك، القيمة، الاستحقاق. للشيكات الصادرة: المستفيد وتاريخ التسليم.</span>
                </span>
              </label>
              {mode === 'images' && (
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" checked={includeBack} onChange={(e) => setIncludeBack(e.target.checked)} />
                  طباعة الوجه الخلفي/الصور الأخرى أيضاً
                </label>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-bold text-slate-800">ترتيب الطباعة</h4>
              <select value={orderBy} onChange={(e) => setOrderBy(e.target.value as OrderBy)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="selection">حسب ترتيب اختياري</option>
                <option value="due">حسب تاريخ الاستحقاق</option>
                <option value="received">حسب تاريخ الاستلام</option>
              </select>
            </div>

            {!canPrint && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">لا تملك صلاحية طباعة الشيكات.</p>}
            {mode === 'images' && missing.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <b>{missing.length} شيك بلا صورة — لن يُطبع:</b>
                  <div className="font-mono text-xs" dir="ltr">{missing.map((m) => m.check_no).join(' · ')}</div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-800">الشيكات المختارة</h4>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {ordered.map((c, i) => {
                const noImage = mode === 'images' && canSeeImages && !loading && !(printData[c.id]?.images.length);
                return (
                  <li key={c.id} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${noImage ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <span className="w-5 font-mono text-slate-400">{i + 1}</span>
                    <span className="flex-1 font-mono text-xs font-bold text-slate-700">{c.check_no} · {c.bank_name} · {Number(c.amount).toLocaleString()} {c.currency_code}</span>
                    {noImage && <span className="text-[11px] font-bold text-amber-700">بلا صورة</span>}
                    <button type="button" onClick={() => onRemove(c.id)} aria-label="إزالة من الطباعة" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><X className="h-4 w-4" /></button>
                  </li>
                );
              })}
              {!ordered.length && <li className="p-4 text-center text-sm text-slate-400">لا توجد شيكات مختارة.</li>}
            </ul>
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <Eye className="h-4 w-4" /> {showPreview ? 'إخفاء المعاينة' : 'معاينة الطباعة كاملة'}
            </button>
          </div>

          {showPreview && built && (
            <div className="lg:col-span-2">
              <iframe title="معاينة الطباعة" srcDoc={built.html} className="h-[60vh] w-full rounded-lg border border-slate-200 bg-slate-100" />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">إلغاء</button>
          <button type="button" onClick={doPrint} disabled={blocked || printable === 0 || loading} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">
            <Printer className="h-4 w-4" /> طباعة ({printable})
          </button>
        </div>
      </div>
    </div>
  );
};
