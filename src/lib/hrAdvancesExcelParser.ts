/**
 * محلّلا ملفي السلف:
 *  (أ) «سلف اكتوبر.xlsx»: ورقة بأعمدة الكود/الاسم/الأجر الشامل/قيمة 40%/قيمة السلفة — سلفة واحدة لكل موظف (تُخصم من مرتب الشهر).
 *  (ب) «السلف المقسطه.xlsx»: ورقة جدولة: الاسم، القيمة، المدة، تاريخ السلفة، ثم عمود لكل شهر بقسطه.
 * الأعمدة تُحدَّد من العناوين، والتواريخ من أرقام Excel التسلسلية.
 */
import * as XLSX from 'xlsx';

export interface ParsedAdvanceInstallment {
  month: number;
  year: number;
  amount: number;
}

export interface ParsedAdvanceRow {
  rowKey: string;
  code: string | null;
  name: string;
  amount: number;
  advanceDate: string;
  dateIsEstimated: boolean;
  notes: string | null;
  comprehensiveWage: number | null;
  installments: ParsedAdvanceInstallment[];
  /** صف بلا كود/اسم شخص واضح (مثل «باقى العمرة») — يُترك افتراضياً ولا يُنشأ له موظف. */
  suspicious: boolean;
  /** تنبيهات للعرض (مثلاً جدول الأقساط لا يساوي قيمة السلفة). */
  warnings: string[];
}

export interface ParsedAdvancesFile {
  kind: 'OCT' | 'SCHED';
  sheetName: string;
  rows: ParsedAdvanceRow[];
  baseYear: number;
  skippedRows: { rowNo: number; reason: string }[];
}

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;

export function serialToIso(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const d = new Date(EPOCH + Math.floor(n) * DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();

const MONTHS: Record<string, number> = {
  يناير: 1,
  فبراير: 2,
  مارس: 3,
  ابريل: 4,
  مايو: 5,
  يونيو: 6,
  يوليو: 7,
  اغسطس: 8,
  سبتمبر: 9,
  اكتوبر: 10,
  نوفمبر: 11,
  ديسمبر: 12,
};

function monthFromText(text: unknown): number | null {
  const t = norm(text);
  for (const [name, m] of Object.entries(MONTHS)) if (t.includes(name)) return m;
  return null;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
}

/** سلف الشهر (بالكود). تُرجع أول ورقة فيها عمودا «الكود» و«قيمة السلفة». */
export function parseOctoberAdvancesWorkbook(wb: XLSX.WorkBook, advanceDate: string): ParsedAdvancesFile {
  for (const sheetName of wb.SheetNames) {
    const raw = sheetRows(wb, sheetName);
    for (let h = 0; h < Math.min(8, raw.length); h++) {
      const cells = (raw[h] ?? []).map(norm);
      const codeCol = cells.findIndex((c) => c === 'الكود');
      const nameCol = cells.findIndex((c) => c === 'الاسم');
      const advCol = cells.findIndex((c) => c.startsWith('قيمه السلفه'));
      if (codeCol < 0 || nameCol < 0 || advCol < 0) continue;
      const wageCol = cells.findIndex((c) => c.startsWith('الاجر الشامل'));
      const rows: ParsedAdvanceRow[] = [];
      const skippedRows: { rowNo: number; reason: string }[] = [];
      for (let i = h + 1; i < raw.length; i++) {
        const r = raw[i] ?? [];
        const name = String(r[nameCol] ?? '').replace(/\s+/g, ' ').trim();
        const amount = num(r[advCol]);
        const code = String(r[codeCol] ?? '').trim();
        if (!name) {
          // صف الإجمالي (الاسم فارغ والقيمة في عمود آخر) أو صف فارغ.
          if (amount > 0 || code) skippedRows.push({ rowNo: i + 1, reason: 'صف بلا اسم (إجمالي أو فاصل)' });
          continue;
        }
        if (!(amount > 0)) continue;
        rows.push({
          rowKey: `r${i + 1}`,
          code: code || null,
          name,
          amount,
          advanceDate,
          dateIsEstimated: false,
          notes: 'سلفة الشهر — مخصومة من كشف المرتب',
          comprehensiveWage: wageCol >= 0 ? num(r[wageCol]) || null : null,
          installments: [],
          suspicious: !code,
          warnings: code ? [] : ['بلا كود موظف — قد لا يكون موظفاً (راجعه قبل الإنشاء)'],
        });
      }
      return { kind: 'OCT', sheetName, rows, baseYear: Number(advanceDate.slice(0, 4)), skippedRows };
    }
  }
  throw new Error('لم أجد ورقة فيها أعمدة «الكود» و«الاسم» و«قيمة السلفة»');
}

/** السلف المقسطة (بالاسم): عمود لكل شهر. السنة الأساسية = سنة أكثر تاريخ سلفة تكراراً. */
export function parseScheduledAdvancesWorkbook(wb: XLSX.WorkBook, fallbackDate: string): ParsedAdvancesFile {
  for (const sheetName of wb.SheetNames) {
    const raw = sheetRows(wb, sheetName);
    for (let h = 0; h < Math.min(8, raw.length); h++) {
      const header = raw[h] ?? [];
      const cells = header.map(norm);
      const nameCol = cells.findIndex((c) => c === 'الاسم');
      const valueCol = cells.findIndex((c) => c === 'القيمه');
      if (nameCol < 0 || valueCol < 0) continue;
      const durationCol = cells.findIndex((c) => c.startsWith('مده السداد'));
      const dateCols = cells.map((c, i) => (c === 'تاريخ السلفه' ? i : -1)).filter((i) => i >= 0);
      const notesCol = cells.findIndex((c) => c.startsWith('ملاحظات'));

      // سنة الأساس.
      const years = new Map<number, number>();
      for (let i = h + 1; i < raw.length; i++) {
        for (const c of dateCols) {
          const iso = serialToIso(raw[i]?.[c]);
          if (iso) years.set(Number(iso.slice(0, 4)), (years.get(Number(iso.slice(0, 4))) ?? 0) + 1);
        }
      }
      const baseYear = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Number(fallbackDate.slice(0, 4));

      // أعمدة الأشهر: اسم شهر ← baseYear؛ رقم تسلسلي ← تاريخه (يناير 2027…).
      const monthCols: { col: number; month: number; year: number }[] = [];
      header.forEach((cell, col) => {
        if (col === valueCol || dateCols.includes(col)) return;
        const m = monthFromText(cell);
        if (m) {
          monthCols.push({ col, month: m, year: baseYear });
          return;
        }
        const iso = serialToIso(cell);
        if (iso) monthCols.push({ col, month: Number(iso.slice(5, 7)), year: Number(iso.slice(0, 4)) });
      });
      if (!monthCols.length) continue;

      const rows: ParsedAdvanceRow[] = [];
      const skippedRows: { rowNo: number; reason: string }[] = [];
      for (let i = h + 1; i < raw.length; i++) {
        const r = raw[i] ?? [];
        const name = String(r[nameCol] ?? '').replace(/\s+/g, ' ').trim();
        const amount = num(r[valueCol]);
        if (!name) continue;
        if (!(amount > 0)) {
          skippedRows.push({ rowNo: i + 1, reason: 'بلا قيمة سلفة' });
          continue;
        }
        const installments: ParsedAdvanceInstallment[] = monthCols
          .map((m) => ({ month: m.month, year: m.year, amount: Math.round(num(r[m.col]) * 100) / 100 }))
          .filter((x) => x.amount > 0);

        const warnings: string[] = [];
        let advanceDate: string | null = null;
        let estimated = false;
        const extraDates: string[] = [];
        dateCols.forEach((c, idx) => {
          const iso = serialToIso(r[c]);
          if (!iso) return;
          if (!advanceDate) advanceDate = iso;
          else if (idx > 0) extraDates.push(iso);
        });
        if (!advanceDate) {
          // نص مثل «يناير وتم الترحيل» ← أول الشهر المذكور؛ وإلا أول شهر قسط؛ وإلا التاريخ الاحتياطي.
          const textMonth = dateCols.map((c) => monthFromText(r[c])).find((m) => m != null);
          if (textMonth) advanceDate = `${baseYear}-${String(textMonth).padStart(2, '0')}-01`;
          else if (installments.length) {
            const f = [...installments].sort((a, b) => a.year - b.year || a.month - b.month)[0];
            advanceDate = `${f.year}-${String(f.month).padStart(2, '0')}-01`;
          } else advanceDate = fallbackDate;
          estimated = true;
        }
        const duration = durationCol >= 0 ? num(r[durationCol]) : 0;
        const scheduled = Math.round(installments.reduce((s, x) => s + x.amount, 0) * 100) / 100;
        if (!installments.length) warnings.push('لا يوجد جدول أقساط بالملف — تُسجَّل السلفة بلا أقساط');
        else if (Math.abs(scheduled - amount) > 0.5) warnings.push(`مجموع الأقساط ${scheduled} ≠ قيمة السلفة ${amount}`);
        if (duration > 0 && installments.length && installments.length !== duration) warnings.push(`عدد الأقساط ${installments.length} ≠ المدة ${duration}`);

        const noteParts = [
          notesCol >= 0 ? String(r[notesCol] ?? '').trim() : '',
          extraDates.length ? `تاريخ سلفة إضافي بالملف: ${extraDates.join('، ')}` : '',
          duration > 0 ? `مدة السداد ${duration} شهر` : '',
        ].filter(Boolean);
        rows.push({
          rowKey: `r${i + 1}`,
          code: null,
          name,
          amount,
          advanceDate,
          dateIsEstimated: estimated,
          notes: noteParts.join(' — ') || null,
          comprehensiveWage: null,
          installments,
          suspicious: false,
          warnings,
        });
      }
      return { kind: 'SCHED', sheetName, rows, baseYear, skippedRows };
    }
  }
  throw new Error('لم أجد ورقة جدولة السلف (أعمدة «الاسم» و«القيمة» وأشهر السداد)');
}

export async function parseAdvancesFile(file: File, kind: 'OCT' | 'SCHED', fallbackDate: string): Promise<ParsedAdvancesFile> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
  return kind === 'OCT' ? parseOctoberAdvancesWorkbook(wb, fallbackDate) : parseScheduledAdvancesWorkbook(wb, fallbackDate);
}
