import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FabricRollDto } from '../api/fabricRollsApi';
import { renderInventoryRollsThermal78, groupRollsByColor } from './renderInventoryRollsThermal78';
import { renderInventoryAuditSticker, variableColorCode } from './renderInventoryAuditSticker';
import { statementQuantity } from '../invoiceKgLine';
import { clampFontScale, loadInventoryPrintSettings, saveInventoryPrintSettings, DEFAULT_INVENTORY_PRINT_SETTINGS } from './inventoryPrintSettings';

const roll = (barcode: string, len: number, color: string, code: string, extra: Partial<FabricRollDto> = {}) =>
  ({ barcode, length_m: String(len), status: 'AVAILABLE', color_name_ar: color, color_code: code, actual_weight_kg: String(len / 3), warehouse_name: 'الرئيسي', item_name: 'ANDRIA', ...extra }) as unknown as FabricRollDto;
const rolls = [roll('000675', 70, 'خاكي', '0004-V-1'), roll('000678', 78, 'خاكي', '0004-V-1'), roll('000700', 50, 'خاكي', '0004-V-1'), roll('000801', 100, 'أسود', '0004-V-7')];

test('thermal statement: 72mm content on 78mm roll, two rolls per row, shaded totals only', () => {
  const { html, heightMm } = renderInventoryRollsThermal78({ rolls, searchQuery: '0004', warehouseLabel: 'الرئيسي' });
  assert.match(html, /@page \{ size: 78mm \d+mm; margin: 0; \}/);
  assert.match(html, /\.page\{width:72mm/);
  // خاكي: 3 أتواب = صفان (2+1)، أسود: 1 = صف واحد
  assert.equal((html.match(/class="row"/g) ?? []).length, 3);
  assert.equal((html.match(/class="cell"/g) ?? []).length + (html.match(/class="cell empty"/g) ?? []).length, 6);
  assert.ok(html.includes('000675') && html.includes('000678'), 'باركود التوب كرقم');
  assert.ok(!/<svg|<canvas|code128/i.test(html), 'لا رسم خطوط باركود');
  // التظليل على مجموع اللون والإجمالي العام فقط
  assert.match(html, /\.tot\{[^}]*background:#e4e4e4/); assert.match(html, /\.grand\{background:#d2d2d2/);
  assert.ok(!/\.(row|cell|m|bc)\{[^}]*background/.test(html), 'صفوف الأتواب بلا تظليل');
  assert.ok(html.includes('198.00') || html.includes('198,00') || html.includes('198.00 م'), 'مجموع خاكي 198');
  assert.ok(html.includes('298.00'), 'الإجمالي العام 298 م');
  assert.ok(heightMm > 60 && heightMm < 220, 'الطول يتبع المحتوى');
});

test('thermal statement: font scale changes the printed output (not just a preview) and is clamped', () => {
  const base = renderInventoryRollsThermal78({ rolls, fontScale: 1 });
  const big = renderInventoryRollsThermal78({ rolls, fontScale: 1.5 });
  assert.ok(big.heightMm > base.heightMm, 'التكبير يزيد ارتفاع الصفوف والمسافات');
  assert.match(base.html, /\.m\{font-size:16pt/); assert.match(big.html, /\.m\{font-size:24pt/);
  assert.equal(clampFontScale(0.2), 0.8); assert.equal(clampFontScale(5), 1.6); assert.equal(clampFontScale(1.04), 1);
  const tiny = renderInventoryRollsThermal78({ rolls, fontScale: 0.1 });
  assert.match(tiny.html, /\.m\{font-size:12\.8pt/, 'لا يصغَّر دون الحد المقروء');
  assert.match(big.html, /\.cell\{width:35mm/, 'يبقى توبان بالصف');
});

test('groupRollsByColor groups by color+code and sorts by barcode', () => {
  const g = groupRollsByColor([...rolls].reverse());
  assert.deepEqual(g.map((x) => [x.colorName, x.rows.length]), [['أسود', 1], ['خاكي', 3]]);
  assert.deepEqual(g[1].rows.map((r) => r.barcode), ['000675', '000678', '000700']);
});

test('inventory sticker: shows only the variable part of the color code and grows with colors', () => {
  assert.equal(variableColorCode('0004-V-8', '0004'), '-V-8');
  assert.equal(variableColorCode('V-8', '0004'), 'V-8');
  assert.equal(variableColorCode('0004', '0004'), '0004');
  const colors = [{ name: 'خاكي', code: '0004-V-1', meters: 1643 }, { name: 'كافيه', code: '0004-V-8', meters: 1585.81 }, { name: 'أسود', code: '0004-V-7', meters: 1011.3 }];
  const a = renderInventoryAuditSticker({ materialName: 'ANDRIA OXFORD', baseCode: '7201', cartelaCode: '0004', colors });
  assert.ok(a.html.includes('ANDRIA OXFORD') && a.html.includes('7201') && a.html.includes('>-V-8<') && a.html.includes('1,585.81'));
  assert.ok(!a.html.includes('>0004-V-8<'), 'لا تكرار لكود الكارتيلة');
  const b = renderInventoryAuditSticker({ materialName: 'X', baseCode: '1', cartelaCode: '0004', colors: colors.slice(0, 1) });
  assert.ok(a.heightMm > b.heightMm, 'الطول يتبع عدد الألوان');
});

test('print settings are saved per device and printer', () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  (globalThis as Record<string, unknown>).window = {};
  saveInventoryPrintSettings({ ...DEFAULT_INVENTORY_PRINT_SETTINGS, printerName: 'XP-323B', mode: 'THERMAL', thermalFontScale: 1.3 });
  assert.equal(loadInventoryPrintSettings().printerName, 'XP-323B', 'آخر طابعة مستخدمة افتراضية');
  assert.equal(loadInventoryPrintSettings('XP-323B').thermalFontScale, 1.3);
  assert.equal(loadInventoryPrintSettings('Other').thermalFontScale, 1, 'طابعة أخرى بإعداداتها');
  // جهاز آخر (تطبيق سطح المكتب) مستقل
  (globalThis as Record<string, unknown>).window = { fabricApp: { isElectron: true } };
  assert.equal(loadInventoryPrintSettings().mode, 'A4', 'إعدادات الكمبيوتر مستقلة عن المتصفح/الموبايل');
});

test('thermal summary: one line per color with roll count and totals, no individual rolls, shorter than detail', () => {
  const sum = renderInventoryRollsThermal78({ rolls, summary: true });
  const det = renderInventoryRollsThermal78({ rolls });
  assert.equal((sum.html.match(/class="srow"/g) ?? []).length, 2, 'سطر لكل لون');
  assert.ok(!sum.html.includes('000675') && !sum.html.includes('class="cell"'), 'بلا أتواب مفردة');
  assert.ok(sum.html.includes('198.00') && sum.html.includes('100.00') && sum.html.includes('298.00'), 'مجاميع الألوان والإجمالي');
  assert.match(sum.html, /<div class="sc">3<\/div>/, 'عدد أتواب خاكي');
  assert.match(sum.html, /كشف جرد ملخص/);
  assert.ok(sum.heightMm < det.heightMm);
});

test('invoice statement: kg lines show kilograms, never meters', () => {
  assert.deepEqual(statementQuantity({ quantity: 1000, unitType: 'kg' }), { meters: 0, kg: 1000 });
  const d = statementQuantity({ quantity: 1000, unitType: 'kg', widthCm: 150, gsm: 150 });
  assert.equal(d.kg, 1000); assert.equal(d.meters, 4444.44);
  assert.deepEqual(statementQuantity({ quantity: 80, unitType: 'meter', weightKg: 12 }), { meters: 80, kg: 12 });
});
