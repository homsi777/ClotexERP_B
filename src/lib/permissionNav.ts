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
  ['/purchases/intake-operations', ['inventory.rolls']],
  ['/purchases/external-job-matching', ['external.matching']],
  ['/purchases/external-jobs', ['external.jobs']],
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
