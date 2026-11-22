import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchEmployeeByName, normalizeArabicName } from './employeeNameMatch.js';

const E = [
  { id: '1', code: '187', name: 'هويدا طه إبراهيم' },
  { id: '2', code: '232', name: 'سعيد احمد سعيد مصطفى' },
  { id: '3', code: '301', name: 'محمد احمد سعيد مصطفى سليم' },
  { id: '4', code: '182', name: 'محمد عيد على متولى' },
  { id: '5', code: '326', name: 'احمد حسن عشرى' },
  { id: '6', code: '135', name: 'هيثم أحمد زكريا' },
  { id: '7', code: '220', name: 'عادل جلال سعد احمد' },
  { id: '8', code: '314', name: 'احمد سمير' },
  { id: '9', code: '315', name: 'احمد سمير علي' },
];

test('normalizeArabicName يوحّد الهمزات والياء والتاء المربوطة', () => {
  assert.equal(normalizeArabicName('  أحمد   عيسى '), 'احمد عيسي');
  assert.equal(normalizeArabicName('ذكريا'), normalizeArabicName('زكريا'));
});

test('بداية الاسم تطابق موظفاً واحداً', () => {
  const m = matchEmployeeByName('هويدا', E);
  assert.equal(m.kind, 'PREFIX');
  assert.equal(m.kind === 'PREFIX' && m.candidate.code, '187');
  const m2 = matchEmployeeByName('سعيد احمد سعيد', E);
  assert.equal(m2.kind === 'PREFIX' && m2.candidate.code, '232', 'لا يلتبس مع محمد احمد سعيد');
  const m3 = matchEmployeeByName('محمد عيد', E);
  assert.equal(m3.kind === 'PREFIX' && m3.candidate.code, '182');
});

test('ذ/ز يُطبَّعان؛ والتشابه الإملائي (حرف زائد/ناقص) FUZZY لا يُعتمد تلقائياً', () => {
  const z = matchEmployeeByName('هيثم ذكريا', E);
  assert.equal(z.kind, 'TOKENS');
  assert.equal(z.kind === 'TOKENS' && z.candidate.code, '135');
  const f = matchEmployeeByName('احمد حسن عشيرى', E);
  assert.equal(f.kind, 'FUZZY', 'عشيري/عشري: يحتاج تأكيداً');
  assert.equal(f.kind === 'FUZZY' && f.candidate.code, '326');
});

test('احمد ≠ محمد وعواد ≠ عماد: لا يُستبدل حرف أبداً', () => {
  const people = [{ id: 'a', code: '227', name: 'محمد عماد' }, { id: 'b', code: '9', name: 'محمد احمد' }];
  assert.equal(matchEmployeeByName('احمد عواد', people).kind, 'NONE');
  assert.equal(matchEmployeeByName('محمد عماد رجب', [{ id: 'c', code: '1', name: 'محمد عماد' }]).kind, 'NONE', 'الاسم الأطول لا يطابق اسماً مقطوعاً');
});

test('تطابق تام يُفضَّل على البداية، والملتبس لا يُخمَّن، وغير الموجود NONE', () => {
  const exact = matchEmployeeByName('احمد سمير', E);
  assert.equal(exact.kind, 'EXACT');
  assert.equal(exact.kind === 'EXACT' && exact.candidate.code, '314');
  assert.equal(matchEmployeeByName('عادل', [...E, { id: '10', code: '999', name: 'عادل فتحي' }]).kind, 'AMBIGUOUS');
  assert.equal(matchEmployeeByName('عطا شعبان', E).kind, 'NONE');
  assert.equal(matchEmployeeByName('', E).kind, 'NONE');
});
