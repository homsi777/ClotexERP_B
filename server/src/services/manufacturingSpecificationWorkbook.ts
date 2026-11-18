import * as XLSX from 'xlsx';

export const MANUFACTURING_WORKBOOK_SHEETS = {
  workOrder: 'أمر الشغل',
  warpOrder: 'أمر السداء',
  weftOrder: 'أمر اللحمة',
  weaveDraft: 'التركيب واللقي',
} as const;

export type ManufacturingSheetRole = keyof typeof MANUFACTURING_WORKBOOK_SHEETS;

export interface WorkbookFormulaReference {
  sheet: string;
  cell: string;
  formula: string;
  cachedValue: string | number | boolean | null;
  external: boolean;
}

export interface ManufacturingPatternLine {
  sequenceNo: number;
  sourceCell: string;
  colorName: string;
  threadOrPickCount: number;
  repeatCount: number | null;
}

export interface ManufacturingYarnRequirementReference {
  colorName: string;
  patternCount: number;
  weightPerThousandMeters: number;
  requiredWeightKg: number;
}

export interface ManufacturingOrderSheetReference {
  yarnCount: string | number | boolean | null;
  pattern: ManufacturingPatternLine[];
  requirements: ManufacturingYarnRequirementReference[];
}

export type ManufacturingWorkbookWarningCode =
  | 'MISSING_REQUIRED_SHEET'
  | 'EXTERNAL_FORMULA_REFERENCE'
  | 'SUSPICIOUS_COEFFICIENT'
  | 'EMPTY_WEAVE_DRAFT'
  | 'PATTERN_TOTAL_MISMATCH';

export interface ManufacturingWorkbookWarning {
  code: ManufacturingWorkbookWarningCode;
  message: string;
  sheet?: string;
  cell?: string;
}

export interface ManufacturingSpecificationWorkbookPreview {
  sheetNames: string[];
  resolvedSheets: Partial<Record<ManufacturingSheetRole, string>>;
  technicalFields: Record<string, string | number | boolean>;
  warp: ManufacturingOrderSheetReference | null;
  weft: ManufacturingOrderSheetReference | null;
  weaveDraft: {
    range: string | null;
    populatedCells: number;
    styledCells: number;
    merges: number;
  } | null;
  formulas: WorkbookFormulaReference[];
  warnings: ManufacturingWorkbookWarning[];
}

export const WARP_CARD_FIELD_LABELS = [
  'رقم الصنف',
  'المرياج',
  'الطول',
  'النول',
  'التاريخ',
  'عرض مشط النسيج',
  'اجمالي عدد الخيوط',
  'عدد الاربطه',
  'نمرة السداء',
  'اسم المسدي',
  'الوردية',
] as const;

export interface WarpCardTemplatePreview {
  sheetName: string;
  range: string | null;
  logicalRecordCount: 1;
  printCopiesInTemplate: number;
  fields: Array<{ label: string; occurrences: string[] }>;
  missingFields: string[];
}

const normalizeArabicLabel = (value: unknown): string => String(value ?? '')
  .trim()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي')
  .replace(/[ًٌٍَُِّْـ]/g, '')
  .replace(/[\s/_\\"':-]+/g, '');

const normalizeSheetName = (value: string): string => normalizeArabicLabel(value);

const toDisplayValue = (cell: XLSX.CellObject | undefined): string | number | boolean | null => {
  if (!cell || cell.v === null || cell.v === undefined || cell.v === '') return null;
  if (typeof cell.v === 'string' || typeof cell.v === 'number' || typeof cell.v === 'boolean') return cell.v;
  return String(cell.v);
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

function findSheetName(workbook: XLSX.WorkBook, expectedName: string): string | undefined {
  const expected = normalizeSheetName(expectedName);
  return workbook.SheetNames.find((name) => normalizeSheetName(name) === expected);
}

function readTechnicalFields(sheet: XLSX.WorkSheet | undefined): Record<string, string | number | boolean> {
  if (!sheet?.['!ref']) return {};
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const fields: Record<string, string | number | boolean> = {};

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const labelCell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    const valueCell = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
    const label = String(labelCell?.v ?? '').trim();
    const value = toDisplayValue(valueCell);
    if (label && value !== null) fields[label] = value;
  }

  return fields;
}

function readPattern(sheet: XLSX.WorkSheet): ManufacturingPatternLine[] {
  if (!sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const pattern: ManufacturingPatternLine[] = [];
  const groups = [
    { color: 7, count: 8, repeat: 9 },
    { color: 11, count: 12, repeat: 13 },
    { color: 15, count: 16, repeat: 17 },
  ];

  let sequenceNo = 1;
  for (let row = Math.max(range.s.r, 2); row <= range.e.r; row += 1) {
    const sectionLabel = normalizeArabicLabel(sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v);
    if (sectionLabel.includes('اوزانالسداء') || sectionLabel.includes('اوزاناللحمه')) break;

    for (const group of groups) {
      const colorAddress = XLSX.utils.encode_cell({ r: row, c: group.color });
      const colorName = String(sheet[colorAddress]?.v ?? '').trim();
      const count = toFiniteNumber(sheet[XLSX.utils.encode_cell({ r: row, c: group.count })]?.v);
      const repeat = toFiniteNumber(sheet[XLSX.utils.encode_cell({ r: row, c: group.repeat })]?.v);
      if (!colorName || colorName === '0' || count === null || count <= 0) continue;
      pattern.push({
        sequenceNo,
        sourceCell: colorAddress,
        colorName,
        threadOrPickCount: count,
        repeatCount: repeat !== null && repeat > 0 ? repeat : null,
      });
      sequenceNo += 1;
    }
  }

  return pattern;
}

function readRequirementReferences(sheet: XLSX.WorkSheet): ManufacturingYarnRequirementReference[] {
  if (!sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const requirements: ManufacturingYarnRequirementReference[] = [];
  let headerRow: number | null = null;

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const value = normalizeArabicLabel(sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v);
    if (value.includes('اجماليالكميه')) {
      headerRow = row;
      break;
    }
  }
  if (headerRow === null) return requirements;

  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    const colorName = String(sheet[XLSX.utils.encode_cell({ r: row, c: 3 })]?.v ?? '').trim();
    const patternCount = toFiniteNumber(sheet[XLSX.utils.encode_cell({ r: row, c: 2 })]?.v);
    const weightPerThousandMeters = toFiniteNumber(sheet[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v);
    const requiredWeightKg = toFiniteNumber(sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v);
    if (!colorName || colorName === '0' || patternCount === null || patternCount <= 0) {
      if (requirements.length > 0) break;
      continue;
    }
    if (weightPerThousandMeters === null || requiredWeightKg === null) continue;
    requirements.push({ colorName, patternCount, weightPerThousandMeters, requiredWeightKg });
  }

  return requirements;
}

function readOrderSheet(sheet: XLSX.WorkSheet | undefined): ManufacturingOrderSheetReference | null {
  if (!sheet) return null;
  return {
    yarnCount: toDisplayValue(sheet.E2),
    pattern: readPattern(sheet),
    requirements: readRequirementReferences(sheet),
  };
}

function readFormulas(workbook: XLSX.WorkBook): WorkbookFormulaReference[] {
  const formulas: WorkbookFormulaReference[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const [cell, raw] of Object.entries(sheet)) {
      if (cell.startsWith('!') || !raw || typeof raw !== 'object') continue;
      const formula = (raw as XLSX.CellObject).f;
      if (!formula) continue;
      formulas.push({
        sheet: sheetName,
        cell,
        formula,
        cachedValue: toDisplayValue(raw as XLSX.CellObject),
        external: /\[[^\]]+\]/.test(formula),
      });
    }
  }
  return formulas;
}

function inspectWeaveDraft(sheet: XLSX.WorkSheet | undefined): ManufacturingSpecificationWorkbookPreview['weaveDraft'] {
  if (!sheet) return null;
  let populatedCells = 0;
  let styledCells = 0;
  for (const [address, raw] of Object.entries(sheet)) {
    if (address.startsWith('!') || !raw || typeof raw !== 'object') continue;
    const cell = raw as XLSX.CellObject;
    if (cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') populatedCells += 1;
    if (cell.s !== undefined) styledCells += 1;
  }
  return {
    range: sheet['!ref'] ?? null,
    populatedCells,
    styledCells,
    merges: sheet['!merges']?.length ?? 0,
  };
}

function patternCountByColor(pattern: ManufacturingPatternLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of pattern) {
    const key = normalizeArabicLabel(line.colorName);
    totals.set(key, (totals.get(key) ?? 0) + line.threadOrPickCount);
  }
  return totals;
}

function addPatternMismatchWarnings(
  target: ManufacturingWorkbookWarning[],
  sheetName: string,
  order: ManufacturingOrderSheetReference | null,
): void {
  if (!order || order.pattern.length === 0 || order.requirements.length === 0) return;
  const totals = patternCountByColor(order.pattern);
  for (const requirement of order.requirements) {
    const patternTotal = totals.get(normalizeArabicLabel(requirement.colorName)) ?? 0;
    if (Math.abs(patternTotal - requirement.patternCount) > 0.000001) {
      target.push({
        code: 'PATTERN_TOTAL_MISMATCH',
        sheet: sheetName,
        message: `إجمالي نمط اللون ${requirement.colorName} (${patternTotal}) لا يطابق مرجع الوزن (${requirement.patternCount})`,
      });
    }
  }
}

export function previewManufacturingSpecificationWorkbook(
  input: Buffer | Uint8Array | ArrayBuffer,
): ManufacturingSpecificationWorkbookPreview {
  const workbook = XLSX.read(input, {
    type: 'buffer',
    cellFormula: true,
    cellStyles: true,
    cellDates: true,
  });
  const resolvedSheets: Partial<Record<ManufacturingSheetRole, string>> = {};
  const warnings: ManufacturingWorkbookWarning[] = [];

  for (const [role, expectedName] of Object.entries(MANUFACTURING_WORKBOOK_SHEETS) as Array<[ManufacturingSheetRole, string]>) {
    const actualName = findSheetName(workbook, expectedName);
    if (actualName) resolvedSheets[role] = actualName;
    else warnings.push({ code: 'MISSING_REQUIRED_SHEET', message: `الورقة المطلوبة غير موجودة: ${expectedName}` });
  }

  const formulas = readFormulas(workbook);
  for (const formula of formulas.filter((item) => item.external)) {
    warnings.push({
      code: 'EXTERNAL_FORMULA_REFERENCE',
      sheet: formula.sheet,
      cell: formula.cell,
      message: `مرجع خارجي غير آمن للاستيراد في ${formula.sheet}!${formula.cell}`,
    });
  }
  for (const formula of formulas.filter((item) => /(^|[^\d])0\.59([^\d]|$)/.test(item.formula))) {
    warnings.push({
      code: 'SUSPICIOUS_COEFFICIENT',
      sheet: formula.sheet,
      cell: formula.cell,
      message: `المعامل 0.59 مختلف عن معامل التحويل المعتاد 0.6 في ${formula.sheet}!${formula.cell}`,
    });
  }

  const workOrderSheet = resolvedSheets.workOrder ? workbook.Sheets[resolvedSheets.workOrder] : undefined;
  const warpSheet = resolvedSheets.warpOrder ? workbook.Sheets[resolvedSheets.warpOrder] : undefined;
  const weftSheet = resolvedSheets.weftOrder ? workbook.Sheets[resolvedSheets.weftOrder] : undefined;
  const weaveSheet = resolvedSheets.weaveDraft ? workbook.Sheets[resolvedSheets.weaveDraft] : undefined;
  const warp = readOrderSheet(warpSheet);
  const weft = readOrderSheet(weftSheet);
  const weaveDraft = inspectWeaveDraft(weaveSheet);

  if (weaveDraft && weaveDraft.populatedCells <= 12) {
    warnings.push({
      code: 'EMPTY_WEAVE_DRAFT',
      sheet: resolvedSheets.weaveDraft,
      message: 'ورقة التركيب واللقي قالب منسق، لكنها لا تحتوي رسماً نسجياً مكتملًا',
    });
  }
  if (resolvedSheets.warpOrder) addPatternMismatchWarnings(warnings, resolvedSheets.warpOrder, warp);
  if (resolvedSheets.weftOrder) addPatternMismatchWarnings(warnings, resolvedSheets.weftOrder, weft);

  return {
    sheetNames: workbook.SheetNames,
    resolvedSheets,
    technicalFields: readTechnicalFields(workOrderSheet),
    warp,
    weft,
    weaveDraft,
    formulas,
    warnings,
  };
}

/**
 * Inspects the printable warp-card template. Two visual copies on one sheet are
 * deliberately reported as one logical record with two print copies.
 */
export function previewWarpCardTemplate(input: Buffer | Uint8Array | ArrayBuffer): WarpCardTemplatePreview {
  const workbook = XLSX.read(input, { type: 'buffer', cellStyles: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('ملف كارت السداء لا يحتوي أي ورقة');
  const sheet = workbook.Sheets[sheetName];
  const occurrences = new Map<string, string[]>();
  for (const label of WARP_CARD_FIELD_LABELS) occurrences.set(normalizeArabicLabel(label), []);

  for (const [address, raw] of Object.entries(sheet)) {
    if (address.startsWith('!') || !raw || typeof raw !== 'object') continue;
    const value = normalizeArabicLabel((raw as XLSX.CellObject).v);
    if (!occurrences.has(value)) continue;
    occurrences.get(value)?.push(address);
  }

  const fields = WARP_CARD_FIELD_LABELS.map((label) => ({
    label,
    occurrences: occurrences.get(normalizeArabicLabel(label)) ?? [],
  }));
  const presentCounts = fields.map((field) => field.occurrences.length).filter((count) => count > 0);
  const printCopiesInTemplate = presentCounts.length > 0 ? Math.max(1, Math.min(...presentCounts)) : 1;

  return {
    sheetName,
    range: sheet['!ref'] ?? null,
    logicalRecordCount: 1,
    printCopiesInTemplate,
    fields,
    missingFields: fields.filter((field) => field.occurrences.length === 0).map((field) => field.label),
  };
}
