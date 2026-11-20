import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  previewManufacturingSpecificationWorkbook,
  previewWarpCardTemplate,
} from './manufacturingSpecificationWorkbook.js';

function buildPortableFixture(): Buffer {
  const workbook = XLSX.utils.book_new();

  const workOrder = XLSX.utils.aoa_to_sheet([
    ['البيان', 'المواصفات'],
    ['نمرة السداء', '13/2'],
    ['العرض فى المشط', 170],
  ]);
  const warp = XLSX.utils.aoa_to_sheet([
    ['', '', 'المواصفة الفنية', '', '', '', 'ترتيب السداء'],
    ['', '', '', '', 6.5, 'نمرة السداء', '', 'اللون', 'عدد', 'تك', '', 'اللون', 'عدد', 'تك', '', 'اللون', 'العدد', 'تك'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'بيج', 2],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'زيتي', 3],
    ['اوزان السداء'],
    ['اجمالي الكمية', 'وزن اللون للألف', 'اجمالي فتل التكرار', 'اللون'],
    [10, 5, 2, 'بيج'],
    [20, 7, 3, 'زيتي'],
  ]);
  warp.P9 = { t: 'n', v: 0, f: '[1]السداء!T50' };
  warp.B8 = { t: 'n', v: 7, f: '1*0.59' };
  warp['!ref'] = 'A1:R9';

  const weft = XLSX.utils.aoa_to_sheet([
    ['', '', 'المواصفة الفنية', '', '', '', 'ترتيب اللحمه'],
    ['', '', '', '', 6.5, 'نمرة اللحمة', '', 'اللون', 'عدد', 'تك', '', 'اللون', 'عدد', 'تك', '', 'اللون', 'العدد', 'تك'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'كحلي', 4],
    ['اوزان اللحمه'],
    ['اجمالي الكمية بالكيلو', 'وزن اللون للألف', 'اجمالي فتل التكرار', 'اللون'],
    [30, 8, 4, 'كحلي'],
  ]);
  const draft = XLSX.utils.aoa_to_sheet([['التركيب النسجي'], [], ['اللقي']]);

  XLSX.utils.book_append_sheet(workbook, workOrder, 'امر الشغل');
  XLSX.utils.book_append_sheet(workbook, warp, 'امر السداء');
  XLSX.utils.book_append_sheet(workbook, weft, 'امر اللحمة');
  XLSX.utils.book_append_sheet(workbook, draft, 'التركيب واللقي');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

const portable = previewManufacturingSpecificationWorkbook(buildPortableFixture());
assert.equal(portable.sheets?.length,4);
assert.equal(portable.sheets?.find(s=>s.name==='امر السداء')?.cells.find(c=>c.address==='P9')?.formula,'[1]السداء!T50');
assert.equal(portable.sheets?.find(s=>s.name==='امر الشغل')?.cells.find(c=>c.address==='B2')?.value,'13/2');
assert.equal(portable.resolvedSheets.workOrder, 'امر الشغل');
assert.equal(portable.technicalFields['نمرة السداء'], '13/2');
assert.equal(portable.warp?.yarnCount, 6.5);
assert.deepEqual(portable.warp?.pattern.map((line) => [line.colorName, line.threadOrPickCount]), [['بيج', 2], ['زيتي', 3]]);
assert.equal(portable.warp?.requirements.length, 2);
assert.equal(portable.weft?.pattern[0]?.colorName, 'كحلي');
assert.equal(portable.warnings.some((warning) => warning.code === 'EXTERNAL_FORMULA_REFERENCE'), true);
assert.equal(portable.warnings.some((warning) => warning.code === 'SUSPICIOUS_COEFFICIENT'), true);
assert.equal(portable.warnings.some((warning) => warning.code === 'EMPTY_WEAVE_DRAFT'), true);
assert.equal(portable.warnings.some((warning) => warning.code === 'PATTERN_TOTAL_MISMATCH'), false);

const localReferenceCandidates = [
  path.resolve(process.cwd(), '2(2).xlsx'),
  path.resolve(process.cwd(), '..', 'clotex', '2(2).xlsx'),
];
const localReference = localReferenceCandidates.find((candidate) => fs.existsSync(candidate));
if (localReference) {
  const actual = previewManufacturingSpecificationWorkbook(fs.readFileSync(localReference));
  assert.deepEqual(actual.sheetNames, ['امر الشغل', 'امر اللحمة', 'امر السداء', 'التركيب واللقي']);
  assert.equal(actual.technicalFields['نمرة السداء'], '13/2');
  assert.equal(actual.warp?.pattern.length, 34);
  assert.equal(actual.weft?.pattern.length, 34);
  assert.equal(actual.warp?.requirements.length, 4);
  assert.equal(actual.weft?.requirements.length, 4);
  assert.equal(actual.warnings.filter((warning) => warning.code === 'EXTERNAL_FORMULA_REFERENCE').length, 8);
  assert.equal(actual.warnings.filter((warning) => warning.code === 'SUSPICIOUS_COEFFICIENT').length, 5);
  assert.equal(actual.warnings.filter((warning) => warning.code === 'PATTERN_TOTAL_MISMATCH').length, 4);
  assert.equal(actual.warnings.some((warning) => warning.code === 'EMPTY_WEAVE_DRAFT'), true);
}

const warpCardCandidates = [
  path.resolve(process.cwd(), 'كارت السداء.xlsx'),
  path.resolve(process.cwd(), '..', 'clotex', 'كارت السداء.xlsx'),
];
const warpCardReference = warpCardCandidates.find((candidate) => fs.existsSync(candidate));
if (warpCardReference) {
  const card = previewWarpCardTemplate(fs.readFileSync(warpCardReference));
  assert.equal(card.sheetName, 'Sheet1');
  assert.equal(card.logicalRecordCount, 1);
  assert.equal(card.printCopiesInTemplate, 2);
  assert.deepEqual(card.missingFields, []);
  assert.equal(card.fields.every((field) => field.occurrences.length === 2), true);
}

console.log('manufacturingSpecificationWorkbook tests passed');
