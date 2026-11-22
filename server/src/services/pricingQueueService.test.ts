import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canApprove, canPrice, type JwtPayload } from '../middleware/auth.js';
import { maskMoneyRow, unpricedInvoiceBody } from './pricingQueueService.js';

const user = (over: Partial<JwtPayload>): JwtPayload => ({ sub: 'u', companyId: 'c', role: 'viewer', permissions: [], ...over }) as JwtPayload;

test('canPrice: المدير والمحاسب والمدير التشغيلي بالدور؛ غيرهم لا', () => {
  assert.equal(canPrice(user({ role: 'admin' }), 'sales.invoices'), true);
  assert.equal(canPrice(user({ role: 'accountant' }), 'sales.invoices'), true);
  assert.equal(canPrice(user({ role: 'manager' }), 'purchases.invoices'), true);
  assert.equal(canPrice(user({ role: 'inventory' }), 'sales.invoices'), false);
  assert.equal(canPrice(user({ role: 'viewer' }), 'purchases.invoices'), false);
  assert.equal(canPrice(undefined, 'sales.invoices'), false);
});

test('canPrice: بوضع المصفوفة بحسب «تسعير» أو «اعتماد» للوحدة نفسها فقط', () => {
  const base = { role: 'inventory', customPerms: true } as Partial<JwtPayload>;
  assert.equal(canPrice(user({ ...base, matrix: ['p:sales.invoices.view', 'p:sales.invoices.create'] }), 'sales.invoices'), false);
  assert.equal(canPrice(user({ ...base, matrix: ['p:sales.invoices.price'] }), 'sales.invoices'), true);
  assert.equal(canPrice(user({ ...base, matrix: ['p:purchases.invoices.approve'] }), 'purchases.invoices'), true);
  assert.equal(canPrice(user({ ...base, matrix: ['p:sales.invoices.price'] }), 'purchases.invoices'), false, 'لا تنتقل بين الوحدات');
});

test('maskMoneyRow يخفي الأعمدة المالية ويُبقي الكميات والأسماء', () => {
  const h = maskMoneyRow({ invoice_no: 'FB1', total_amount: '196.00', paid_amount: '10', remaining_amount: '186', payment_status: 'partial', customer_name: 'بركات' }, 'header');
  assert.equal(h.total_amount, 0);
  assert.equal(h.paid_amount, 0);
  assert.equal(h.remaining_amount, 0);
  assert.equal(h.payment_status, 'unpaid');
  assert.equal(h.invoice_no, 'FB1');
  assert.equal(h.customer_name, 'بركات');
  assert.equal(h.money_hidden, true);
  const l = maskMoneyRow({ quantity: '25', unit_price: '9', line_total: '225', unit_cost: '4' }, 'line');
  assert.equal(l.quantity, '25');
  assert.equal(l.unit_price, 0);
  assert.equal(l.line_total, 0);
  assert.equal(l.unit_cost, 0);
});

test('unpricedInvoiceBody يصفّر الأسعار والإجماليات ويبقي البضاعة', () => {
  const b = unpricedInvoiceBody({ confirm: false, customerId: 'x', totalAmount: 100, paidAmount: 50, lines: [{ description: 'قماش', quantity: 5, unitPrice: 20, lineTotal: 100 }] }) as {
    totalAmount: number; paidAmount: number; lines: { description: string; quantity: number; unitPrice: number; lineTotal: number }[];
  };
  assert.equal(b.totalAmount, 0);
  assert.equal(b.paidAmount, 0);
  assert.deepEqual(b.lines[0], { description: 'قماش', quantity: 5, unitPrice: 0, unitPriceUsd: 0, lineDiscount: 0, lineTax: 0, lineTotal: 0, lineDiscountUsd: 0, lineTaxUsd: 0, lineTotalUsd: 0 });
});

test('canApprove (الإهلاك المادي): المدير والمحاسب والمدير التشغيلي بالدور؛ بالمصفوفة «اعتماد» للوحدة فقط', () => {
  assert.equal(canApprove(user({ role: 'admin' }), 'inventory.waste'), true);
  assert.equal(canApprove(user({ role: 'accountant' }), 'inventory.waste'), true);
  assert.equal(canApprove(user({ role: 'manager' }), 'inventory.waste'), true);
  assert.equal(canApprove(user({ role: 'inventory' }), 'inventory.waste'), false, 'المخزن يحفظ مسودة فقط');
  assert.equal(canApprove(user({ role: 'viewer' }), 'inventory.waste'), false);
  const custom = { role: 'inventory', customPerms: true } as Partial<JwtPayload>;
  assert.equal(canApprove(user({ ...custom, matrix: ['p:inventory.waste.create', 'p:inventory.waste.view'] }), 'inventory.waste'), false);
  assert.equal(canApprove(user({ ...custom, matrix: ['p:inventory.waste.approve'] }), 'inventory.waste'), true);
  assert.equal(canApprove(user({ ...custom, matrix: ['p:inventory.waste.approve'] }), 'sales.invoices'), false, 'لا تنتقل بين الوحدات');
});
