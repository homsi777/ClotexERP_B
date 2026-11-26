import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { parseStockWorkbook, pickDefaultSheet } from './stockExcelImport.ts';

test('sheet named «مخزون» with barcode+item+color+length per roll is importable (not preview-only balance)', async () => {
  const aoa = [
    ['الباركود', 'الخامة', 'كود الخامة', 'اللوط', 'اللون', 'كود اللون', 'الكمية', 'الوحدة'],
    ['0001', 'اوكرانيا', 'ساده', '', 'بيج', 'B1', 71.5, 'متر'],
    ['0002', 'اوكرانيا', 'ساده', '', 'اصفر', 'Y1', 80, 'متر'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'مخزون مصر');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const file = { name: 'x.xlsx', size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  const preview = await parseStockWorkbook(file as unknown as File);
  const sheet = pickDefaultSheet(preview);
  assert.equal(sheet.kind, 'incoming');
  assert.equal(sheet.totalRows, 2);
  assert.equal(sheet.totalQuantity, 151.5);
});

test('real balance sheet (الوارد/الصادر/المخزن, no barcode) stays preview-only', async () => {
  const aoa = [['اسم الصنف', 'اللون', 'الوارد', 'الصادر', 'المخزن'], ['Eliza', 'ابيض', 200, 68, 132]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'مخزون');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const file = { name: 'y.xlsx', size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  const preview = await parseStockWorkbook(file as unknown as File);
  assert.equal(preview.sheets[0].kind, 'balance');
});
