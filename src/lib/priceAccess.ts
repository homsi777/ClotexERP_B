import type { AuthUser } from './api/authApi';

/**
 * حق التسعير/الاطلاع على الأرقام المالية لفواتير بيع/شراء (يطابق canPrice بالخادم):
 * المدير دائماً؛ بوضع «مخصّص» من مُنح «تسعير» أو «اعتماد» للوحدة؛ وبوضع الدور المحاسب والمدير التشغيلي فقط.
 * الحماية الفعلية بالخادم (يخفي الأرقام ويحفظ مسودة بلا أسعار)؛ هذا لإخفاء الأعمدة وتبديل الأزرار.
 */
export function canPriceUser(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null | undefined, module: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.permMode === 'CUSTOM') {
    const m = user.permMatrix ?? [];
    return m.includes(`p:${module}.price`) || m.includes(`p:${module}.approve`);
  }
  return user.role === 'accountant' || user.role === 'manager';
}
