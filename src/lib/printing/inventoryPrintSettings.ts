/**
 * إعدادات طباعة كشف الجرد/الاستعلام عن الخامة — تُحفظ لكل جهاز وطابعة على حدة (الموبايل مستقل عن الكمبيوتر)،
 * فيبقى آخر ما استُخدم افتراضياً حتى يغيّره المستخدم ولا يُسأل عنه في كل مرة.
 */
export type InventoryPrintMode = 'A4' | 'THERMAL';
export interface InventoryPrintSettings {
  mode: InventoryPrintMode;
  printerName: string;
  /** مقاس الكشف: A4 أفقي (الافتراضي) أو عمودي. */
  a4Orientation: 'landscape' | 'portrait';
  /** عرض رول الحراري بالمليمتر (7.8 سم) والمحتوى الفعلي ضمن 72 مم. */
  rollWidthMm: number;
  /** معامل حجم الخط الحراري (1 = الافتراضي)؛ يُطبَّق على المطبوع فعلاً لا على المعاينة فقط. */
  thermalFontScale: number;
  /** عرض الستيكر بالمليمتر (الطول يتبع عدد الألوان). */
  stickerWidthMm: number;
}

export const DEFAULT_INVENTORY_PRINT_SETTINGS: InventoryPrintSettings = {
  mode: 'A4', printerName: '', a4Orientation: 'landscape', rollWidthMm: 78, thermalFontScale: 1, stickerWidthMm: 72,
};
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.6;
export const FONT_SCALE_STEP = 0.1;
export const clampFontScale = (v: number) => Math.round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v)) * 10) / 10;

/** معرّف الجهاز: يفصل الموبايل عن الكمبيوتر وعن تطبيق سطح المكتب. */
export function inventoryPrintDeviceKey(): string {
  if (typeof window === 'undefined') return 'server';
  if (window.fabricApp?.isElectron) return 'desktop-app';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ? 'mobile' : 'desktop-browser';
}

const LAST_PRINTER_PREFIX = 'clotex.invPrint.lastPrinter.';
const key = (device: string, printer: string) => `clotex.invPrint.${device}.${printer || 'default'}`;

function read(k: string): Partial<InventoryPrintSettings> | null {
  try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as Partial<InventoryPrintSettings>) : null; } catch { return null; }
}

/** يحمّل إعدادات الجهاز: لآخر طابعة استُخدمت، أو لطابعة محددة. */
export function loadInventoryPrintSettings(printerName?: string): InventoryPrintSettings {
  const device = inventoryPrintDeviceKey();
  let printer = printerName;
  if (printer === undefined) { try { printer = localStorage.getItem(LAST_PRINTER_PREFIX + device) ?? ''; } catch { printer = ''; } }
  const saved = read(key(device, printer ?? '')) ?? {};
  const merged = { ...DEFAULT_INVENTORY_PRINT_SETTINGS, ...saved, printerName: printer ?? '' };
  merged.thermalFontScale = clampFontScale(Number(merged.thermalFontScale) || 1);
  return merged;
}

export function saveInventoryPrintSettings(s: InventoryPrintSettings): void {
  const device = inventoryPrintDeviceKey();
  try {
    localStorage.setItem(key(device, s.printerName), JSON.stringify(s));
    localStorage.setItem(LAST_PRINTER_PREFIX + device, s.printerName);
  } catch { /* التخزين غير متاح: تبقى الإعدادات للجلسة فقط */ }
}
