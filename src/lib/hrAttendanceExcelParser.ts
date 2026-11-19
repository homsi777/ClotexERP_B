/**
 * محلّل ملف بصمة الحضور — يدعم صيغتين بأعمدة تُحدَّد من العناوين لا من المواضع:
 *  (أ) "شيت الساعة - sewing.xlsx": شيت لكل يوم، العناوين: رقم البصمة/الاسم/التاريخ/الحضور/الانصراف…
 *  (ب) تصدير جهاز البصمة الخام (.xls): AC-No./Name/Date/Clock In/Clock Out/Late/Early/… يوم أو أكثر بشيت.
 *
 * التصحيحات المبنية على فحص الملفات الفعلية (أكتوبر/نوفمبر 2026):
 *  - خلية بصمة فارغة = لا بصمة (null)، لا "00:00:00" (كان يضخّم الساعات حتى 16–24 ساعة).
 *  - وردية ليلية: الجهاز يكتب لنفس الموظف واليوم صفّين — "بلا حضور ← انصراف 07:44" (ذيل وردية
 *    الليلة السابقة، محسوب أصلاً مع يومها) و"حضور 23:35 ← انصراف 07:40". نُبقي الصف الكامل ونُسقط
 *    الصدى؛ وإن لم يوجد صف كامل ندمج (أبكر حضور + آخر انصراف).
 *  - صف بتاريخ يبعد أكثر من يومين عن تاريخ الورقة الغالب (مثل 2024-09-17 بورقة 11) يُستبعد ويُبلَّغ عنه.
 *  - ورقة بلا صفوف (جمعة/راحة) تُعدّ "ورقة راحة" لا خطأً.
 *  - بصمة ناقصة (حضور بلا انصراف أو العكس) تُستورد بوقت فارغ وساعات 0 وعلامة incomplete لمراجعتها.
 */
import * as XLSX from 'xlsx';

export interface AttendanceParsedRow {
  fingerprintCode: string;
  nameInFile: string;
  attendanceDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  totalHours: number;
  sheetName: string;
  /** حضور بلا انصراف أو العكس — يحتاج مراجعة يدوية. */
  incomplete: boolean;
}

export interface AttendanceExcludedRow {
  sheetName: string;
  fingerprintCode: string;
  nameInFile: string;
  attendanceDate: string;
  reason: 'DATE_MISMATCH';
}

export interface AttendanceImportIssues {
  incompleteRows: number;
  /** صفوف مدمجة/مُسقَطة (صدى انصراف الوردية الليلية السابقة أو تكرار). */
  mergedDuplicates: number;
  excluded: AttendanceExcludedRow[];
  /** أوراق بلا صفوف (جمعة/راحة). */
  emptySheets: string[];
  /** أوراق لا تُعرَف عناوينها. */
  unreadableSheets: string[];
  /** صفوف بساعات أكثر من 16 (تُستورد لكن للتنبيه). */
  longShiftRows: number;
}

export interface ParsedAttendanceFile {
  rows: AttendanceParsedRow[];
  sheetsProcessed: number;
  /** للتوافق: كل ورقة لم تُنتج صفوفاً (فارغة أو غير مقروءة). */
  sheetsSkipped: string[];
  issues: AttendanceImportIssues;
}

const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_DRIFT_DAYS = 2;
const DOMINANT_DATE_SHARE = 0.8;
const LONG_SHIFT_HOURS = 16;

export function excelSerialToIsoDate(serial: unknown): string | null {
  const n = typeof serial === 'number' ? serial : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(EXCEL_EPOCH_1900 + Math.floor(n) * DAY_MS);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** كسر يوم Excel ⇒ HH:MM:SS. فارغ/نص/خارج [0,1) ⇒ null (لا بصمة). */
export function excelFractionToTime(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) return null;
  const totalSeconds = Math.round(value * 86400);
  const hh = String(Math.floor(totalSeconds / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function toSeconds(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

export function hoursBetween(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const inS = toSeconds(checkIn);
  let outS = toSeconds(checkOut);
  if (outS < inS) outS += 86400; // وردية تعبر منتصف الليل
  return Math.round(((outS - inS) / 3600) * 100) / 100;
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

type Columns = { code: number; name: number; date: number; inT: number; outT: number };

const HEADER_ALIASES: Record<keyof Columns, string[]> = {
  code: ['رقم البصمة', 'ac-no.', 'ac-no', 'ac no'],
  name: ['الاسم', 'name'],
  date: ['التاريخ', 'date'],
  inT: ['الحضور', 'clock in'],
  outT: ['الانصراف', 'clock out'],
};

/** يبحث في أول 6 صفوف عن صف العناوين ويرجع مواضع الأعمدة وأول صف بيانات. */
function detectLayout(raw: unknown[][]): { cols: Columns; firstDataRow: number } | null {
  for (let i = 0; i < Math.min(6, raw.length); i++) {
    const cells = (raw[i] ?? []).map(norm);
    const find = (aliases: string[]) => cells.findIndex((c) => aliases.includes(c));
    const cols: Columns = {
      code: find(HEADER_ALIASES.code),
      name: find(HEADER_ALIASES.name),
      date: find(HEADER_ALIASES.date),
      inT: find(HEADER_ALIASES.inT),
      outT: find(HEADER_ALIASES.outT),
    };
    if (cols.code >= 0 && cols.date >= 0 && cols.inT >= 0 && cols.outT >= 0) {
      if (cols.name < 0) cols.name = cols.code + 1;
      return { cols, firstDataRow: i + 1 };
    }
  }
  return null;
}

export type RawEntry = { code: string; name: string; date: string; inT: string | null; outT: string | null };

/** يدمج صفوف نفس (موظف، تاريخ) في سجل واحد حسب القواعد أعلاه. */
export function reconcileDayEntries(entries: RawEntry[]): { in: string | null; out: string | null; merged: number } {
  if (entries.length === 1) return { in: entries[0].inT, out: entries[0].outT, merged: 0 };
  const full = entries.filter((e) => e.inT && e.outT);
  if (full.length) {
    // الصف الكامل هو الوردية الفعلية؛ الباقي أصداء/تكرار.
    return { in: full[0].inT, out: full[0].outT, merged: entries.length - 1 };
  }
  const ins = entries.map((e) => e.inT).filter((x): x is string => Boolean(x)).sort();
  const outs = entries.map((e) => e.outT).filter((x): x is string => Boolean(x)).sort();
  return { in: ins[0] ?? null, out: outs[outs.length - 1] ?? null, merged: entries.length - 1 };
}

export function parseAttendanceWorkbookData(workbook: XLSX.WorkBook): ParsedAttendanceFile {
  const rows: AttendanceParsedRow[] = [];
  const issues: AttendanceImportIssues = {
    incompleteRows: 0,
    mergedDuplicates: 0,
    excluded: [],
    emptySheets: [],
    unreadableSheets: [],
    longShiftRows: 0,
  };
  let sheetsProcessed = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const layout = detectLayout(raw);
    if (!layout) {
      if (raw.length > 2) issues.unreadableSheets.push(sheetName);
      else issues.emptySheets.push(sheetName);
      continue;
    }
    const { cols, firstDataRow } = layout;

    const entries: RawEntry[] = [];
    for (let i = firstDataRow; i < raw.length; i++) {
      const r = raw[i] ?? [];
      const code = String(r[cols.code] ?? '').trim();
      if (!code) continue;
      const date = excelSerialToIsoDate(r[cols.date]);
      if (!date) continue;
      entries.push({
        code,
        name: String(r[cols.name] ?? '').trim(),
        date,
        inT: excelFractionToTime(r[cols.inT]),
        outT: excelFractionToTime(r[cols.outT]),
      });
    }
    if (!entries.length) {
      issues.emptySheets.push(sheetName);
      continue;
    }

    // التاريخ الغالب للورقة (إن وُجد ≥80%) — يُستبعد ما يبعد عنه أكثر من يومين.
    const counts = new Map<string, number>();
    entries.forEach((e) => counts.set(e.date, (counts.get(e.date) ?? 0) + 1));
    const [topDate, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const hasDominant = topCount / entries.length >= DOMINANT_DATE_SHARE;
    const kept: RawEntry[] = [];
    for (const e of entries) {
      if (hasDominant && dayDiff(e.date, topDate) > MAX_DATE_DRIFT_DAYS) {
        issues.excluded.push({
          sheetName,
          fingerprintCode: e.code,
          nameInFile: e.name,
          attendanceDate: e.date,
          reason: 'DATE_MISMATCH',
        });
      } else {
        kept.push(e);
      }
    }

    const groups = new Map<string, RawEntry[]>();
    for (const e of kept) {
      const k = `${e.code}|${e.date}`;
      const arr = groups.get(k) ?? [];
      arr.push(e);
      groups.set(k, arr);
    }
    let producedAny = false;
    for (const group of groups.values()) {
      const rec = reconcileDayEntries(group);
      issues.mergedDuplicates += rec.merged;
      const incomplete = !(rec.in && rec.out);
      const totalHours = hoursBetween(rec.in, rec.out);
      if (incomplete) issues.incompleteRows++;
      if (totalHours > LONG_SHIFT_HOURS) issues.longShiftRows++;
      rows.push({
        fingerprintCode: group[0].code,
        nameInFile: group[0].name,
        attendanceDate: group[0].date,
        checkInTime: rec.in,
        checkOutTime: rec.out,
        totalHours,
        sheetName,
        incomplete,
      });
      producedAny = true;
    }
    if (producedAny) sheetsProcessed++;
  }

  return {
    rows,
    sheetsProcessed,
    sheetsSkipped: [...issues.emptySheets, ...issues.unreadableSheets],
    issues,
  };
}

export async function parseAttendanceWorkbook(file: File): Promise<ParsedAttendanceFile> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { cellDates: false });
  return parseAttendanceWorkbookData(workbook);
}
