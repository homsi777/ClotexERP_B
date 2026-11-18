/** TASK 010 — اختبار renderCurrencyStripsHtml: المعادلة، عدم وجود إجمالي موحَّد، والهروب من HTML. */
import assert from 'node:assert/strict';
import { buildCurrencyStrips } from '../statements/currencySummary';
import { renderCurrencyStripsHtml, type CurrencyStripsLabels } from './currencyStripsHtml';

const labels: CurrencyStripsLabels = {
  title: 'ملخص',
  opening: 'افتتاحي',
  debit: 'مدين',
  credit: 'دائن',
  closing: 'ختامي',
  debitSide: 'مدين',
  creditSide: 'دائن',
  rateLine: (p) => `${p.amount} ${p.from} ÷ ${p.rate} = ${p.converted} ${p.to}`,
  missingRate: 'لا سعر',
  separateNote: 'منفصلة',
};
const entries = [
  { currency: 'EGP', openingBalance: 0, totals: { debit: 60000, credit: 10000, closingBalance: 50000 } },
  { currency: 'USD', openingBalance: 0, totals: { debit: 300, credit: 0, closingBalance: 300 } },
];

function testEmptyInputRendersNothing() {
  assert.equal(renderCurrencyStripsHtml([], labels, 'en'), '');
}

function testConversionLineAppearsOnlyForForeignCurrency() {
  const html = renderCurrencyStripsHtml(buildCurrencyStrips(entries, 'USD', { EGP: 50 }), labels, 'en');
  assert.ok(html.includes('50,000.00 EGP ÷ 50 = 1,000.00 USD'), 'معادلة بشير');
  assert.equal((html.match(/class="cs-conv"/g) ?? []).length, 1, 'سطر تحويل واحد فقط (EGP)');
  assert.equal((html.match(/class="cs-strip"/g) ?? []).length, 2, 'شريط لكل عملة');
}

function testNoConversionTwoStripsNoConversionLine() {
  const html = renderCurrencyStripsHtml(buildCurrencyStrips(entries, null, { EGP: 50 }), labels, 'en');
  assert.equal((html.match(/class="cs-strip"/g) ?? []).length, 2);
  assert.ok(!html.includes('class="cs-conv"'));
}

function testMissingRateShowsWarningNotNumbers() {
  const html = renderCurrencyStripsHtml(buildCurrencyStrips(entries, 'TRY', { EGP: 50 }), labels, 'en');
  assert.ok(html.includes('cs-warn'));
}

function testEscapesCurrencyText() {
  const html = renderCurrencyStripsHtml(
    buildCurrencyStrips([{ ...entries[0], currency: '<b>' }], null, {}),
    labels,
    'en',
  );
  assert.ok(!html.includes('<b>E') && html.includes('&lt;b&gt;'));
}

testEmptyInputRendersNothing();
testConversionLineAppearsOnlyForForeignCurrency();
testNoConversionTwoStripsNoConversionLine();
testMissingRateShowsWarningNotNumbers();
testEscapesCurrencyText();
console.log('currencyStripsHtml tests passed');
