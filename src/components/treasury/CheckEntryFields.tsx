import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Trash2 } from 'lucide-react';
import { compressOrderLineImage, compressOrderLineImageErrorMessage } from '../../lib/compressOrderLineImage';
import { getCheckImage } from '../../lib/api/checksApi';
import { ImageEditorModal } from '../common/ImageEditorModal';

/** بيانات شيك جديد يُدخل مع السند (الصورة اختيارية). */
export interface CheckDraft {
  checkNo: string;
  bankName: string;
  accountHolderName: string;
  dueDate: string;
  imageData: string | null;
}

export const emptyCheckDraft = (): CheckDraft => ({ checkNo: '', bankName: '', accountHolderName: '', dueDate: '', imageData: null });

export const isCheckDraftComplete = (d: CheckDraft | undefined | null): boolean =>
  !!d && !!d.checkNo.trim() && !!d.bankName.trim() && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate);

/** اختيار صورة الشيك وضغطها قبل الإرسال. */
export const CheckImageInput: React.FC<{ value: string | null; onChange: (v: string | null) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation('checksVault');
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** الصورة المختارة بانتظار المعاينة/القص/التدوير قبل اعتمادها. */
  const [pending, setPending] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const res = await compressOrderLineImage(file);
      setPending(res.dataUrl);
    } catch (e) {
      setError(compressOrderLineImageErrorMessage(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-sm text-slate-700">{t('form.image')}</label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className="h-16 w-24 rounded-lg border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400">
            <ImagePlus className="h-5 w-5" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <button
            type="button"
            disabled={busy}
            onClick={() => ref.current?.click()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? t('form.imageBusy') : value ? t('form.imageChange') : t('form.imagePick')}
          </button>
          {value && (
            <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-xs text-rose-600">
              <Trash2 className="h-3 w-3" />
              {t('form.imageRemove')}
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">{t('form.imageOptional')}</p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {pending && (
        <ImageEditorModal
          title="معاينة وتحرير صورة الشيك"
          originalSrc={pending}
          saveLabel="اعتماد الصورة"
          maxEdge={1600}
          quality={0.85}
          onSave={(r) => {
            onChange(r.dataUrl);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
};

/** حقول الشيك الجديد (رقم، بنك، صاحب الحساب، استحقاق، صورة اختيارية). */
export const CheckEntryFields: React.FC<{ value: CheckDraft; onChange: (v: CheckDraft) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation('checksVault');
  const input = 'w-full border rounded-lg px-3 py-2 text-sm bg-white';
  return (
    <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm text-slate-700">{t('form.checkNo')}</label>
          <input value={value.checkNo} onChange={(e) => onChange({ ...value, checkNo: e.target.value })} className={input} dir="ltr" />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700">{t('form.bankName')}</label>
          <input value={value.bankName} onChange={(e) => onChange({ ...value, bankName: e.target.value })} className={input} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700">{t('form.accountHolderName')}</label>
          <input value={value.accountHolderName} onChange={(e) => onChange({ ...value, accountHolderName: e.target.value })} className={input} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700">{t('form.dueDate')}</label>
          <input type="date" value={value.dueDate} onChange={(e) => onChange({ ...value, dueDate: e.target.value })} className={input} dir="ltr" />
        </div>
      </div>
      <CheckImageInput value={value.imageData} onChange={(imageData) => onChange({ ...value, imageData })} />
    </div>
  );
};

const imageCache = new Map<string, string | null>();

/** بعد تعديل/إضافة صورة شيك تُمسح نسخته المخزَّنة لتُجلب من جديد. */
export function clearCheckImageCache(checkId: string): void {
  imageCache.delete(checkId);
}

/** صورة شيك تُجلب عند الطلب (القوائم لا تحمل الصور) مع تخزين مؤقت بالذاكرة. */
export const CheckImage: React.FC<{ checkId: string; className?: string }> = ({ checkId, className }) => {
  const [src, setSrc] = useState<string | null | undefined>(imageCache.get(checkId));
  React.useEffect(() => {
    if (imageCache.has(checkId)) return;
    let alive = true;
    void getCheckImage(checkId)
      .then((img) => {
        imageCache.set(checkId, img);
        if (alive) setSrc(img);
      })
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [checkId]);
  if (src === undefined) return <div className={`animate-pulse bg-slate-100 ${className ?? ''}`} />;
  if (!src) return <div className={`flex items-center justify-center bg-slate-50 text-slate-300 ${className ?? ''}`}><ImagePlus className="h-6 w-6" /></div>;
  return <img src={src} alt="" className={className} />;
};
