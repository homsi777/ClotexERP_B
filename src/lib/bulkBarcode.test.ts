import assert from 'node:assert/strict';
import { classifyBulk, groupBulkRolls, parseBarcodeList } from './bulkBarcode';
import type { FabricRollDto } from './api/fabricRollsApi';

// التقطيع: أسطر/مسافات/فواصل/Tab، الأصفار البادئة محفوظة، المكرر يُكتشف
const p = parseBarcodeList('0001001\n0001002 , 0001003;\t0001001\r\n\r\n  9000001  ,,0001002');
assert.deepEqual(p.unique, ['0001001', '0001002', '0001003', '9000001']);
assert.equal(p.total, 6);
assert.deepEqual(p.duplicates, [{ barcode: '0001001', extra: 1 }, { barcode: '0001002', extra: 1 }]);
assert.equal(parseBarcodeList('').total, 0);

const roll = (barcode: string, over: Partial<FabricRollDto> = {}): FabricRollDto => ({
  id: barcode, company_id: 'c', roll_no: null, barcode, item_id: 'i', color_id: null, variant_id: null, supplier_id: null, warehouse_id: 'w',
  location_id: null, length_m: '50', width_cm: null, gsm: null, calculated_weight_kg: null, actual_weight_kg: '12', unit_cost: null, currency_code: null,
  batch_no: null, container_no: null, purchase_invoice_no: null, supplier_roll_ref: null, status: 'AVAILABLE', notes: null, created_at: '', updated_at: '',
  item_name: 'قماش أ', internal_code: 'A1', color_name_ar: 'أحمر', color_code: 'R1', ...over,
});

const rows = classifyBulk(parseBarcodeList('0001001 0001002 0001003 0001004 0001005 0001001 ZZZ'), [
  roll('0001001'), roll('0001002', { status: 'SOLD' }), roll('0001003', { entry_basis: 'WEIGHT', actual_weight_kg: '500' }), roll('0001004'), roll('0001005', { length_m: '20' }),
], {
  reject: (r) => (r.status === 'SOLD' ? 'مباع' : null),
  alreadyInDocument: (r) => r.barcode === '0001004',
});
const st = Object.fromEntries(rows.filter((r) => r.status !== 'DUPLICATE').map((r) => [r.barcode, r.status]));
assert.deepEqual(st, { '0001001': 'OK', '0001002': 'REJECTED', '0001003': 'OK', '0001004': 'IN_DOCUMENT', '0001005': 'OK', ZZZ: 'NOT_FOUND' });
assert.equal(rows.filter((r) => r.status === 'DUPLICATE').length, 1);

// التجميع: لا خلط بين الأمتار والكيلو، وأتواب الخامة/اللون المختلفة في مجموعات مستقلة
const g = groupBulkRolls([roll('1'), roll('2', { length_m: '30' }), roll('3', { entry_basis: 'WEIGHT', actual_weight_kg: '500' }), roll('4', { color_name_ar: 'أزرق', color_code: 'B1', length_m: '10' })]);
assert.equal(g.groups.length, 3);
assert.equal(g.totals.rolls, 4);
assert.equal(g.totals.meters, 90);
assert.equal(g.totals.kg, 500);
const kgGroup = g.groups.find((x) => x.unit === 'kg')!;
assert.equal(kgGroup.meters, 0);
assert.equal(kgGroup.kg, 500);
console.log('bulkBarcode ok');
