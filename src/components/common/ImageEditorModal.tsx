import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RotateCcw, RotateCw, Undo2, X, ZoomIn, ZoomOut, FlipVertical } from 'lucide-react';
import {
  FULL_CROP,
  IDENTITY_PARAMS,
  cropFromPoints,
  dragCrop,
  isIdentity,
  rotateBy,
  type CropRect,
  type EditParams,
  type Handle,
  type Rotation,
} from '../../lib/image/imageEditMath';
import { drawRotated, loadImage, renderEdited } from '../../lib/image/imageFile';

export interface ImageEditorResult {
  /** الصورة بعد التدوير/القص (JPEG). */
  dataUrl: string;
  params: EditParams;
  /** لا تدوير ولا قص — الناتج هو الأصل نفسه. */
  isIdentity: boolean;
}

type Props = {
  /** الصورة الأصلية دائماً (لا المعدَّلة) كي لا تتراكم الخسارة عند إعادة التعديل. */
  originalSrc: string;
  /** معاملات آخر تعديل محفوظ لإعادة فتح المحرر على نفس الحالة. */
  initialParams?: EditParams | null;
  title?: string;
  saveLabel?: string;
  /** حد أطول ضلع للناتج وجودة JPEG (الافتراضي 2400 / 0.92). */
  maxEdge?: number;
  quality?: number;
  onSave: (result: ImageEditorResult) => void | Promise<void>;
  onCancel: () => void;
};

const HANDLES: { h: Handle; cls: string; cursor: string }[] = [
  { h: 'nw', cls: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { h: 'n', cls: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { h: 'ne', cls: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { h: 'e', cls: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { h: 'se', cls: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { h: 's', cls: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { h: 'sw', cls: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { h: 'w', cls: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

/**
 * محرر صور قابل لإعادة الاستخدام: معاينة، تدوير 90/180، قص يدوي بالسحب، تكبير/تصغير، إعادة ضبط، حفظ/إلغاء.
 * يعمل بالمؤشر (ماوس ولمس). القص نسبي على الصورة بعد التدوير، ولا يمدّد الصورة.
 */
export const ImageEditorModal: React.FC<Props> = ({ originalSrc, initialParams, title = 'تحرير الصورة', saveLabel = 'حفظ', maxEdge = 2400, quality = 0.92, onSave, onCancel }) => {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState<Rotation>(initialParams?.rotation ?? 0);
  const [crop, setCrop] = useState<CropRect>(initialParams?.crop ?? FULL_CROP);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Handle | 'new'; startCrop: CropRect; px: number; py: number; ax: number; ay: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadImage(originalSrc)
      .then((i) => !cancelled && setImg(i))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'تعذّر فتح الصورة'));
    return () => {
      cancelled = true;
    };
  }, [originalSrc]);

  // معاينة مصغّرة (أطول ضلع ≤ 1400px) للأداء؛ الناتج النهائي يُرسم من الأصل كاملاً.
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const rotated = drawRotated(img, rotation, scale);
    const c = canvasRef.current;
    c.width = rotated.width;
    c.height = rotated.height;
    c.getContext('2d')?.drawImage(rotated, 0, 0);
  }, [img, rotation]);

  const params: EditParams = useMemo(() => ({ rotation, crop }), [rotation, crop]);
  const identity = isIdentity(params);

  const rotate = (delta: number) => {
    setRotation((r) => rotateBy(r, delta));
    setCrop(FULL_CROP); // بعد التدوير يُعاد القص للصورة كاملة (الإحداثيات تغيّرت).
  };

  const norm = useCallback((clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height, w: r.width, h: r.height };
  }, []);

  const startDrag = (e: React.PointerEvent, mode: Handle | 'new') => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = norm(e.clientX, e.clientY);
    drag.current = { mode, startCrop: crop, px: p.x, py: p.y, ax: Math.min(1, Math.max(0, p.x)), ay: Math.min(1, Math.max(0, p.y)) };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = norm(e.clientX, e.clientY);
    if (d.mode === 'new') setCrop(cropFromPoints(d.ax, d.ay, Math.min(1, Math.max(0, p.x)), Math.min(1, Math.max(0, p.y))));
    else setCrop(dragCrop(d.startCrop, d.mode, p.x - d.px, p.y - d.py));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const reset = () => {
    setRotation(IDENTITY_PARAMS.rotation);
    setCrop(FULL_CROP);
    setZoom(1);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const dataUrl = identity ? originalSrc : await renderEdited(originalSrc, params, maxEdge, quality);
      await onSave({ dataUrl, params, isIdentity: identity });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر حفظ الصورة');
      setSaving(false);
    }
  };

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 p-3" dir="rtl" role="dialog" aria-label={title}>
      <div className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="font-black text-slate-900">{title}</h3>
          <button type="button" onClick={onCancel} aria-label="إغلاق" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <button type="button" className={btn} onClick={() => rotate(-90)} title="تدوير 90° لليسار"><RotateCcw className="h-4 w-4" /> يسار 90°</button>
          <button type="button" className={btn} onClick={() => rotate(90)} title="تدوير 90° لليمين"><RotateCw className="h-4 w-4" /> يمين 90°</button>
          <button type="button" className={btn} onClick={() => rotate(180)} title="تدوير 180°"><FlipVertical className="h-4 w-4" /> 180°</button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5} aria-label="تصغير"><ZoomOut className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs font-bold text-slate-600">{Math.round(zoom * 100)}%</span>
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} disabled={zoom >= 4} aria-label="تكبير"><ZoomIn className="h-4 w-4" /></button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <button type="button" className={btn} onClick={() => setCrop(FULL_CROP)} disabled={crop === FULL_CROP || (crop.w >= 0.999 && crop.h >= 0.999)}>إلغاء القص</button>
          <button type="button" className={btn} onClick={reset} disabled={identity && zoom === 1}><Undo2 className="h-4 w-4" /> إعادة ضبط</button>
        </div>

        <div className="min-h-[240px] flex-1 overflow-auto bg-slate-200 p-3">
          {!img && !error && (
            <div className="flex h-60 items-center justify-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
          {img && (
            <div
              ref={wrapRef}
              className="relative mx-auto select-none touch-none bg-white shadow"
              style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none' }}
              onPointerDown={(e) => startDrag(e, 'new')}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <canvas ref={canvasRef} className="block h-auto w-full" />
              {/* تعتيم خارج منطقة القص */}
              <div className="pointer-events-none absolute inset-0 bg-black/45" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${crop.x * 100}% ${crop.y * 100}%,${crop.x * 100}% ${(crop.y + crop.h) * 100}%,${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%,${(crop.x + crop.w) * 100}% ${crop.y * 100}%,${crop.x * 100}% ${crop.y * 100}%)` }} />
              <div
                className="absolute cursor-move border-2 border-indigo-500"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={(e) => startDrag(e, 'move')}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {HANDLES.map(({ h, cls, cursor }) => (
                  <span
                    key={h}
                    data-handle={h}
                    className={`absolute h-4 w-4 rounded-full border-2 border-white bg-indigo-600 ${cls}`}
                    style={{ cursor, touchAction: 'none' }}
                    onPointerDown={(e) => startDrag(e, h)}
                    onPointerMove={onMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">اسحب على الصورة لتحديد منطقة القص، أو حرّك الإطار ومقابضه. الصورة الأصلية تبقى محفوظة دائماً.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">إلغاء</button>
            <button type="button" onClick={() => void save()} disabled={!img || saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
