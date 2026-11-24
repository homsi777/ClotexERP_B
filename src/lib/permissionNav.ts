import type { AuthUser } from './api/authApi';

/**
 * إخفاء عناصر القوائم عن المستخدم بوضع «صلاحيات مخصّصة» حسب مصفوفته.
 * هذا تحسين للتجربة فقط؛ الحماية الحقيقية بالخادم (يرفض أي إجراء غير ممنوح).
 */
const PATH_MODULES: [string, string[]][] = [
  ['/inventory/movements-log', ['inventory.movements']],
  ['/inventory/yarn', ['inventory.yarn']],
  ['/inventory/categories', ['inventory.items']],
  ['/inventory/warehouses', ['inventory.warehouses']],
  ['/inventory/zones', ['inventory.warehouses']],
  ['/inventory/transfers', ['inventory.transfers']],
  ['/inventory/depreciation', ['inventory.waste']],
  ['/inventory', ['inventory.rolls', 'inventory.items']],
  ['/inventory-hub', ['inventory.rolls', 'inventory.items', 'inventory.warehouses', 'inventory.transfers', 'inventory.waste', 'inventory.yarn']],
  ['/purchases/import-excel', ['purchases.import']],
  ['/purchases/import-batches', ['purchases.import']],
  ['/purchases/intake-operations', ['inventory.rolls']],
  ['/purchases/external-job-matching', ['external.matching']],
  ['/purchases/external-jobs/processing', ['external.entry']],
  ['/purchases/external-jobs', ['external.jobs']],
  ['/cartela/custody', ['cartela.custody']],
  ['/cartela/delivery', ['cartela.custody']],
  ['/cartela', ['cartela']],
  ['/invoices/sales', ['sales.invoices']],
  ['/invoices/purchases', ['purchases.invoices']],
  ['/invoices/exchange', ['treasury.exchange']],
  ['/invoices/returns', ['sales.returns']],
  ['/invoices/statement', ['sales.invoices', 'purchases.invoices']],
  ['/orders', ['orders']],
  ['/customers', ['customers']],
  ['/suppliers', ['suppliers']],
  ['/treasury/checks-vault', ['treasury.checks']],
  ['/treasury/profit-details', ['finance.ledger']],
  ['/treasury', ['treasury.cashboxes']],
  ['/bonds', ['treasury.vouchers']],
  ['/expenses', ['finance.expenses']],
  ['/hr', ['hr.payroll', 'hr.attendance']],
  ['/salaries', ['hr.payroll']],
  ['/partners', ['partners']],
  ['/reports', ['reports']],
  ['/chart-of-accounts', ['finance.ledger']],
  ['/journal', ['finance.ledger']],
  ['/manufacturing', ['manufacturing.dashboard', 'manufacturing.reference', 'manufacturing.workorders', 'manufacturing.warping', 'manufacturing.sizing', 'manufacturing.weaving', 'manufacturing.quality', 'manufacturing.costing', 'manufacturing.reports']],
  ['/settings', ['system.settings', 'system.users']],
];

export function canSeePath(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null, path: string): boolean {
  if (!user || user.role === 'admin' || user.permMode !== 'CUSTOM') return true;
  const hit = PATH_MODULES.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  if (!hit) return true;
  const matrix = new Set(user.permMatrix ?? []);
  return hit[1].some((m) => matrix.has(`p:${m}.view`));
}

/** صفحات لا تتبع وحدة صلاحيات وتبقى متاحة لكل مستخدم (لها حمايتها الخاصة). */
const OPEN_PATHS = ['/', '/login', '/approvals-center', '/permissions', '/settings'];

/**
 * حارس المسار: للمستخدم بوضع «مخصّص» يُرفض كل مسار غير ممنوح، بما فيه المسارات غير المصنَّفة (رفض افتراضي)،
 * فلا يفتح بالرابط المباشر أو زر الرجوع أي صفحة لم تُمنح له. الخادم يرفض الإجراءات نفسها أيضاً.
 */
export function canAccessRoute(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null, path: string): boolean {
  if (!user || user.role === 'admin' || user.permMode !== 'CUSTOM') return true;
  if (OPEN_PATHS.some((p) => (p === '/' ? path === '/' : path === p || path.startsWith(p + '/')))) {
    // الإعدادات تبقى تتبع وحدتها إن وُجدت بالخريطة.
    return canSeePath(user, path);
  }
  const hit = PATH_MODULES.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  if (!hit) return false;
  return canSeePath(user, path);
}

/** هل يملك الحساب «عرض» وحدة بعينها؟ (مدير النظام ووضع الأدوار: نعم كالسابق؛ المخصّص: حسب المصفوفة). */
export function canViewModule(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null, moduleCode: string): boolean {
  if (!user || user.role === 'admin' || user.permMode !== 'CUSTOM') return true;
  return (user.permMatrix ?? []).includes(`p:${moduleCode}.view`);
}

/** مسارات تقارير مركز التقارير ← الوحدة التي تتبعها. */
const REPORT_PATH_MODULES: [string, string][] = [
  ['/payroll', 'hr.payroll'], ['/sales', 'sales.invoices'], ['/purchases', 'purchases.invoices'],
  ['/inventory', 'inventory.rolls'], ['/printing', 'inventory.rolls'], ['/customers', 'customers'], ['/parties', 'customers'],
  ['/suppliers', 'suppliers'], ['/financial', 'finance.ledger'],
];
export function canSeeReportPath(user: Pick<AuthUser, 'role' | 'permMode' | 'permMatrix'> | null, reportPath: string): boolean {
  const hit = REPORT_PATH_MODULES.find(([p]) => reportPath === p || reportPath.startsWith(p + '/'));
  return hit ? canViewModule(user, hit[1]) : true;
}
