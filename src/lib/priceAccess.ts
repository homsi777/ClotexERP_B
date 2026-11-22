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

/** اعتماد عملية (إهلاك مادي…) — يطابق canApprove بالخادم. */
export function canApproveUser(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null | undefined, module: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.permMode === 'CUSTOM') return (user.permMatrix ?? []).includes(`p:${module}.approve`);
  return user.role === 'accountant' || user.role === 'manager';
}

/** تعديل مباشر بلا إذن (يطابق canEditDirect بالخادم): مدير/محاسب/مدير تشغيلي بالدور؛ وبالمصفوفة من مُنح «تعديل». */
export function canEditDirectUser(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null | undefined, module: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.permMode === 'CUSTOM') return (user.permMatrix ?? []).includes(`p:${module}.edit`);
  return user.role === 'accountant' || user.role === 'manager';
}

/** الاطلاع على الأمور المالية لطرف (كشف حساب/أرصدة) — يطابق canSeeFinance بالخادم. */
export function canSeeFinanceUser(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null | undefined, module: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.permMode === 'CUSTOM') return (user.permMatrix ?? []).includes(`p:${module}.costView`);
  return user.role === 'accountant' || user.role === 'manager';
}
