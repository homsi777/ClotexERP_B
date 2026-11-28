import type { FabricRollDto } from './api/fabricRollsApi';

/**
 * إدخال الباركودات بالجملة (فاتورة البيع + إرسال المصنعية الخارجية).
 * دوال نقية بلا واجهة: التقطيع، اكتشاف المكرر، التصنيف، والتجميع بحسب الخامة/اللون/الوحدة.
 */

/** يفصل على الأسطر والمسافات والفواصل والفاصلة المنقوطة وTab، ويحافظ على النص كما هو (الأصفار البادئة). */
export function parseBarcodeList(text: string): {
  total: number;
  unique: string[];
  duplicates: Array<{ barcode: string; extra: number }>;
} {
  const tokens = String(text ?? '')
    .replace(/^﻿/, '')
    .split(/[\s,;،]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Map<string, number>();
  for (const tkn of tokens) seen.set(tkn, (seen.get(tkn) ?? 0) + 1);
  return {
    total: tokens.length,
    unique: [...seen.keys()],
    duplicates: [...seen.entries()].filter(([, n]) => n > 1).map(([barcode, n]) => ({ barcode, extra: n - 1 })),
  };
}

export type BulkRowStatus = 'OK' | 'DUPLICATE' | 'IN_DOCUMENT' | 'NOT_FOUND' | 'REJECTED';

export interface BulkRow {
  key: string;
  barcode: string;
  status: BulkRowStatus;
  /** سبب الرفض/التنبيه (أو ملاحظة غير مانعة للصالح). */
  reason: string;
  roll: FabricRollDto | null;
  /** عدد التكرارات الزائدة داخل القائمة (لصفوف DUPLICATE). */
  extra?: number;
}

export interface BulkRules {
  /** يعيد سبب الرفض النصي، أو null إن كان التوب صالحاً. */
  reject: (roll: FabricRollDto) => string | null;
  /** ملاحظة غير مانعة تظهر مع الصالح (اختياري). */
  note?: (roll: FabricRollDto) => string;
  /** هل التوب موجود مسبقاً داخل المستند الحالي؟ */
  alreadyInDocument: (roll: FabricRollDto) => boolean;
}

export function classifyBulk(
  parsed: ReturnType<typeof parseBarcodeList>,
  found: FabricRollDto[],
  rules: BulkRules,
): BulkRow[] {
  const byBarcode = new Map(found.map((r) => [r.barcode, r]));
  const rows: BulkRow[] = [];
  for (const barcode of parsed.unique) {
    const roll = byBarcode.get(barcode) ?? null;
    if (!roll) {
      rows.push({ key: barcode, barcode, status: 'NOT_FOUND', reason: 'غير موجود في النظام', roll: null });
      continue;
    }
    if (rules.alreadyInDocument(roll)) {
      rows.push({ key: barcode, barcode, status: 'IN_DOCUMENT', reason: 'موجود مسبقاً في المستند', roll });
      continue;
    }
    const why = rules.reject(roll);
    if (why) {
      rows.push({ key: barcode, barcode, status: 'REJECTED', reason: why, roll });
      continue;
    }
    rows.push({ key: barcode, barcode, status: 'OK', reason: rules.note?.(roll) ?? '', roll });
  }
  for (const d of parsed.duplicates) {
    rows.push({ key: `dup:${d.barcode}`, barcode: d.barcode, status: 'DUPLICATE', reason: `مكرر في القائمة (${d.extra} نسخة زائدة)`, roll: byBarcode.get(d.barcode) ?? null, extra: d.extra });
  }
  return rows;
}

export type RollUnit = 'm' | 'kg';
export const rollUnitOf = (r: Pick<FabricRollDto, 'entry_basis'>): RollUnit => (r.entry_basis === 'WEIGHT' ? 'kg' : 'm');

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
/** كمية التوب الرئيسية: كيلو للمُدخل بالوزن، وإلا أمتار. */
export const rollQty = (r: FabricRollDto): number => (rollUnitOf(r) === 'kg' ? num(r.actual_weight_kg ?? r.calculated_weight_kg) : num(r.length_m));

export interface BulkGroup {
  key: string;
  material: string;
  materialCode: string;
  colour: string;
  colourCode: string;
  unit: RollUnit;
  rolls: number;
  /** مجموع الأمتار (أتواب المتر فقط) — لا يُخلط بالكيلو. */
  meters: number;
  /** مجموع الكيلوغرامات (أتواب الوزن فقط). */
  kg: number;
}

/** تجميع الأتواب الصالحة بحسب الخامة + اللون + كود اللون + الوحدة، مع الإجمالي العام (أمتار وكيلو منفصلان). */
export function groupBulkRolls(rolls: FabricRollDto[]): { groups: BulkGroup[]; totals: { rolls: number; meters: number; kg: number } } {
  const map = new Map<string, BulkGroup>();
  const totals = { rolls: 0, meters: 0, kg: 0 };
  for (const r of rolls) {
    const unit = rollUnitOf(r);
    const material = (r.item_name ?? '').trim();
    const materialCode = (r.internal_code ?? '').trim();
    const colour = (r.color_name_ar ?? r.color_name_tr ?? '').trim();
    const colourCode = (r.color_code ?? '').trim();
    const key = [material, materialCode, colour, colourCode, unit].join('|');
    const g = map.get(key) ?? { key, material, materialCode, colour, colourCode, unit, rolls: 0, meters: 0, kg: 0 };
    g.rolls += 1;
    totals.rolls += 1;
    const q = rollQty(r);
    if (unit === 'kg') { g.kg += q; totals.kg += q; } else { g.meters += q; totals.meters += q; }
    map.set(key, g);
  }
  const groups = [...map.values()].sort((a, b) => a.material.localeCompare(b.material, 'ar') || a.colour.localeCompare(b.colour, 'ar') || a.colourCode.localeCompare(b.colourCode) || a.unit.localeCompare(b.unit));
  return { groups, totals };
}

/** أسباب الرفض القياسية لحالة التوب (مشتركة بين فاتورة البيع والمصنعية). */
export const ROLL_STATUS_REASON: Record<string, string> = {
  SOLD: 'مباع',
  INACTIVE: 'غير فعّال',
  DAMAGED: 'تالف',
  TRANSFERRED: 'منقول',
  AT_EXTERNAL_JOB: 'في مصنعية خارجية',
  RESERVED: 'محجوز',
};
