/** حسابات محرر الصور (تدوير/قص) — دوال صِرفة بلا DOM كي تُختبر. القص يُخزَّن نسبياً (0..1) على الصورة بعد التدوير. */

export type Rotation = 0 | 90 | 180 | 270;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditParams {
  rotation: Rotation;
  crop: CropRect;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
export const MIN_CROP = 0.05;

export const IDENTITY_PARAMS: EditParams = { rotation: 0, crop: FULL_CROP };

export function normalizeRotation(deg: number): Rotation {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

export function rotateBy(current: Rotation, delta: number): Rotation {
  return normalizeRotation(current + delta);
}

/** أبعاد الصورة بعد التدوير. */
export function rotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

export function isIdentity(p: EditParams): boolean {
  const c = p.crop;
  return p.rotation === 0 && c.x <= 0.0005 && c.y <= 0.0005 && c.w >= 0.999 && c.h >= 0.999;
}

/** حجم الناتج بالبكسل: منطقة القص من الصورة المدوَّرة، مصغّرة إن تجاوزت أطول ضلع الحد. */
export function outputSize(srcW: number, srcH: number, p: EditParams, maxEdge = 2400): { w: number; h: number; cropPx: { x: number; y: number; w: number; h: number } } {
  const rot = rotatedSize(srcW, srcH, p.rotation);
  const c = clampCrop(p.crop);
  const cropPx = { x: Math.round(c.x * rot.w), y: Math.round(c.y * rot.h), w: Math.max(1, Math.round(c.w * rot.w)), h: Math.max(1, Math.round(c.h * rot.h)) };
  const scale = Math.min(1, maxEdge / Math.max(cropPx.w, cropPx.h));
  return { w: Math.max(1, Math.round(cropPx.w * scale)), h: Math.max(1, Math.round(cropPx.h * scale)), cropPx };
}

export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** يطبّق سحباً (dx,dy نسبيان) على مقبض القص مع الحفاظ على الحدود والحد الأدنى. */
export function dragCrop(start: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  let { x, y, w, h } = start;
  if (handle === 'move') {
    return clampCrop({ x: x + dx, y: y + dy, w, h });
  }
  const right = x + w;
  const bottom = y + h;
  if (handle.includes('w')) {
    x = Math.min(right - MIN_CROP, Math.max(0, x + dx));
    w = right - x;
  }
  if (handle.includes('e')) {
    w = Math.min(1 - x, Math.max(MIN_CROP, w + dx));
  }
  if (handle.includes('n')) {
    y = Math.min(bottom - MIN_CROP, Math.max(0, y + dy));
    h = bottom - y;
  }
  if (handle.includes('s')) {
    h = Math.min(1 - y, Math.max(MIN_CROP, h + dy));
  }
  return clampCrop({ x, y, w, h });
}

/** مستطيل جديد من نقطتين (سحب على منطقة فارغة). */
export function cropFromPoints(ax: number, ay: number, bx: number, by: number): CropRect {
  return clampCrop({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });
}

export function parseEditParams(raw: unknown): EditParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { rotation?: unknown; crop?: Partial<CropRect> };
  const rotation = normalizeRotation(Number(r.rotation ?? 0));
  const c = r.crop;
  const crop = c && [c.x, c.y, c.w, c.h].every((n) => typeof n === 'number' && Number.isFinite(n)) ? clampCrop(c as CropRect) : FULL_CROP;
  return { rotation, crop };
}
