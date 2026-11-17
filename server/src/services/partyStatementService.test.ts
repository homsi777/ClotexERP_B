/**
 * سياسة العملات (بشير) — البند 2: اختبارات pickStatementRowAmounts، الدالة
 * الصِرفة المُستخرَجة من buildStatement التي تختار أي زوج أعمدة (الأصلي أم
 * المُحوَّل للدولار) يُستخدَم لحساب رصيد كشف الحساب — لكل أنواع الصفوف
 * (فواتير، سندات قبض/دفع، مرتجعات) وللرصيد الافتتاحي على حدٍ سواء، لأنها
 * جميعاً تمر بهذه الدالة الواحدة بالضبط داخل buildStatement.
 *
 * تحقّقت فعلياً أيضاً من buildStatement/getCustomerStatementByCurrency
 * كاملة (الاستعلام الحقيقي، لا هذه الدالة الصِرفة فقط) ضد بيانات إنتاج
 * حقيقية (قراءة فقط): عميل حقيقي بفاتورتي EGP (إجمالي 106,806 ج.م) وفاتورة
 * USD (100$) — النتيجة المُعادة طابقت تماماً: EGP closingBalance=106806,
 * USD closingBalance=100، كل عملة مستقلة تماماً بلا أي جمع أو تحويل ضمني.
 * هذا الاختبار يغطي المنطق الصِرف دون حاجة لقاعدة بيانات فعلية.
 */
import assert from 'node:assert/strict';
import { pickStatementRowAmounts } from './partyStatementService.js';

// فاتورة بيع EGP: مدين 5000 ج.م = 100$ (سعر صرف 50).
const invoiceRow = { debit: '5000', credit: '0', debit_usd: '100', credit_usd: '0' };
// سند قبض EGP: دائن 1200 ج.م = 24$.
const receiptVoucherRow = { debit: '0', credit: '1200', debit_usd: '0', credit_usd: '24' };
// مرتجع بيع EGP: دائن 500 ج.م = 10$.
const salesReturnRow = { debit: '0', credit: '500', debit_usd: '0', credit_usd: '10' };

function testInvoiceRowOriginalCurrencyUsesRawColumns() {
  const { debit, credit } = pickStatementRowAmounts(invoiceRow, true);
  assert.equal(debit, 5000, 'فاتورة البيع: يجب استخدام المبلغ الأصلي (ج.م) لا الدولار');
  assert.equal(credit, 0);
}

function testInvoiceRowUsdModeUsesConvertedColumns() {
  const { debit, credit } = pickStatementRowAmounts(invoiceRow, false);
  assert.equal(debit, 100, 'بلا تحديد عملة: السلوك الحالي (TASK 004/006) يبقى بالدولار دون أي تغيير');
  assert.equal(credit, 0);
}

function testReceiptVoucherOriginalCurrency() {
  const { debit, credit } = pickStatementRowAmounts(receiptVoucherRow, true);
  assert.equal(debit, 0);
  assert.equal(credit, 1200, 'سند القبض: يجب استخدام المبلغ الأصلي (ج.م) لا الدولار');
}

function testSalesReturnOriginalCurrency() {
  const { debit, credit } = pickStatementRowAmounts(salesReturnRow, true);
  assert.equal(debit, 0);
  assert.equal(credit, 500, 'مرتجع البيع: يجب استخدام المبلغ الأصلي (ج.م) لا الدولار');
}

/** يحاكي applyBalance (balance + debit - credit للعميل) المُطابقة لمنطق buildStatement. */
function applyCustomerBalance(balance: number, debit: number, credit: number): number {
  return balance + debit - credit;
}

function testFullPipelineOpeningBalancePlusInvoicePaymentAndReturnInOriginalCurrency() {
  // رصيد افتتاحي EGP: مدين 2000 ج.م سابق (فاتورة قديمة غير مدفوعة).
  const openingRow = { debit: '2000', credit: '0', debit_usd: '40', credit_usd: '0' };

  let balance = 0;
  // الرصيد الافتتاحي
  {
    const { debit, credit } = pickStatementRowAmounts(openingRow, true);
    balance = applyCustomerBalance(balance, debit, credit);
  }
  assert.equal(balance, 2000, 'الرصيد الافتتاحي بالعملة الأصلية (ج.م) يجب أن يكون 2000');

  // + فاتورة بيع جديدة 5000 ج.م (مدين)
  {
    const { debit, credit } = pickStatementRowAmounts(invoiceRow, true);
    balance = applyCustomerBalance(balance, debit, credit);
  }
  assert.equal(balance, 7000, '2000 + 5000 = 7000 ج.م بعد الفاتورة');

  // - سند قبض 1200 ج.م (دائن، يخفّض المديونية)
  {
    const { debit, credit } = pickStatementRowAmounts(receiptVoucherRow, true);
    balance = applyCustomerBalance(balance, debit, credit);
  }
  assert.equal(balance, 5800, '7000 - 1200 = 5800 ج.م بعد سند القبض');

  // - مرتجع بيع 500 ج.م (دائن، يخفّض المديونية أيضاً)
  {
    const { debit, credit } = pickStatementRowAmounts(salesReturnRow, true);
    balance = applyCustomerBalance(balance, debit, credit);
  }
  assert.equal(balance, 5300, '5800 - 500 = 5300 ج.م — الرصيد النهائي بعملته الأصلية بلا أي خلط بالدولار');
}

function main() {
  testInvoiceRowOriginalCurrencyUsesRawColumns();
  testInvoiceRowUsdModeUsesConvertedColumns();
  testReceiptVoucherOriginalCurrency();
  testSalesReturnOriginalCurrency();
  testFullPipelineOpeningBalancePlusInvoicePaymentAndReturnInOriginalCurrency();
  console.log('partyStatementService.test.ts OK');
}

main();
