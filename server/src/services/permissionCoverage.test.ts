import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveRoutePolicy } from './permissionCatalog.js';
import { CUSTOM_OPEN_API_ROOTS } from '../middleware/auth.js';

// كل جذر API مسجَّل بالتطبيق يجب أن يتبع وحدة صلاحيات أو يكون ضمن الجذور المفتوحة صراحةً،
// وإلا يُرفض (رفض افتراضي) لمن بوضع «مخصّص». هذا الاختبار يمنع كسر مسار شرعي أو تسريب مسار جديد بصمت.
const registered = [...readFileSync(new URL('../app.ts', import.meta.url), 'utf8').matchAll(/app\.register\(\w+,\s*\{\s*prefix:\s*'([^']+)'/g)].map((m) => m[1]);

test('every registered API root is covered by a permission module or an explicit open root', () => {
  assert.ok(registered.length > 50);
  const uncovered = registered.filter((p) => {
    if (p === '/api') return false; // health
    if (CUSTOM_OPEN_API_ROOTS.some((r) => p === r || p.startsWith(r + '/'))) return false;
    return resolveRoutePolicy(p + '/x', 'GET') === null;
  });
  assert.deepEqual(uncovered, [], 'جذور بلا تصنيف: أضفها لوحدة بالكتالوج أو للجذور المفتوحة');
});

test('report families are gated by their own module, not only by "reports"', () => {
  const mod = (url: string) => resolveRoutePolicy(url, 'GET')?.module.code;
  assert.equal(mod('/api/reports/payroll/employees'), 'hr.payroll');
  assert.equal(mod('/api/reports/payroll-summary'), 'hr.payroll');
  assert.equal(mod('/api/reports/payroll/summary'), 'hr.payroll');
  assert.equal(mod('/api/reports/sales/summary'), 'sales.invoices');
  assert.equal(mod('/api/reports/purchases/details'), 'purchases.invoices');
  assert.equal(mod('/api/reports/inventory/balances'), 'inventory.rolls');
  assert.equal(mod('/api/reports/inventory-summary'), 'inventory.rolls');
  assert.equal(mod('/api/reports/customers/aging'), 'customers');
  assert.equal(mod('/api/reports/suppliers/aging'), 'suppliers');
  assert.equal(mod('/api/reports/financial/cash-flow'), 'finance.ledger');
  assert.equal(mod('/api/reports/cashbox-summary'), 'treasury.cashboxes');
  assert.equal(mod('/api/reports/vouchers-summary'), 'treasury.vouchers');
  assert.equal(mod('/api/reports/dashboard-summary'), 'reports');
  assert.equal(mod('/api/reports/executive/summary-report'), 'reports');
});

test('home dashboard summary is open to every account (masked per module), and invoices imply the lookups their forms need', async () => {
  const p = resolveRoutePolicy('/api/reports/dashboard-summary', 'GET');
  assert.equal(p?.open, true, 'اللوحة الرئيسية لا تتطلب وحدة «التقارير»؛ تُقلَّص حقولها حسب الوحدات الممنوحة');
  assert.equal(resolveRoutePolicy('/api/reports/payroll/summary', 'GET')?.open, false);
  const { expandImplied } = await import('./permissionCatalog.js');
  const implied = expandImplied(['p:sales.invoices.create']);
  for (const m of ['customers', 'inventory.items', 'inventory.rolls', 'inventory.warehouses']) assert.ok(implied.has(`p:${m}.view`), m);
  assert.ok(expandImplied(['p:purchases.invoices.create']).has('p:inventory.warehouses.view'));
  assert.ok(!implied.has('p:hr.payroll.view'));
});
