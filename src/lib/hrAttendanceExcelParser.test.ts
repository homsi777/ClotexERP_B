/**
 * اختبارات محلّل ملف البصمة — حالات مستخرجة من ملفات أكتوبر/نوفمبر 2026 الفعلية:
 * صيغتا الملف، البصمة الفارغة، دمج وردية الليل، التاريخ الشاذ، وأوراق الراحة.
 */
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  excelFractionToTime,
  hoursBetween,
  parseAttendanceWorkbookData,
  reconcileDayEntries,
} from './hrAttendanceExcelParser';

const D = 46327; // 2026-11-01
const t = (h: number, m: number) => (h * 60 + m) / 1440;

/** صيغة "شيت الساعة - sewing": صف أرقام ثم صف عناوين ثم البيانات. */
function sewingSheet(dataRows: unknown[][]) {
  return XLSX.utils.aoa_to_sheet([
    [null, null, null, null, null, null, null, null, null, 1, 2],
    ['رقم البصمة', 'الاسم', 'التاريخ ', 'الحضور ', 'الانصراف', 'التاخير ', 'الاذن', 'اجمالى ساعات العمل '],
    ...dataRows,
  ]);
}

/** صيغة جهاز البصمة الخام: عناوين بالصف الأول، صف فارغ، ثم البيانات. */
function deviceSheet(dataRows: unknown[][]) {
  return XLSX.utils.aoa_to_sheet([
    ['AC-No.', 'Name', 'Date', 'Clock In', 'Clock Out', 'Late', 'Early', 'Absent OT Time Work Time'],
    [],
    ...dataRows,
  ]);
}

function wb(sheets: Record<string, XLSX.WorkSheet>): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name);
  return book;
}

function testBlankPunchIsNullNotMidnight() {
  assert.equal(excelFractionToTime(''), null);
  assert.equal(excelFractionToTime(undefined), null);
  assert.equal(excelFractionToTime(0.5), '12:00:00');
  assert.equal(excelFractionToTime(0), '00:00:00'); // رقم 0 فعلي = منتصف الليل صحيح، الفارغ ليس رقماً
}

function testDeviceFormatDetectedAndMissingPunchesMarkedIncomplete() {
  const r = parseAttendanceWorkbookData(
    wb({
      '1 11 2026': deviceSheet([
        [103, 'موظف أ', D, t(8, 9), t(16, 36)],
        [213, 'موظف ب', D, t(8, 8), ''], // انصراف ناقص (حالة ملف الجهاز الفعلية)
        [215, 'موظف ج', D, '', t(23, 34)], // حضور ناقص
      ]),
    }),
  );
  assert.equal(r.rows.length, 3);
  const full = r.rows.find((x) => x.fingerprintCode === '103')!;
  assert.equal(full.checkInTime, '08:09:00');
  assert.equal(full.totalHours, 8.45);
  assert.equal(full.incomplete, false);
  const noOut = r.rows.find((x) => x.fingerprintCode === '213')!;
  assert.equal(noOut.checkOutTime, null);
  assert.equal(noOut.totalHours, 0, 'لا ساعات مضخّمة من بصمة ناقصة');
  assert.equal(noOut.incomplete, true);
  assert.equal(r.rows.find((x) => x.fingerprintCode === '215')!.checkInTime, null);
  assert.equal(r.issues.incompleteRows, 2);
  assert.ok(!r.rows.some((x) => x.checkInTime === '00:00:00' || x.checkOutTime === '00:00:00'));
}

function testSewingFormatParsesSameShape() {
  const r = parseAttendanceWorkbookData(
    wb({ '26': sewingSheet([[103, 'أحمد', D, t(8, 2), t(16, 30)]]) }),
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].attendanceDate, '2026-11-01');
  assert.equal(r.rows[0].totalHours, 8.47);
  assert.equal(r.sheetsProcessed, 1);
}

function testNightShiftEchoRowIsMergedNotDuplicated() {
  // الصفّان الفعليان من الملف: "بلا حضور ← 07:44" (صدى انصراف الليلة السابقة) و"23:35 ← 07:40".
  const r = parseAttendanceWorkbookData(
    wb({
      '27': sewingSheet([
        [117, 'عامل ليلي', D, '', t(7, 44)],
        [117, 'عامل ليلي', D, t(23, 35), t(7, 40)],
      ]),
    }),
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].checkInTime, '23:35:00');
  assert.equal(r.rows[0].checkOutTime, '07:40:00');
  assert.equal(r.rows[0].totalHours, 8.08);
  assert.equal(r.rows[0].incomplete, false);
  assert.equal(r.issues.mergedDuplicates, 1);
}

function testTwoOutOnlyRowsMergeIntoOneIncomplete() {
  const merged = reconcileDayEntries([
    { code: '257', name: 'x', date: '2026-10-05', inT: null, outT: '23:37:00' },
    { code: '257', name: 'x', date: '2026-10-05', inT: null, outT: '23:48:00' },
  ]);
  assert.equal(merged.in, null);
  assert.equal(merged.out, '23:48:00');
  assert.equal(merged.merged, 1);
}

function testStaleDateRowsExcludedButNextDayTailsKept() {
  const stale = 45552; // 2024-09-17
  const r = parseAttendanceWorkbookData(
    wb({
      '11': sewingSheet([
        ...Array.from({ length: 20 }, (_, i) => [100 + i, `موظف ${i}`, D, t(8, 0), t(16, 0)]),
        [9011, 'Mashtol El Souk', stale, t(7, 45), ''],
        [9012, 'Nahda', stale, t(7, 20), ''],
        [301, 'ذيل ليلة سابقة', D - 1, '', t(7, 30)], // يوم واحد قبل: يبقى
      ]),
    }),
  );
  assert.equal(r.issues.excluded.length, 2);
  assert.ok(r.issues.excluded.every((e) => e.attendanceDate === '2024-09-17'));
  assert.ok(!r.rows.some((x) => x.attendanceDate === '2024-09-17'));
  assert.ok(r.rows.some((x) => x.fingerprintCode === '301'), 'فرق يوم واحد لا يُستبعد');
}

function testNoDominantDateKeepsEverything() {
  // ورقة شهر كاملة بتواريخ متعددة: لا تاريخ غالب ⇒ لا استبعاد.
  const r = parseAttendanceWorkbookData(
    wb({ all: deviceSheet(Array.from({ length: 10 }, (_, i) => [103, 'أ', D + i, t(8, 0), t(16, 0)])) }),
  );
  assert.equal(r.rows.length, 10);
  assert.equal(r.issues.excluded.length, 0);
}

function testRestDaySheetsAreEmptyNotErrors() {
  const r = parseAttendanceWorkbookData(
    wb({ '26': sewingSheet([[103, 'أ', D, t(8, 0), t(16, 0)]]), '30': sewingSheet([]) }),
  );
  assert.deepEqual(r.issues.emptySheets, ['30']);
  assert.deepEqual(r.issues.unreadableSheets, []);
  assert.equal(r.sheetsProcessed, 1);
}

function testUnknownLayoutSheetIsUnreadable() {
  const sheet = XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2], [3, 4], [5, 6]]);
  const r = parseAttendanceWorkbookData(wb({ weird: sheet }));
  assert.deepEqual(r.issues.unreadableSheets, ['weird']);
  assert.equal(r.rows.length, 0);
}

function testHoursBetweenOvernightAndDoubleShiftWarning() {
  assert.equal(hoursBetween('23:35:00', '07:40:00'), 8.08);
  assert.equal(hoursBetween(null, '07:40:00'), 0);
  const r = parseAttendanceWorkbookData(wb({ '5': sewingSheet([[367, 'مزدوج', D, t(7, 35), t(23, 40)]]) }));
  assert.equal(r.rows[0].totalHours, 16.08);
  assert.equal(r.issues.longShiftRows, 1, 'تُستورد لكن تُنبَّه');
}

testBlankPunchIsNullNotMidnight();
testDeviceFormatDetectedAndMissingPunchesMarkedIncomplete();
testSewingFormatParsesSameShape();
testNightShiftEchoRowIsMergedNotDuplicated();
testTwoOutOnlyRowsMergeIntoOneIncomplete();
testStaleDateRowsExcludedButNextDayTailsKept();
testNoDominantDateKeepsEverything();
testRestDaySheetsAreEmptyNotErrors();
testUnknownLayoutSheetIsUnreadable();
testHoursBetweenOvernightAndDoubleShiftWarning();
console.log('hrAttendanceExcelParser tests passed');
