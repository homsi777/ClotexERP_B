/**
 * TASK 010 — اختبارات buildCurrencyStrips (دالة صِرفة، بلا قاعدة بيانات).
 * الأرقام من مثال بشير: 50,000 جنيه ÷ 50 = 1,000$.
 */
import assert from 'node:assert/strict';
import { buildCurrencyStrips, type CurrencyBalanceInput } from './currencySummary';

const egp: CurrencyBalanceInput = {
  currency: 'EGP',
  openingBalance: 0,
  totals: { debit: 60000, credit: 10000, closingBalance: 50000 },
};
const usd: CurrencyBalanceInput = {
  currency: 'USD',
  openingBalance: 0,
  totals: { debit: 300, credit: 0, closingBalance: 300 },
};
const rates = { EGP: 50, SYP: 15000 };

function testNoDisplayCurrencyKeepsEachCurrencySeparate() {
  const strips = buildCurrencyStrips([egp, usd], null, rates);
  assert.equal(strips.length, 2);
  assert.equal(strips[0].conversion, null);
  assert.equal(strips[0].closingBalance, 50000);
  assert.equal(strips[1].closingBalance, 300);
  assert.equal(strips.some((s) => s.missingRate), false);
}

function testConversionToUsdMatchesBashirExample() {
  const [egpStrip, usdStrip] = buildCurrencyStrips([egp, usd], 'USD', rates);
  assert.equal(egpStrip.closingBalance, 50000, 'القيمة الأصلية لا تتغير');
  assert.equal(egpStrip.conversion?.toCurrency, 'USD');
  assert.equal(egpStrip.conversion?.rate, 50);
  assert.equal(egpStrip.conversion?.converted, 1000);
  assert.equal(usdStrip.conversion, null, 'عملة تطابق عملة العرض تُعرض منفصلة بلا تحويل');
  assert.equal(usdStrip.closingBalance, 300, 'ولا تُجمع مع الجنيه');
}

function testCrossConversionGoesThroughUsd() {
  // 50,000 EGP = 1,000$ = 15,000,000 SYP؛ السعر الفعلي: 50 جنيه مقابل 15000 ليرة.
  const [strip] = buildCurrencyStrips([egp], 'SYP', rates);
  assert.equal(strip.conversion?.converted, 15_000_000);
  assert.equal(strip.conversion?.rate, 50 / 15000);
}

function testMissingRateIsFlaggedNotGuessed() {
  const [strip] = buildCurrencyStrips([egp], 'TRY', rates);
  assert.equal(strip.conversion, null);
  assert.equal(strip.missingRate, true);
  const [noRateForSource] = buildCurrencyStrips([{ ...egp, currency: 'TRY' }], 'USD', rates);
  assert.equal(noRateForSource.missingRate, true);
}

function testCreditBalanceKeepsSign() {
  const credit: CurrencyBalanceInput = { ...egp, totals: { debit: 0, credit: 5000, closingBalance: -5000 } };
  const [strip] = buildCurrencyStrips([credit], 'USD', rates);
  assert.equal(strip.conversion?.converted, -100);
}

testNoDisplayCurrencyKeepsEachCurrencySeparate();
testConversionToUsdMatchesBashirExample();
testCrossConversionGoesThroughUsd();
testMissingRateIsFlaggedNotGuessed();
testCreditBalanceKeepsSign();
console.log('currencySummary tests passed');
