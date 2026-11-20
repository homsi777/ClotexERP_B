import assert from 'node:assert/strict';
import { categoryNameKey, cleanCategoryName } from './expenseCategoryService';

// المسافات تُوحَّد
assert.equal(cleanCategoryName('  بنزين   السيارة  '), 'بنزين السيارة');
// الاختلافات الإملائية الشائعة تعطي المفتاح نفسه
const same = [
  ['إيجار ومرافق', 'ايجار ومرافق', 'أيجار ومرافق', 'إيجار  ومرافق'],
  ['صيانة', 'صِيَانَة', 'صيانــة'],
  ['ضيافة', 'ضيافه'],
  ['مصاريف إدارية عامة', 'مصاريف اداريه عامه', 'مصاريف إداريّة عامة'],
  ['على', 'علي'],
  ['مؤن', 'مون'],
];
for (const group of same) {
  const keys = new Set(group.map(categoryNameKey));
  assert.equal(keys.size, 1, `should be one key: ${group.join(' | ')}`);
}
// الأسماء المختلفة فعلاً تبقى مختلفة
assert.notEqual(categoryNameKey('نقل ومواصلات'), categoryNameKey('نقل'));
assert.notEqual(categoryNameKey('صيانة'), categoryNameKey('ضيافة'));
// اللاتينية لا تتأثر بحالة الأحرف ولا بالفواصل
assert.equal(categoryNameKey('Office Rent'), categoryNameKey('office-rent'));
// اسم فارغ/رموز فقط ⇒ مفتاح فارغ
assert.equal(categoryNameKey('  - .  '), '');
console.log('expenseCategory tests passed');
