import assert from 'node:assert/strict';
import { isoToDmy, maskDmyTyping, parseDmy, withinRange } from './dateInputFormat';

assert.equal(isoToDmy('2026-11-21'), '21/11/2026');
assert.equal(isoToDmy('2026-11-21T10:00:00Z'), '21/11/2026', 'تاريخ ISO بوقت');
assert.equal(isoToDmy(''), '');
assert.equal(isoToDmy(null), '');
assert.equal(isoToDmy('garbage'), '');

// الكتابة: فواصل تلقائية وأرقام فقط
assert.equal(maskDmyTyping('2'), '2');
assert.equal(maskDmyTyping('21'), '21');
assert.equal(maskDmyTyping('211'), '21/1');
assert.equal(maskDmyTyping('2111'), '21/11');
assert.equal(maskDmyTyping('211120'), '21/11/20');
assert.equal(maskDmyTyping('21112026'), '21/11/2026');
assert.equal(maskDmyTyping('21/11/2026999'), '21/11/2026', 'لا يزيد عن 8 أرقام');
assert.equal(maskDmyTyping('ab21-11-2026'), '21/11/2026', 'يتجاهل غير الأرقام');

// التحويل: يوم/شهر/سنة (لا شهر/يوم/سنة)
assert.equal(parseDmy('21/11/2026'), '2026-11-21');
assert.equal(parseDmy('05/03/2026'), '2026-03-05', '5 مارس لا 3 مايو');
assert.equal(parseDmy('3/4/2026'), '2026-04-03', 'خانة واحدة تُقبل');
assert.equal(parseDmy('21-11-2026'), '2026-11-21');
assert.equal(parseDmy('31/02/2026'), null);
assert.equal(parseDmy('29/02/2027'), null, 'ليست كبيسة');
assert.equal(parseDmy('29/02/2028'), '2028-02-29', 'كبيسة');
assert.equal(parseDmy('11/21/2026'), null, 'شهر 21 مرفوض: لا يُفسَّر بنظام شهر/يوم');
assert.equal(parseDmy('00/10/2026'), null);
assert.equal(parseDmy('21/11/26'), null, 'سنة من 4 أرقام');
assert.equal(parseDmy('21/11'), null);
assert.equal(parseDmy(''), null);

assert.equal(withinRange('2026-11-21', '2026-11-01', '2026-11-30'), true);
assert.equal(withinRange('2026-10-31', '2026-11-01'), false);
assert.equal(withinRange('2026-12-01', undefined, '2026-11-30'), false);
assert.equal(withinRange('2026-11-21'), true);
console.log('dateInputFormat tests passed');
