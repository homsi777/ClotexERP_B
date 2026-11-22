import type { PoolClient } from 'pg';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { checkStoredWage, deriveEmployeeWage } from './hr/employeeWageFromPayroll.js';

type ServiceErrorCode = 'VALIDATION' | 'DUPLICATE';

/** بداية ملاحظة الموظفين المُنشَئين تلقائياً من ملف بصمة (createEmployeesFromFingerprints). */
export const FINGERPRINT_PLACEHOLDER_NOTE = 'أُنشئ من استيراد ملف بصمة';

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type PayrollExcelRowInput = {
  employeeCode: string;
  fullName: string;
  factory?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  category?: string | null;
  paymentMethod?: string | null;
  hireDate?: string | null;
  gender?: 'MALE' | 'FEMALE' | null;
  baseSalary: number;
  /** TASK 019: الأجر الشامل من الملف — هو أجر الموظف المعتمد (أجر اليوم = الشامل ÷ 30). */
  comprehensiveWage?: number | null;
  totalEntitlements: number;
  totalDeductions: number;
  finalNet: number;
  rawDetail?: unknown;
};

export type ImportDepartmentPayrollInput = {
  companyId: string;
  userId: string | null;
  departmentLabel: string;
  periodMonth: number;
  periodYear: number;
  currencyCode: string;
  exchangeRateToUsd: number;
  fileName: string;
  rows: PayrollExcelRowInput[];
  /** ساعات يوم العمل لموظفي هذا الملف (صالة 8، إدارة 9) — تُسجَّل للموظفين الجدد وتملأ الفارغ للقائمين. */
  workdayHours?: number | null;
  /** استيراد بيانات الموظفين فقط بلا إنشاء مسير رواتب. */
  employeesOnly?: boolean;
};

export type WageMismatch = {
  employeeCode: string;
  fullName: string;
  storedWage: number;
  fileComprehensiveWage: number;
  /** MATCHES_BASIC = الأرجح استيراد قديم سجّل الأساسي بدل الشامل. */
  kind: 'MATCHES_BASIC' | 'DIFFERENT';
};

export type ImportDepartmentPayrollResult = {
  payrollRunId: string | null;
  payrollNo: string | null;
  employeesCreated: number;
  employeesMatched: number;
  /** موظفون قائمون كان أجرهم 0 فمُلئ من الأجر الشامل بالملف. */
  wagesFilled: number;
  totalNet: number;
  employeesOnly: boolean;
  /** موظفون قائمون أجرهم المسجّل لا يطابق الأجر الشامل بالملف — للتنبيه، لا يُعدَّل شيء. */
  wageMismatches: WageMismatch[];
};

async function resolveOrCreateEmployee(
  client: PoolClient,
  companyId: string,
  row: PayrollExcelRowInput,
  currencyCode: string,
  workdayHours: number | null,
): Promise<{ id: string; created: boolean; mismatch: WageMismatch | null; wageFilled: boolean }> {
  const derived = deriveEmployeeWage({ comprehensive: row.comprehensiveWage, base: row.baseSalary });
  const existing = await client.query<{ id: string; base_salary: string; full_name: string; notes: string | null }>(
    `SELECT id, base_salary, full_name, notes FROM payroll_employees WHERE company_id = $1 AND fingerprint_code = $2`,
    [companyId, row.employeeCode],
  );
  if (existing.rows.length) {
    const e = existing.rows[0];
    const storedWage = Number(e.base_salary);
    // أجر 0 = «غير معروف» (موظف أُنشئ من استيراد بصمة بلا أجر) فيُملأ من الأجر الشامل بالملف؛ أي أجر أكبر
    // من صفر لا يُمسّ أبداً (قد يكون مضبوطاً أو معدَّلاً يدوياً) ويُنبَّه فقط إن اختلف.
    const fillWage = derived.source === 'COMPREHENSIVE' && derived.employeeWage > 0 && !(storedWage > 0);
    // يملأ الحقول الفارغة فقط (نسبة الأساسي، ساعات اليوم، وبيانات الهوية الناقصة) — لا يغيّر أي قيمة موجودة.
    await client.query(
      `UPDATE payroll_employees SET
         base_share_percent = COALESCE(base_share_percent, $3::numeric),
         workday_hours = COALESCE(workday_hours, $4::numeric),
         base_salary = CASE WHEN $5::boolean THEN $6::numeric ELSE base_salary END,
         hire_date = COALESCE(hire_date, $7::date),
         factory = COALESCE(factory, $8),
         department = COALESCE(department, $9),
         job_title = COALESCE(job_title, $10),
         category = COALESCE(category, $11),
         payment_method = COALESCE(payment_method, $12),
         gender = COALESCE(gender, $13),
         updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [
        e.id,
        companyId,
        derived.baseSharePercent,
        workdayHours,
        fillWage,
        derived.employeeWage,
        row.hireDate ?? null,
        row.factory ?? null,
        row.department ?? null,
        row.jobTitle ?? null,
        row.category ?? null,
        row.paymentMethod ?? null,
        row.gender ?? null,
      ],
    );
    // موظف أُنشئ من ملف بصمة باسم الجهاز (مقطوع أو بالإنجليزية) ← يُعتمد الاسم الكامل من ملف المرتبات.
    // لا يُمسّ أي اسم عدّله المستخدم: الشرط بقاء ملاحظة الإنشاء التلقائي كما هي.
    const fileName = (row.fullName ?? '').trim();
    if (e.notes?.startsWith(FINGERPRINT_PLACEHOLDER_NOTE) && fileName && fileName !== e.full_name.trim()) {
      await client.query(
        `UPDATE payroll_employees SET full_name = $3, notes = $4, updated_at = now() WHERE id = $1 AND company_id = $2`,
        [e.id, companyId, fileName, `استُكملت البيانات من ملف المرتبات؛ الاسم بالجهاز كان: ${e.full_name.trim()}`],
      );
    }
    if (fillWage) {
      await client.query(
        `INSERT INTO employee_wage_rule_history (company_id, employee_id, effective_from, base_salary, notes, created_by_user_id)
         VALUES ($1,$2,COALESCE($3::date, current_date),$4,'تعبئة أجر كان صفراً من ملف مرتبات Excel (الأجر الشامل)',$5)`,
        [companyId, e.id, row.hireDate ?? null, derived.employeeWage, null],
      );
    }
    let mismatch: WageMismatch | null = null;
    if (derived.source === 'COMPREHENSIVE' && !fillWage) {
      const check = checkStoredWage(Number(e.base_salary), derived.employeeWage, row.baseSalary);
      if (check !== 'MATCHES_COMPREHENSIVE') {
        mismatch = {
          employeeCode: row.employeeCode,
          fullName: e.full_name,
          storedWage: Number(e.base_salary),
          fileComprehensiveWage: derived.employeeWage,
          kind: check,
        };
      }
    }
    return { id: e.id, created: false, mismatch, wageFilled: fillWage };
  }

  const employeeCode = `EMP-${row.employeeCode}`;
  const ins = await client.query<{ id: string }>(
    `INSERT INTO payroll_employees (
       company_id, employee_code, full_name, fingerprint_code, factory, department, job_title, category,
       payment_method, hire_date, base_salary, currency_code, status, base_share_percent, workday_hours, gender
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,'ACTIVE',$13,$14,$15)
     ON CONFLICT (company_id, employee_code) DO UPDATE SET fingerprint_code = EXCLUDED.fingerprint_code
     RETURNING id`,
    [
      companyId,
      employeeCode,
      row.fullName || row.employeeCode,
      row.employeeCode,
      row.factory ?? null,
      row.department ?? null,
      row.jobTitle ?? null,
      row.category ?? null,
      row.paymentMethod ?? null,
      row.hireDate ?? null,
      derived.employeeWage,
      currencyCode,
      derived.baseSharePercent,
      workdayHours,
      row.gender ?? null,
    ],
  );
  const employeeId = ins.rows[0].id;
  await client.query(
    `INSERT INTO employee_wage_rule_history (company_id, employee_id, effective_from, base_salary, notes, created_by_user_id)
     VALUES ($1,$2,COALESCE($3::date, current_date),$4,'مستورد تلقائياً من كشف رواتب Excel',$5)`,
    [companyId, employeeId, row.hireDate ?? null, derived.employeeWage, null],
  );
  return { id: employeeId, created: true, mismatch: null, wageFilled: false };
}

/** يستورد شيت "الاجر" المحسوب فعلاً (أرقام نهائية حقيقية، لا إعادة حساب) كمسير
 * رواتب DRAFT جديد لقسم مُحدَّد لشهر مُحدَّد — موظف غير موجود بالنظام يُنشَأ
 * تلقائياً (مربوطاً برقم كوده/بصمته لا اسمه). لا يُرحَّل محاسبياً هنا — الاعتماد
 * وترحيل GL يبقيان إجراءً منفصلاً صريحاً (شاشة الرواتب الموجودة). */
export async function importDepartmentPayrollExcel(
  client: PoolClient,
  input: ImportDepartmentPayrollInput,
): Promise<ImportDepartmentPayrollResult> {
  if (!input.rows.length) fail('لا توجد صفوف للاستيراد', 'VALIDATION');
  if (!input.employeesOnly && !(input.exchangeRateToUsd > 0)) fail('سعر الصرف يجب أن يكون أكبر من صفر', 'VALIDATION');

  const workdayHours = input.workdayHours && input.workdayHours > 0 ? input.workdayHours : null;

  // استيراد الموظفين فقط: ينشئ الجدد ويملأ الحقول الفارغة بلا مسير ولا فحص تكرار مسير.
  if (input.employeesOnly) {
    let created = 0;
    let matched = 0;
    let filled = 0;
    const mismatches: WageMismatch[] = [];
    for (const row of input.rows) {
      const emp = await resolveOrCreateEmployee(client, input.companyId, row, input.currencyCode, workdayHours);
      if (emp.created) created++;
      else matched++;
      if (emp.wageFilled) filled++;
      if (emp.mismatch) mismatches.push(emp.mismatch);
    }
    return {
      payrollRunId: null,
      payrollNo: null,
      employeesCreated: created,
      employeesMatched: matched,
      wagesFilled: filled,
      totalNet: 0,
      employeesOnly: true,
      wageMismatches: mismatches,
    };
  }

  const existingRun = await client.query(
    `SELECT id FROM payroll_runs WHERE company_id=$1 AND department=$2 AND period_month=$3 AND period_year=$4`,
    [input.companyId, input.departmentLabel, input.periodMonth, input.periodYear],
  );
  if (existingRun.rows.length) fail('يوجد مسير رواتب مستورد مسبقاً لهذا القسم وهذا الشهر', 'DUPLICATE');

  let totalBase = 0;
  let totalAllowances = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  for (const row of input.rows) {
    totalBase += row.baseSalary;
    totalAllowances += row.totalEntitlements - row.baseSalary;
    totalDeductions += row.totalDeductions;
    totalNet += row.finalNet;
  }

  const payrollNo = generateDocumentNo(`PR-${input.departmentLabel}-${input.periodYear}-${input.periodMonth}`);
  const run = await client.query<{ id: string; payroll_no: string }>(
    `INSERT INTO payroll_runs (
       company_id, payroll_no, period_month, period_year, status,
       total_base, total_allowances, total_deductions, total_net,
       currency_code, exchange_rate_to_usd, department, notes, created_by_user_id
     ) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, payroll_no`,
    [
      input.companyId,
      payrollNo,
      input.periodMonth,
      input.periodYear,
      round2(totalBase),
      round2(totalAllowances),
      round2(totalDeductions),
      round2(totalNet),
      input.currencyCode,
      input.exchangeRateToUsd,
      input.departmentLabel,
      `مستورد من ملف Excel: ${input.fileName}`,
      input.userId,
    ],
  );
  const payrollRunId = run.rows[0].id;

  let employeesCreated = 0;
  let employeesMatched = 0;
  let wagesFilled = 0;
  const wageMismatches: WageMismatch[] = [];
  for (const row of input.rows) {
    const employee = await resolveOrCreateEmployee(client, input.companyId, row, input.currencyCode, workdayHours);
    if (employee.created) employeesCreated++;
    else employeesMatched++;
    if (employee.wageFilled) wagesFilled++;
    if (employee.mismatch) wageMismatches.push(employee.mismatch);

    await client.query(
      `INSERT INTO payroll_run_lines (
         company_id, payroll_run_id, employee_id, base_salary, allowances, deductions, net_salary,
         excel_detail, source_file, employee_fingerprint_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.companyId,
        payrollRunId,
        employee.id,
        round2(row.baseSalary),
        round2(row.totalEntitlements - row.baseSalary),
        round2(row.totalDeductions),
        round2(row.finalNet),
        JSON.stringify(row.rawDetail ?? null),
        input.fileName,
        row.employeeCode,
      ],
    );
  }

  return {
    payrollRunId,
    payrollNo: run.rows[0].payroll_no,
    employeesCreated,
    employeesMatched,
    wagesFilled,
    totalNet: round2(totalNet),
    employeesOnly: false,
    wageMismatches,
  };
}
