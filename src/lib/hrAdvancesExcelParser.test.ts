import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseOctoberAdvancesWorkbook, parseScheduledAdvancesWorkbook, serialToIso } from './hrAdvancesExcelParser';

assert.equal(serialToIso(46023), '2026-01-01');
assert.equal(serialToIso(46388), '2027-01-01');
assert.equal(serialToIso('x'), null);

// ---- سلف الشهر
{
  const ws = XLSX.utils.aoa_to_sheet([
    [],
    ['الكود', 'الاسم', 'الاجر الشامل ', 'قيمه 40%', 'قيمه السلفه 40 %', 'التوقيع'],
    [128, 'محمد', 26000, 10400, null],
    [103, 'احمد ربيع', 12000, 4800, 2000],
    [null, 'كفر حمزة', null, null, 30000],
    [null, null, 'الاجمالى', null, 32000],
  ]);
  const wb = { SheetNames: ['S'], Sheets: { S: ws } } as XLSX.WorkBook;
  const r = parseOctoberAdvancesWorkbook(wb, '2026-10-31');
  assert.equal(r.rows.length, 2, 'صف بلا سلفة وصف الإجمالي لا يدخلان');
  assert.equal(r.rows[0].code, '103');
  assert.equal(r.rows[0].amount, 2000);
  assert.equal(r.rows[0].comprehensiveWage, 12000);
  assert.equal(r.rows[1].suspicious, true, 'صف بلا كود يُعلَّم مشبوهاً');
  assert.equal(r.skippedRows.length, 1);
}

// ---- السلف المقسطة
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['م', 'الاسم', null, 'القيمه', 'مده السداد بالشهور', 'تاريخ السلفه', 'تاريخ السلفه', 'فبراير', 'مارس', 'أبريل', 46388, 'ملاحظات'],
    [1, 'هويدا', null, 5000, 3, 46064, null, 1000, 2000, 2000, null, null],
    [2, 'عبداللطيف', null, 6000, 2, 'يناير وتم الترحيل', null, 3000, 3000, null, null, null],
    [3, 'احمد شمس', null, 15000, 5, null, null, null, null, null, null, null],
    [4, 'عادل', null, 7000, 3, 46266, null, null, null, null, 2333.33, 'تم رد الخصم'],
  ]);
  const wb = { SheetNames: ['sched'], Sheets: { sched: ws } } as XLSX.WorkBook;
  const r = parseScheduledAdvancesWorkbook(wb, '2026-11-21');
  assert.equal(r.baseYear, 2026);
  assert.equal(r.rows.length, 4);
  const a = r.rows[0];
  assert.equal(a.advanceDate, '2026-02-11');
  assert.deepEqual(a.installments, [
    { month: 2, year: 2026, amount: 1000 },
    { month: 3, year: 2026, amount: 2000 },
    { month: 4, year: 2026, amount: 2000 },
  ]);
  assert.equal(a.warnings.length, 0);
  const b = r.rows[1];
  assert.equal(b.advanceDate, '2026-01-01');
  assert.equal(b.dateIsEstimated, true, 'تاريخ نصي = تقديري');
  assert.equal(b.warnings.length, 0, 'مجموع الأقساط 6000 = القيمة وعددها = المدة');
  assert.ok(r.rows[0].installments.length === 3 && !r.rows[0].warnings.length);
  const c = r.rows[2];
  assert.equal(c.installments.length, 0);
  assert.ok(c.warnings.some((w) => w.includes('لا يوجد جدول')));
  assert.equal(c.advanceDate, '2026-11-21');
  const d = r.rows[3];
  assert.deepEqual(d.installments, [{ month: 1, year: 2027, amount: 2333.33 }], 'عمود برقم تسلسلي = يناير 2027');
}

// ---- الملفان الفعليان (إن وُجدا بالجهاز)
const dir = new URL('../../ملفات اكسل/', import.meta.url);
const oct = new URL('سلف اكتوبر.xlsx', dir);
const sched = new URL('السلف المقسطه.xlsx', dir);
if (existsSync(oct) && existsSync(sched)) {
  const o = parseOctoberAdvancesWorkbook(XLSX.read(readFileSync(oct)), '2026-10-31');
  assert.equal(o.rows.filter((x) => x.code).length, 68);
  assert.equal(Math.round(o.rows.reduce((s, x) => s + x.amount, 0)), 349700, 'يطابق الإجمالي المكتوب بالملف');
  assert.equal(o.rows.filter((x) => x.suspicious).length, 5);
  const s = parseScheduledAdvancesWorkbook(XLSX.read(readFileSync(sched)), '2026-11-21');
  assert.equal(s.rows.length, 25);
  assert.equal(s.baseYear, 2026);
}
console.log('hrAdvancesExcelParser tests passed');
