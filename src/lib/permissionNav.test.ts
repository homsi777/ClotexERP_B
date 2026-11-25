import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canAccessRoute, canSeePath, canSeeReportPath, canViewModule } from './permissionNav';

type U = Parameters<typeof canAccessRoute>[0];
const user = (matrix: string[]): U => ({ role: 'manager', permMode: 'CUSTOM', permMatrix: matrix });

// كل صفحات التطبيق الفعلية (من App.tsx) — أي صفحة جديدة بلا تصنيف تُكسر هذا الاختبار فيُحسم أمرها صراحةً.
const routes = [...readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').matchAll(/<Route path="([^"]+)"/g)].map((m) => (m[1].startsWith('/') ? m[1] : '/' + m[1])).filter((p) => p !== '/*' && p !== '/login');

const ALL_MODULES = ['purchases.receiving', 'management', 'dashboard', 'reports', 'customers', 'customers.balances', 'suppliers.balances', 'orders', 'sales.invoices', 'sales.returns', 'cartela', 'cartela.custody', 'suppliers', 'purchases.invoices', 'purchases.import', 'inventory.items', 'inventory.rolls', 'inventory.yarn', 'inventory.transfers', 'inventory.waste', 'inventory.warehouses', 'inventory.movements', 'treasury.cashboxes', 'treasury.vouchers', 'treasury.checks', 'treasury.exchange', 'finance.expenses', 'finance.ledger', 'hr.payroll', 'hr.attendance', 'manufacturing.dashboard', 'manufacturing.reference', 'external.jobs', 'external.entry', 'external.matching', 'partners', 'system.settings', 'system.users'];

test('every app page is either classified or explicitly open (no silent leaks)', () => {
  assert.ok(routes.length > 60, 'تم استخراج المسارات');
  const everything = user(ALL_MODULES.map((m) => `p:${m}.view`));
  const unclassified = routes.filter((p) => !canAccessRoute(everything, p.replace(/:[^/]+/g, 'x')));
  assert.deepEqual(unclassified, [], 'صفحات غير مصنَّفة تُرفض حتى لمن يملك كل الوحدات: صنّفها بـ PATH_MODULES');
});

test('account without HR never sees or opens any HR page', () => {
  const noHr = user(ALL_MODULES.filter((m) => !m.startsWith('hr.')).map((m) => `p:${m}.view`));
  for (const p of ['/hr', '/hr/employees', '/hr/attendance', '/hr/monthly-review', '/hr/annual-reports', '/salaries', '/salaries/log']) {
    assert.equal(canAccessRoute(noHr, p), false, p);
  }
  assert.equal(canAccessRoute(noHr, '/customers'), true);
  assert.equal(canSeeReportPath(noHr, '/payroll/employees'), false);
  assert.equal(canSeeReportPath(noHr, '/sales/summary'), true);
});

test('ungranted section never appears: only granted modules are reachable', () => {
  const onlySales = user(['p:sales.invoices.view', 'p:customers.view']);
  assert.equal(canAccessRoute(onlySales, '/invoices/sales'), true);
  for (const p of ['/treasury/safes', '/bonds/payment', '/expenses', '/manufacturing', '/inventory-hub', '/partners', '/reports', '/chart-of-accounts', '/journal', '/suppliers', '/hr']) {
    assert.equal(canAccessRoute(onlySales, p), false, p);
  }
  assert.equal(canAccessRoute(onlySales, '/some/unknown/new/page'), false, 'مسار مجهول = رفض افتراضي');
  assert.equal(canAccessRoute(onlySales, '/'), true);
  assert.equal(canViewModule(onlySales, 'hr.payroll'), false);
  // التقارير: لا ترى تقارير وحدة غير ممنوحة حتى لو مُنحت «التقارير»
  const reportsOnly = user(['p:reports.view']);
  for (const p of ['/sales/summary', '/inventory/balances', '/customers/summary', '/financial/cash-flow', '/payroll/summary', '/suppliers/aging']) assert.equal(canSeeReportPath(reportsOnly, p), false, p);
});

test('role mode and admin keep the previous behaviour', () => {
  assert.equal(canAccessRoute({ role: 'accountant', permMode: 'ROLE', permMatrix: [] }, '/hr'), true);
  assert.equal(canAccessRoute({ role: 'admin', permMode: 'CUSTOM', permMatrix: [] }, '/hr'), true);
  assert.equal(canSeePath(null, '/hr'), true);
});
