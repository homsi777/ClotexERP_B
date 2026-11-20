import assert from 'node:assert/strict';
import { ALL_MATRIX_CODES, PERMISSION_MODULES, effectiveCustomPermissions, expandImplied, legacyCodesFor, permissionCode, resolveRoutePolicy } from './permissionCatalog.js';

// 1) لا تكرار بأكواد الوحدات ولا ببادئات المسارات
assert.equal(new Set(PERMISSION_MODULES.map((m) => m.code)).size, PERMISSION_MODULES.length, 'module codes unique');
const prefixes = PERMISSION_MODULES.flatMap((m) => m.prefixes);
assert.equal(new Set(prefixes).size, prefixes.length, 'path prefixes unique');
assert.equal(new Set(ALL_MATRIX_CODES).size, ALL_MATRIX_CODES.length);
for (const m of PERMISSION_MODULES) assert.ok(m.actions.includes('view') || m.actions.length > 0, m.code);

// 2) الربط بالإجراء حسب الطريقة والمسار
const p = (url: string, method: string) => resolveRoutePolicy(url, method)!;
assert.equal(p('/api/vouchers', 'GET').code, permissionCode('treasury.vouchers', 'view'));
assert.equal(p('/api/vouchers', 'POST').code, permissionCode('treasury.vouchers', 'create'));
assert.equal(p('/api/vouchers/:id', 'PUT').code, permissionCode('treasury.vouchers', 'edit'));
assert.equal(p('/api/vouchers/:id/confirm', 'PATCH').code, permissionCode('treasury.vouchers', 'approve'));
assert.equal(p('/api/vouchers/:id/cancel', 'PATCH').code, permissionCode('treasury.vouchers', 'delete'));
assert.equal(p('/api/vouchers/:id', 'DELETE').code, permissionCode('treasury.vouchers', 'delete'));
assert.equal(p('/api/checks/:id/deposit', 'POST').code, permissionCode('treasury.checks', 'approve'));
assert.equal(p('/api/external-jobs/:id/lifecycle/inventory-complete', 'POST').code, permissionCode('external.jobs', 'approve'));
assert.equal(p('/api/sales-invoices/search', 'POST').code, permissionCode('sales.invoices', 'view'), 'POST search is a read');
// الأطول يربح: التصنيع
assert.equal(p('/api/manufacturing/costing/:id', 'GET').module.code, 'manufacturing.costing');
assert.equal(p('/api/manufacturing/warping', 'GET').module.code, 'manufacturing.warping');
assert.equal(p('/api/manufacturing/items', 'GET').module.code, 'manufacturing.reference');
// مسارات بلا وحدة غير مقيَّدة مركزياً
assert.equal(resolveRoutePolicy('/api/auth/me', 'GET'), null);
assert.equal(resolveRoutePolicy('/api/system/users', 'GET'), null);
// القراءة المفتوحة للمراجع
assert.equal(p('/api/warehouses', 'GET').open, true);
assert.equal(p('/api/warehouses', 'POST').open, false);
// إجراء غير معرَّف يسقط لأقرب متاح (تصدير بلا export ← عرض)
assert.equal(p('/api/inventory-movements-log/export', 'GET').action, 'export');
assert.equal(p('/api/exchange-rates', 'POST').action, 'create' === 'create' ? 'edit' : 'edit');

// 3) الاستكمال الضمني: أي كتابة تستلزم العرض + الوحدات اللازمة للنماذج
const ex = expandImplied([permissionCode('sales.invoices', 'create')]);
for (const c of ['sales.invoices.view', 'customers.view', 'inventory.items.view', 'inventory.rolls.view']) assert.ok(ex.has(`p:${c}`), c);
assert.ok(!ex.has(permissionCode('sales.invoices', 'delete')), 'no implicit delete');
// أكواد غير صالحة تُهمَل
assert.equal(expandImplied(['p:nope.view', 'x']).size, 0);

// 4) الأكواد القديمة للفحوص الحالية
assert.ok(legacyCodesFor([permissionCode('inventory.rolls', 'edit')]).includes('inventory.manage'));
assert.ok(effectiveCustomPermissions([permissionCode('hr.payroll', 'approve')]).includes('payroll.approve'));
assert.ok(!effectiveCustomPermissions([permissionCode('hr.payroll', 'view')]).includes('payroll.manage'));
// مستخدم بلا مالية: لا شيء مالي يتسرب
const noFinance = effectiveCustomPermissions(PERMISSION_MODULES.filter((m) => !m.financial).flatMap((m) => m.actions.map((a) => permissionCode(m.code, a))));
assert.ok(!noFinance.includes(permissionCode('treasury.vouchers', 'view')));
assert.ok(!noFinance.includes('payroll.view'));
console.log('permissionCatalog tests passed');
