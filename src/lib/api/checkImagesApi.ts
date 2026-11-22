import { apiFetch } from './client';
import type { AuthUser } from './authApi';

export type CheckImageSide = 'FRONT' | 'BACK' | 'OTHER';

export interface CheckImageMeta {
  id: string;
  checkId: string;
  side: CheckImageSide;
  sortOrder: number;
  hasEdit: boolean;
  editParams: unknown;
  updatedAt: string;
}

export const SIDE_LABEL: Record<CheckImageSide, string> = { FRONT: 'الوجه الأمامي', BACK: 'الوجه الخلفي', OTHER: 'صورة أخرى' };

export function listCheckImages(checkId: string) {
  return apiFetch<{ ok: boolean; data: CheckImageMeta[] }>(`/api/check-images/by-check/${checkId}`).then((r) => r.data);
}

export function getCheckImageContent(imageId: string, variant: 'effective' | 'original' = 'effective') {
  return apiFetch<{ ok: boolean; data: { image: string; checkId: string } }>(`/api/check-images/${imageId}/data?variant=${variant}`).then((r) => r.data.image);
}

export function addCheckImageApi(checkId: string, side: CheckImageSide, data: string) {
  return apiFetch<{ ok: boolean; data: CheckImageMeta }>(`/api/check-images/by-check/${checkId}`, {
    method: 'POST',
    body: JSON.stringify({ side, data }),
  }).then((r) => r.data);
}

export function saveCheckImageEditApi(imageId: string, editedData: string, editParams: unknown, side?: CheckImageSide) {
  return apiFetch<{ ok: boolean; data: CheckImageMeta }>(`/api/check-images/${imageId}`, {
    method: 'PUT',
    body: JSON.stringify({ editedData, editParams, side }),
  }).then((r) => r.data);
}

export function resetCheckImageApi(imageId: string) {
  return apiFetch<{ ok: boolean; data: CheckImageMeta }>(`/api/check-images/${imageId}/reset`, { method: 'PUT', body: JSON.stringify({}) }).then((r) => r.data);
}

export function deleteCheckImageApi(imageId: string) {
  return apiFetch<{ ok: boolean }>(`/api/check-images/${imageId}`, { method: 'DELETE' });
}

export interface CheckPrintData {
  checkId: string;
  deliveredAt: string | null;
  images: { id: string; side: CheckImageSide; data: string }[];
}

/** بيانات الطباعة (صور فعّالة + تاريخ التسليم) على دفعات ≤ 60 شيكاً. */
export async function fetchCheckPrintData(checkIds: string[]): Promise<CheckPrintData[]> {
  const out: CheckPrintData[] = [];
  for (let i = 0; i < checkIds.length; i += 40) {
    const ids = checkIds.slice(i, i + 40).join(',');
    const r = await apiFetch<{ ok: boolean; data: CheckPrintData[] }>(`/api/check-images/print-data?ids=${ids}`);
    out.push(...r.data);
  }
  return out;
}

/** صلاحية المصفوفة للمستخدم: المدير ووضع الدور غير مقيَّدين هنا؛ الحماية الفعلية بالخادم. */
export function canMatrix(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null, module: string, action: string): boolean {
  if (!user || user.role === 'admin' || user.permMode !== 'CUSTOM') return true;
  return (user.permMatrix ?? []).includes(`p:${module}.${action}`);
}

/** حذف الصورة: بوضع الدور للمحاسب/المدير فقط؛ وبالمصفوفة لمن مُنح «حذف». */
export function canDeleteCheckImage(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.permMode === 'CUSTOM') return canMatrix(user, 'treasury.check_images', 'delete');
  return user.role === 'accountant';
}
