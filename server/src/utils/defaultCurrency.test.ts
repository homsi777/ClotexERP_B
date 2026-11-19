/** اختبارات العملة الافتراضية لكل فرع (ملاحظة مدير بشير: الجنيه لفرع مصر). */
import assert from 'node:assert/strict';
import { effectiveDefaultCurrency, normalizeTransactionCurrency } from './defaultCurrency.js';

function testNormalizeAcceptsSupportedCaseInsensitive() {
  assert.equal(normalizeTransactionCurrency('egp'), 'EGP');
  assert.equal(normalizeTransactionCurrency(' EGP '), 'EGP');
  assert.equal(normalizeTransactionCurrency('usd'), 'USD');
  assert.equal(normalizeTransactionCurrency('TRY'), 'TRY');
  assert.equal(normalizeTransactionCurrency('syp'), 'SYP');
}

function testNormalizeRejectsUnknownAndEmpty() {
  for (const bad of ['EUR', 'GBP', '', '   ', null, undefined, 'جنيه', 'EG', 123]) {
    assert.equal(normalizeTransactionCurrency(bad), null, String(bad));
  }
}

function testEffectiveFallsBackToUsdForUnsetBranches() {
  // الفروع القديمة (سوريا/تركيا) بلا قيمة ⇒ USD كما كانت تماماً، فلا يتغير سلوكها بالنشر.
  assert.equal(effectiveDefaultCurrency(null), 'USD');
  assert.equal(effectiveDefaultCurrency(undefined), 'USD');
  assert.equal(effectiveDefaultCurrency('garbage'), 'USD');
  assert.equal(effectiveDefaultCurrency('EGP'), 'EGP');
}

testNormalizeAcceptsSupportedCaseInsensitive();
testNormalizeRejectsUnknownAndEmpty();
testEffectiveFallsBackToUsdForUnsetBranches();
console.log('defaultCurrency tests passed');
