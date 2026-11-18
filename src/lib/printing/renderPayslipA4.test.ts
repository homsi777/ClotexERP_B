/** TASK 011 — صفوف بنود الراتب لكشف الراتب المطبوع: الإشارات والملاحظات والهروب من HTML. */
import assert from 'node:assert/strict';
import { payslipItemRows } from './payslipItems';

// التنسيق يتبع لغة الجهاز كباقي كشف الراتب — نحسب المتوقع بالدالة نفسها لنكون مستقلين عن اللغة.
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function testSignsAndNotes() {
  const html = payslipItemRows([
    { kind: 'BONUS', amount: 300 },
    { kind: 'PURCHASE_DEDUCTION', amount: 200, note: 'قماش' },
    { kind: 'SALARY_ADJUSTMENT', amount: 500, note: 'ترقية' },
  ]);
  assert.ok(html.includes('مكافأة') && html.includes('+' + fmt(300)));
  assert.ok(html.includes('خصم مشتريات') && html.includes('-' + fmt(200)) && html.includes('قماش'));
  assert.ok(html.includes('تعديل راتب') && html.includes('ترقية'));
}

function testNoItemsRendersNothing() {
  assert.equal(payslipItemRows([]), '');
  assert.equal(payslipItemRows(null), '');
}

function testNoteIsEscaped() {
  const html = payslipItemRows([{ kind: 'SETTLEMENT_ADD', amount: 1, note: '<script>x</script>' }]);
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
}

testSignsAndNotes();
testNoItemsRendersNothing();
testNoteIsEscaped();
console.log('renderPayslipA4 tests passed');
