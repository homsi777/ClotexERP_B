import { outputSize, type EditParams } from './imageEditMath';

/** يحمّل صورة (data URL أو blob URL) كعنصر Image جاهز للرسم. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    img.src = src;
  });
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    r.readAsDataURL(file);
  });
}

/**
 * يقرأ صورة من الهاتف/الكمبيوتر ويصغّرها (أطول ضلع ≤ maxEdge) كـ JPEG لتخفيف الرفع.
 * المتصفحات الحديثة تطبّق اتجاه EXIF تلقائياً عند رسم Image؛ لذا صور الهاتف تظهر بالاتجاه الصحيح.
 */
export async function fileToDownscaledDataUrl(file: File, maxEdge = 2400, quality = 0.9): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('الملف ليس صورة');
  const raw = await fileToDataUrl(file);
  const img = await loadImage(raw);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale >= 1 && file.size < 900_000 && /jpe?g|png|webp/.test(file.type)) return raw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('المتصفح لا يدعم معالجة الصور');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** يرسم الصورة بعد التدوير على canvas بحجم الصورة المدوَّرة (أو مصغّراً بالمعامل scale). */
export function drawRotated(img: HTMLImageElement, rotation: number, scale = 1): HTMLCanvasElement {
  const swap = rotation === 90 || rotation === 270;
  const w = Math.max(1, Math.round((swap ? img.naturalHeight : img.naturalWidth) * scale));
  const h = Math.max(1, Math.round((swap ? img.naturalWidth : img.naturalHeight) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('المتصفح لا يدعم معالجة الصور');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, (-img.naturalWidth * scale) / 2, (-img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
  return canvas;
}

/** يطبّق التدوير ثم القص على الأصل ويرجع JPEG data URL. لا يمدّد الصورة: يحافظ على النسبة. */
export async function renderEdited(originalDataUrl: string, params: EditParams, maxEdge = 2400, quality = 0.92): Promise<string> {
  const img = await loadImage(originalDataUrl);
  const out = outputSize(img.naturalWidth, img.naturalHeight, params, maxEdge);
  const rotated = drawRotated(img, params.rotation, 1);
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('المتصفح لا يدعم معالجة الصور');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.w, out.h);
  ctx.drawImage(rotated, out.cropPx.x, out.cropPx.y, out.cropPx.w, out.cropPx.h, 0, 0, out.w, out.h);
  return canvas.toDataURL('image/jpeg', quality);
}
