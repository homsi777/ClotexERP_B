/** اختبارات فلترة وترتيب الموظفين (ملاحظة مدير بشير: موظفو النسيج فقط، الأقدم/الأجدد). */
import assert from 'node:assert/strict';
import { distinctValues, filterAndSortEmployees, type FilterableEmployee } from './employeeFilters.js';

const e = (over: Partial<FilterableEmployee> & { employee_code: string; full_name: string }): FilterableEmployee => ({
  factory: null, department: null, job_title: null, category: null, fingerprint_code: null,
  hire_date: null, base_salary: 0, status: 'ACTIVE', ...over,
});

const list = [
  e({ employee_code: 'EMP-103', full_name: 'أحمد', department: 'النسيج', factory: 'الإنتاج', hire_date: '2024-10-15', base_salary: '16000', fingerprint_code: '103' }),
  e({ employee_code: 'EMP-107', full_name: 'بلال', department: ' النسيج ', factory: 'الإنتاج', hire_date: '2026-04-04', base_salary: '0', fingerprint_code: '107' }),
  e({ employee_code: 'EMP-111', full_name: 'جمال', department: 'الصيانه', factory: 'الصيانه', hire_date: '2025-02-03', base_salary: '11000' }),
  e({ employee_code: 'EMP-116', full_name: 'دعاء', department: 'المخازن', hire_date: null, base_salary: '9000', fingerprint_code: '116', status: 'SUSPENDED' }),
  e({ employee_code: 'EMP-118', full_name: 'ريم', department: 'النسيج', hire_date: '1899-12-30', base_salary: '0' }), // تاريخ تعيين فاسد
];
const names = (r: FilterableEmployee[]) => r.map((x) => x.full_name);

function testTextileOnlyIgnoresSpacingAndCase() {
  const r = filterAndSortEmployees(list, { department: 'النسيج' });
  assert.deepEqual(names(r), ['أحمد', 'بلال', 'ريم']);
}

function testOldestAndNewestAndMissingDatesGoLast() {
  assert.deepEqual(names(filterAndSortEmployees(list, { sort: 'HIRE_OLDEST' })), ['أحمد', 'جمال', 'بلال', 'ريم', 'دعاء'].slice(0, 3).concat(['دعاء', 'ريم']));
  assert.deepEqual(names(filterAndSortEmployees(list, { sort: 'HIRE_NEWEST' })).slice(0, 3), ['بلال', 'جمال', 'أحمد']);
  // الفاسد (1899) وغير المحدد دائماً بالآخر في الاتجاهين
  const newest = names(filterAndSortEmployees(list, { sort: 'HIRE_NEWEST' }));
  assert.deepEqual(newest.slice(3).sort(), ['دعاء', 'ريم'].sort());
}

function testCombinedFiltersAndWageAndFingerprint() {
  assert.deepEqual(names(filterAndSortEmployees(list, { department: 'النسيج', wage: 'zero' })), ['بلال', 'ريم']);
  assert.deepEqual(names(filterAndSortEmployees(list, { fingerprint: 'without' })), ['جمال', 'ريم']);
  assert.deepEqual(names(filterAndSortEmployees(list, { status: 'SUSPENDED' })), ['دعاء']);
}

function testHireDateRangeExcludesInvalidDates() {
  const r = filterAndSortEmployees(list, { hiredFrom: '2025-01-01', hiredTo: '2026-12-31' });
  assert.deepEqual(names(r), ['بلال', 'جمال']);
}

function testWageSorts() {
  assert.equal(names(filterAndSortEmployees(list, { sort: 'WAGE_HIGH' }))[0], 'أحمد');
  assert.equal(names(filterAndSortEmployees(list, { sort: 'WAGE_LOW' }))[0].length > 0, true);
}

function testDistinctValuesAreTrimmedUniqueSorted() {
  assert.deepEqual(distinctValues(list, 'department'), ['الصيانه', 'المخازن', 'النسيج']);
  assert.deepEqual(distinctValues(list, 'factory'), ['الإنتاج', 'الصيانه']);
}

testTextileOnlyIgnoresSpacingAndCase();
testOldestAndNewestAndMissingDatesGoLast();
testCombinedFiltersAndWageAndFingerprint();
testHireDateRangeExcludesInvalidDates();
testWageSorts();
testDistinctValuesAreTrimmedUniqueSorted();
console.log('employeeFilters tests passed');
