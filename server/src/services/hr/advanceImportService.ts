import type { PoolClient } from 'pg';
import { matchEmployeeByName, normalizeArabicName, type NameCandidate } from './employeeNameMatch.js';

/**
 * استيراد سلف تاريخية من Excel (سلف أكتوبر بالكود، والسلف المقسطة بالاسم) إلى payroll_employee_advances
 * + advance_installments. لا سند ولا حركة صندوق (المبلغ دُفع قبل دخول النظام).
 * - المطابقة: بالكود أولاً، ثم بالاسم (تطابق/بداية اسم/كلمات) — الملتبس يُترك ولا يُخمَّن.
 * - موظف غير موجود: يُنشأ فقط إن طُلب صراحةً (createIfMissing) فيصير موجوداً بالمشروع.
 * - إعادة الاستيراد آمنة: رقم السلفة حتمي، والموجود يُتخطّى (DUPLICATE).
 */

export interface ImportedInstallment {
  month: number;
  year: number;
  amount: number;
}

export interface ImportedAdvanceRow {
  /** مفتاح ثابت للصف داخل الملف (يدخل في رقم السلفة لضمان عدم التكرار). */
  rowKey: string;
  code?: string | null;
  name: string;
  amount: number;
  advanceDate: string;
  dateIsEstimated?: boolean;
  notes?: string | null;
  installments?: ImportedInstallment[];
  /** الأجر الشامل إن توفّر بالملف — يُسجَّل للموظف المُنشأ فقط. */
  comprehensiveWage?: number | null;
  /** إنشاء موظف إن لم يُطابَق أحد. */
  createIfMissing?: boolean;
}

export interface ImportAdvancesInput {
  companyId: string;
  userId: string | null;
  fileName: string;
  /** نوع المصدر يدخل في رقم السلفة: OCT (سلف الشهر) أو SCHED (مقسّطة). */
  kind: 'OCT' | 'SCHED';
  currencyCode: string;
  /** أقساط حتى هذا الشهر (شامل) تُعدّ مخصومة (PAID)؛ ما بعده PENDING. null = الكل PENDING. */
  paidThrough: { month: number; year: number } | null;
  dryRun: boolean;
  rows: ImportedAdvanceRow[];
}

export type AdvanceRowStatus =
  | 'IMPORTED'
  | 'DUPLICATE'
  | 'MISSING'
  | 'AMBIGUOUS'
  | 'INVALID';

export interface AdvanceRowResult {
  rowKey: string;
  name: string;
  amount: number;
  status: AdvanceRowStatus;
  matchedBy: 'CODE' | 'NAME_EXACT' | 'NAME_PREFIX' | 'NAME_TOKENS' | 'CREATED' | null;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  createdEmployee: boolean;
  advanceNo: string | null;
  installmentsCreated: number;
  installmentsPaid: number;
  /** مجموع الأقساط − قيمة السلفة (≠0 ⇒ جدول لا يغطي المبلغ أو يزيد عنه). */
  scheduleGap: number;
  note: string | null;
}

export interface ImportAdvancesResult {
  dryRun: boolean;
  rows: AdvanceRowResult[];
  advancesCreated: number;
  employeesCreated: number;
  installmentsCreated: number;
  totalAmount: number;
}

function fail(message: string): never {
  throw Object.assign(new Error(message), { code: 'VALIDATION' });
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

interface EmpRow {
  id: string;
  employee_code: string;
  fingerprint_code: string | null;
  full_name: string;
}

export async function importAdvancesFromExcel(client: PoolClient, input: ImportAdvancesInput): Promise<ImportAdvancesResult> {
  if (!input.rows.length) fail('لا توجد صفوف للاستيراد');
  if (input.rows.length > 2000) fail('عدد الصفوف أكبر من المسموح');

  const emps = await client.query<EmpRow>(
    `SELECT id, employee_code, fingerprint_code, full_name FROM payroll_employees WHERE company_id = $1`,
    [input.companyId],
  );
  const byCode = new Map<string, EmpRow>();
  for (const e of emps.rows) {
    byCode.set(e.employee_code.trim(), e);
    if (e.fingerprint_code?.trim()) byCode.set(e.fingerprint_code.trim(), e);
  }
  const candidates: (NameCandidate & { row: EmpRow })[] = emps.rows.map((e) => ({
    id: e.id,
    code: e.employee_code,
    name: e.full_name,
    row: e,
  }));
  const candidateById = new Map(candidates.map((c) => [c.id, c.row]));

  const results: AdvanceRowResult[] = [];
  const usedNos = new Set<string>();
  let advancesCreated = 0;
  let employeesCreated = 0;
  let installmentsCreated = 0;
  let totalAmount = 0;
  // موظفون سيُنشؤون في هذه الدفعة (للمعاينة والتجميع): اسم مطبَّع ← سجل افتراضي.
  const createdByName = new Map<string, EmpRow>();

  for (const row of input.rows) {
    const base: AdvanceRowResult = {
      rowKey: row.rowKey,
      name: row.name,
      amount: round2(row.amount),
      status: 'INVALID',
      matchedBy: null,
      employeeId: null,
      employeeCode: null,
      employeeName: null,
      createdEmployee: false,
      advanceNo: null,
      installmentsCreated: 0,
      installmentsPaid: 0,
      scheduleGap: 0,
      note: null,
    };
    const name = row.name.trim();
    if (!name || !(row.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(row.advanceDate)) {
      base.note = 'اسم أو مبلغ أو تاريخ غير صالح';
      results.push(base);
      continue;
    }

    // ---- مطابقة الموظف
    let emp: EmpRow | null = null;
    const code = row.code?.toString().trim();
    if (code && byCode.has(code)) {
      emp = byCode.get(code)!;
      base.matchedBy = 'CODE';
    } else {
      const m = matchEmployeeByName(
        name,
        candidates.map((c) => ({ id: c.id, code: c.code, name: c.name })),
      );
      if (m.kind === 'AMBIGUOUS') {
        base.status = 'AMBIGUOUS';
        base.note = `اسم ملتبس: ${m.candidates.map((c) => `${c.code} ${c.name}`).join(' / ')}`;
        results.push(base);
        continue;
      }
      if (m.kind !== 'NONE') {
        emp = candidateById.get(m.candidate.id) ?? null;
        base.matchedBy = m.kind === 'EXACT' ? 'NAME_EXACT' : m.kind === 'PREFIX' ? 'NAME_PREFIX' : 'NAME_TOKENS';
      }
    }

    // ---- موظف غير موجود: إنشاء صريح أو إبلاغ
    if (!emp) {
      const normName = normalizeArabicName(name);
      emp = createdByName.get(normName) ?? null;
      if (emp) {
        base.matchedBy = 'CREATED';
      } else if (!row.createIfMissing) {
        base.status = 'MISSING';
        base.note = 'موظف غير موجود بالنظام';
        results.push(base);
        continue;
      } else {
        const newCode = code || `ADV-${createdByName.size + 1}-${normName.replace(/\s+/g, '').slice(0, 12)}`;
        if (input.dryRun) {
          emp = { id: `new:${normName}`, employee_code: code ? `EMP-${code}` : `EMP-${newCode}`, fingerprint_code: code ?? null, full_name: name };
        } else {
          const employeeCode = code ? `EMP-${code}` : `EMP-${newCode}`;
          const ins = await client.query<{ id: string }>(
            `INSERT INTO payroll_employees (
               company_id, employee_code, full_name, fingerprint_code, base_salary, currency_code, status, notes
             ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)
             ON CONFLICT (company_id, employee_code) DO UPDATE SET updated_at = now()
             RETURNING id`,
            [
              input.companyId,
              employeeCode,
              name,
              code ?? null,
              round2(row.comprehensiveWage ?? 0),
              input.currencyCode,
              `أُنشئ من استيراد السلف (${input.fileName}) — غير وارد بكشف الرواتب؛ راجع بياناته (الكود/القسم/الأجر).`,
            ],
          );
          emp = { id: ins.rows[0].id, employee_code: employeeCode, fingerprint_code: code ?? null, full_name: name };
          if ((row.comprehensiveWage ?? 0) > 0) {
            await client.query(
              `INSERT INTO employee_wage_rule_history (company_id, employee_id, effective_from, base_salary, notes, created_by_user_id)
               VALUES ($1,$2,current_date,$3,'مستورد مع ملف السلف (الأجر الشامل)',$4)`,
              [input.companyId, emp.id, round2(row.comprehensiveWage ?? 0), input.userId],
            );
          }
        }
        createdByName.set(normName, emp);
        employeesCreated++;
        base.matchedBy = 'CREATED';
        base.createdEmployee = true;
      }
    }

    base.employeeId = emp.id;
    base.employeeCode = emp.employee_code;
    base.employeeName = emp.full_name;

    // ---- رقم حتمي للسلفة
    const stem = `ADV-IMP-${input.kind}-${emp.employee_code.replace(/^EMP-/, '')}-${row.advanceDate.replaceAll('-', '')}-${Math.round(row.amount)}`;
    let advanceNo = stem;
    let suffix = 1;
    while (usedNos.has(advanceNo)) advanceNo = `${stem}-${++suffix}`;
    usedNos.add(advanceNo);
    base.advanceNo = advanceNo;

    const installments = (row.installments ?? []).filter((i) => i.amount > 0 && i.month >= 1 && i.month <= 12);
    const scheduled = round2(installments.reduce((s, i) => s + i.amount, 0));
    base.scheduleGap = installments.length ? round2(scheduled - row.amount) : 0;

    if (!input.dryRun || !emp.id.startsWith('new:')) {
      const dup = emp.id.startsWith('new:')
        ? { rows: [] as unknown[] }
        : await client.query(`SELECT 1 FROM payroll_employee_advances WHERE company_id=$1 AND advance_no=$2`, [input.companyId, advanceNo]);
      if (dup.rows.length) {
        base.status = 'DUPLICATE';
        base.note = 'مستورد سابقاً';
        results.push(base);
        continue;
      }
    }

    const isPaid = (i: ImportedInstallment) =>
      input.paidThrough != null && (i.year < input.paidThrough.year || (i.year === input.paidThrough.year && i.month <= input.paidThrough.month));
    base.installmentsCreated = installments.length;
    base.installmentsPaid = installments.filter(isPaid).length;
    base.status = 'IMPORTED';
    totalAmount += round2(row.amount);

    if (!input.dryRun) {
      const noteParts = [row.notes?.trim(), row.dateIsEstimated ? 'تاريخ السلفة غير مذكور بالملف — اعتُمد تاريخ أول قسط' : null, `مستورد من ${input.fileName}`].filter(Boolean);
      const ins = await client.query<{ id: string }>(
        `INSERT INTO payroll_employee_advances (
           company_id, employee_id, voucher_id, cashbox_id, advance_no, advance_date, amount, currency_code,
           notes, created_by_user_id, installment_count, source, source_file, name_in_file
         ) VALUES ($1,$2,NULL,NULL,$3,$4::date,$5,$6,$7,$8,$9,'EXCEL_IMPORT',$10,$11)
         RETURNING id`,
        [
          input.companyId,
          emp.id,
          advanceNo,
          row.advanceDate,
          round2(row.amount),
          input.currencyCode,
          noteParts.join(' — '),
          input.userId,
          installments.length > 1 ? installments.length : null,
          input.fileName,
          name,
        ],
      );
      let n = 0;
      for (const inst of [...installments].sort((a, b) => a.year - b.year || a.month - b.month)) {
        n++;
        const paid = isPaid(inst);
        await client.query(
          `INSERT INTO advance_installments (
             company_id, advance_id, employee_id, installment_no, due_month, due_year, amount, paid_amount, status, paid_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $9 = 'PAID' THEN (make_date($6,$5,1) + interval '1 month' - interval '1 second') ELSE NULL END)`,
          [input.companyId, ins.rows[0].id, emp.id, n, inst.month, inst.year, round2(inst.amount), paid ? round2(inst.amount) : 0, paid ? 'PAID' : 'PENDING'],
        );
        installmentsCreated++;
      }
    } else {
      installmentsCreated += installments.length;
    }
    advancesCreated++;
    results.push(base);
  }

  return { dryRun: input.dryRun, rows: results, advancesCreated, employeesCreated, installmentsCreated, totalAmount: round2(totalAmount) };
}
