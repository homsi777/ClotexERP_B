/**
 * ملاحظة مدير بشير (تجربة فرع مصر): خانات السعر وإجمالي الفاتورة بالكشف كانت تُكتب بترميز USD ثابت
 * رغم أن الفاتورة بالجنيه. الآن تحمل كل سطر عملته الأصلية، ولا يُجمع الجنيه مع الدولار بالتذييل.
 */
import assert from 'node:assert/strict';
import {
  flattenAccountStatementDisplayRows,
  sumFabricAmountsByCurrency,
} from './customerStatementInvoiceDetails.js';

function testRowsCarryTheirOriginalCurrency() {
  const rows = flattenAccountStatementDisplayRows({
    openingBalance: 0,
    rows: [
      { date: '2026-11-15', documentNo: 'FB0000142', typeLabel: 'فاتورة بيع', debit: 2133.6, credit: 0, sourceType: 'SALES_INVOICE', sourceId: 'a', currency: 'EGP' },
      { date: '2026-11-17', documentNo: 'FB0000144', typeLabel: 'فاتورة بيع', debit: 100, credit: 0, sourceType: 'SALES_INVOICE', sourceId: 'b', currency: 'USD' },
      { date: '2026-11-18', documentNo: 'SQ000001', typeLabel: 'سند قبض', debit: 0, credit: 50, sourceType: 'RECEIPT_VOUCHER', currency: 'EGP' },
    ],
  });
  const byDoc = Object.fromEntries(rows.map((r) => [r.documentNo, r.currency]));
  assert.equal(byDoc['FB0000142'], 'EGP', 'فاتورة الجنيه تبقى EGP');
  assert.equal(byDoc['FB0000144'], 'USD');
  assert.equal(byDoc['SQ000001'], 'EGP', 'وكذلك سندات القبض');
}

function testFooterSumsPerCurrencyNeverMixes() {
  const totals = sumFabricAmountsByCurrency(
    [
      { fabric: { totalAmount: 106680 }, currency: 'EGP' },
      { fabric: { totalAmount: 126 }, currency: 'EGP' },
      { fabric: { totalAmount: 100 }, currency: 'USD' },
      { fabric: null, currency: 'EGP' }, // سطر بلا بنود لا يدخل
    ],
    'USD',
  );
  assert.deepEqual(totals, [
    { currency: 'EGP', total: 106806 },
    { currency: 'USD', total: 100 },
  ]);
}

function testMissingCurrencyFallsBackToStatementCurrency() {
  const totals = sumFabricAmountsByCurrency([{ fabric: { totalAmount: 5 } }, { fabric: { totalAmount: 7 }, currency: ' egp ' }], 'USD');
  assert.deepEqual(totals, [
    { currency: 'USD', total: 5 },
    { currency: 'EGP', total: 7 },
  ]);
}

testRowsCarryTheirOriginalCurrency();
testFooterSumsPerCurrencyNeverMixes();
testMissingCurrencyFallsBackToStatementCurrency();
console.log('customerStatementCurrency tests passed');
