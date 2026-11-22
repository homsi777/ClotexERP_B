import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Pencil, Trash2, Undo2 } from 'lucide-react';
import {
  SIDE_LABEL,
  addCheckImageApi,
  canDeleteCheckImage,
  canMatrix,
  deleteCheckImageApi,
  getCheckImageContent,
  listCheckImages,
  resetCheckImageApi,
  saveCheckImageEditApi,
  type CheckImageMeta,
  type CheckImageSide,
} from '../../lib/api/checkImagesApi';
import { fetchMe, type AuthUser } from '../../lib/api/authApi';
import { fileToDownscaledDataUrl } from '../../lib/image/imageFile';
import { parseEditParams } from '../../lib/image/imageEditMath';
import { ImageEditorModal, type ImageEditorResult } from '../common/ImageEditorModal';
import { useToast } from '../NonBlockingToast';
import { clearCheckImageCache } from './CheckEntryFields';

type Editing =
  | { kind: 'new'; src: string; side: CheckImageSide }
  | { kind: 'existing'; meta: CheckImageMeta; originalSrc: string };

/** صور شيك واحد (وجه/ظهر…): عرض، إضافة من الجهاز/الهاتف، تعديل (قص/تدوير) مع حفظ الأصل، إعادة للأصل، وحذف بصلاحية. */
export const CheckImagesPanel: React.FC<{ checkId: string; onChanged?: () => void }> = ({ checkId, onChanged }) => {
  const { showToast } = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [metas, setMetas] = useState<CheckImageMeta[]>([]);
  const [data, setData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [newSide, setNewSide] = useState<CheckImageSide>('FRONT');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchMe().then(setUser).catch(() => setUser(null));
  }, []);

  const canView = canMatrix(user, 'treasury.check_images', 'view');
  const canAdd = canMatrix(user, 'treasury.check_images', 'create');
  const canEdit = canMatrix(user, 'treasury.check_images', 'edit');
  const canDelete = canDeleteCheckImage(user);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCheckImages(checkId);
      setMetas(list);
      const entries = await Promise.all(list.map(async (m) => [m.id, await getCheckImageContent(m.id, 'effective')] as const));
      setData(Object.fromEntries(entries));
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر تحميل الصور' });
    } finally {
      setLoading(false);
    }
  }, [checkId, showToast]);

  useEffect(() => {
    if (canView) void load();
    else setLoading(false);
  }, [load, canView]);

  const changed = () => {
    clearCheckImageCache(checkId);
    onChanged?.();
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setEditing({ kind: 'new', src: await fileToDownscaledDataUrl(file), side: newSide });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر قراءة الصورة' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openExisting = async (meta: CheckImageMeta) => {
    setBusy(true);
    try {
      // التحرير دائماً من الأصل كي لا تتراكم الخسارة.
      setEditing({ kind: 'existing', meta, originalSrc: await getCheckImageContent(meta.id, 'original') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر فتح الصورة' });
    } finally {
      setBusy(false);
    }
  };

  const onSaveEditor = async (r: ImageEditorResult) => {
    if (!editing) return;
    try {
      if (editing.kind === 'new') {
        const created = await addCheckImageApi(checkId, editing.side, editing.src);
        if (!r.isIdentity) await saveCheckImageEditApi(created.id, r.dataUrl, r.params);
        showToast({ type: 'success', message: 'تمت إضافة صورة الشيك' });
      } else if (r.isIdentity) {
        if (editing.meta.hasEdit) await resetCheckImageApi(editing.meta.id);
        showToast({ type: 'success', message: 'عادت الصورة إلى أصلها' });
      } else {
        await saveCheckImageEditApi(editing.meta.id, r.dataUrl, r.params);
        showToast({ type: 'success', message: 'تم حفظ التعديل (الأصل محفوظ)' });
      }
      setEditing(null);
      changed();
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر الحفظ' });
      throw e;
    }
  };

  const reset = async (m: CheckImageMeta) => {
    setBusy(true);
    try {
      await resetCheckImageApi(m.id);
      changed();
      await load();
      showToast({ type: 'success', message: 'عادت الصورة إلى أصلها' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر الإجراء' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: CheckImageMeta) => {
    if (!window.confirm('حذف هذه الصورة نهائياً (بأصلها)؟ لا يمكن التراجع.')) return;
    setBusy(true);
    try {
      await deleteCheckImageApi(m.id);
      changed();
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر الحذف' });
    } finally {
      setBusy(false);
    }
  };

  if (!canView) return <div className="p-4 text-center text-sm text-slate-400">لا تملك صلاحية عرض صور الشيكات.</div>;

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center p-6 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : metas.length === 0 ? (
        <div className="p-4 text-center text-sm text-slate-400">لا توجد صورة لهذا الشيك.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {metas.map((m) => (
            <figure key={m.id} className="space-y-2 rounded-xl border border-slate-200 p-2">
              <img src={data[m.id]} alt={SIDE_LABEL[m.side]} className="max-h-56 w-full rounded-lg bg-slate-50 object-contain" />
              <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-700">
                  {SIDE_LABEL[m.side]} {m.hasEdit && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">معدَّلة</span>}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {canEdit && (
                    <button type="button" disabled={busy} onClick={() => void openExisting(m)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <Pencil className="h-3.5 w-3.5" /> تعديل
                    </button>
                  )}
                  {canEdit && m.hasEdit && (
                    <button type="button" disabled={busy} onClick={() => void reset(m)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <Undo2 className="h-3.5 w-3.5" /> الأصل
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" disabled={busy} onClick={() => void remove(m)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" /> حذف
                    </button>
                  )}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {canAdd && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 p-3">
          <select value={newSide} onChange={(e) => setNewSide(e.target.value as CheckImageSide)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            {(Object.keys(SIDE_LABEL) as CheckImageSide[]).map((s) => (
              <option key={s} value={s}>{SIDE_LABEL[s]}</option>
            ))}
          </select>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
          <button type="button" disabled={busy || metas.length >= 6} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            إضافة صورة (كاميرا أو ملف)
          </button>
          <span className="text-[11px] text-slate-500">تُفتح نافذة تحرير (قص/تدوير) قبل الحفظ.</span>
        </div>
      )}

      {editing && (
        <ImageEditorModal
          title={editing.kind === 'new' ? `إضافة صورة — ${SIDE_LABEL[editing.side]}` : `تعديل — ${SIDE_LABEL[editing.meta.side]}`}
          originalSrc={editing.kind === 'new' ? editing.src : editing.originalSrc}
          initialParams={editing.kind === 'existing' ? parseEditParams(editing.meta.editParams) : null}
          onSave={onSaveEditor}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
};
