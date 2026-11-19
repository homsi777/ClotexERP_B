/** عهدة الكارتيلات: حساب الحالة والمدة وموعد الإرجاع، بمثال القبول من التاسك. */
import assert from 'node:assert/strict';
import { addDaysYmd, computeCustody, diffDays, resolveDueDate } from './cartelaCustodyMath.js';

// مثال القبول: تسليم 19/11 ثلاث نسخ (اثنتان بلا مدة، الثالثة 7 أيام ⇒ 26/11)، إرجاع إحدى المفتوحتين 22/11، الفحص 27/11
const D = '2026-11-19';
assert.equal(resolveDueDate(D, { days: 7 }), '2026-11-26');
assert.equal(resolveDueDate(D, {}), null);
assert.equal(resolveDueDate(D, { dueDate: '2026-12-01', days: 3 }), '2026-12-01', 'التاريخ المباشر يغلب عدد الأيام');

const today = '2026-11-27';
const noDueReturned = computeCustody({ deliveredOn: D, dueDate: null, returnedOn: '2026-11-22' }, today);
assert.equal(noDueReturned.status, 'RETURNED');
assert.equal(noDueReturned.daysHeld, 3, 'من التسليم حتى الإرجاع الفعلي');

const noDueOpen = computeCustody({ deliveredOn: D, dueDate: null, returnedOn: null }, today);
assert.equal(noDueOpen.status, 'HELD');
assert.equal(noDueOpen.dueUndefined, true);
assert.equal(noDueOpen.daysLate, 0, 'بلا موعد: تُستبعد من المتأخرات');
assert.equal(noDueOpen.daysHeld, 8);

const late = computeCustody({ deliveredOn: D, dueDate: '2026-11-26', returnedOn: null }, today);
assert.equal(late.status, 'LATE');
assert.equal(late.daysLate, 1, 'يوم تأخير واحد ابتداءً من اليوم التالي للموعد');

// يوم الموعد نفسه ليس متأخراً
assert.equal(computeCustody({ deliveredOn: D, dueDate: '2026-11-26', returnedOn: null }, '2026-11-26').status, 'HELD');
assert.equal(computeCustody({ deliveredOn: D, dueDate: '2026-11-26', returnedOn: null }, '2026-11-26').daysLate, 0);

// تحقق التواريخ
assert.throws(() => resolveDueDate(D, { dueDate: '2026-11-18' }), /قبل تاريخ التسليم/);
assert.throws(() => resolveDueDate(D, { days: 0 }), /موجباً/);
assert.equal(diffDays('2026-02-28', '2026-03-01'), 1);
assert.equal(addDaysYmd('2026-12-30', 3), '2027-01-02');

console.log('cartelaCustodyMath tests passed');
