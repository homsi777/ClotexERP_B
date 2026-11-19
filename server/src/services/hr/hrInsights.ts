import { getPool } from '../../db/pool.js';

/**
 * شاشة HR: تنبيهات يومية (من لم يُسجَّل / الغياب / نسيان الانصراف / التأخر) وتقارير سنوية.
 * قراءة فقط من attendance_daily_records و payroll_employees — لا كتابة ولا أثر مالي.
 *
 * تعريف الغياب لسجل يوم عمل: رمز غ (UNAUTH_ABSENCE)، أو يوم WORK بلا رمز حالة ولا حضور ولا انصراف.
 * «لم يُسجَّل» = موظف فعّال بلا أي سجل لذلك التاريخ (ملف البصمة لم يُغطِّه أو لم يُدخَل يدوياً).
 */

export type AlertEmployee = {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  detail?: string | null;
};

export type DailyAlerts = {
  date: string;
  activeEmployees: number;
  notRecorded: AlertEmployee[];
  absent: AlertEmployee[];
  missingCheckout: AlertEmployee[];
  late: AlertEmployee[];
  onLeave: AlertEmployee[];
};

const ACTIVE = `e.is_active = true AND e.status = 'ACTIVE'`;
const LEAVE_CODES = ['ANNUAL', 'CASUAL', 'SICK', 'MARRIAGE', 'PERMITTED_ABSENCE', 'COMP_LEAVE', 'MISSION_LEAVE'];

function mapRow(r: Record<string, unknown>, detail?: string | null): AlertEmployee {
  return {
    employeeId: String(r.id),
    employeeCode: String(r.employee_code ?? ''),
    fullName: String(r.full_name ?? ''),
    department: (r.department as string | null) ?? null,
    detail: detail ?? null,
  };
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export async function computeDailyAlerts(companyId: string, date: string, pool: Queryable = getPool()): Promise<DailyAlerts> {
  const emp = await pool.query(
    `SELECT e.id, e.employee_code, e.full_name, e.department,
            r.id AS rec_id, r.check_in_time, r.check_out_time, r.late_minutes::float AS late_minutes,
            r.day_type, r.status_code
       FROM payroll_employees e
       LEFT JOIN attendance_daily_records r
              ON r.company_id = e.company_id AND r.employee_id = e.id AND r.attendance_date = $2::date
      WHERE e.company_id = $1 AND ${ACTIVE}
      ORDER BY e.full_name`,
    [companyId, date],
  );
  const out: DailyAlerts = { date, activeEmployees: emp.rows.length, notRecorded: [], absent: [], missingCheckout: [], late: [], onLeave: [] };
  for (const r of emp.rows) {
    if (!r.rec_id) {
      out.notRecorded.push(mapRow(r));
      continue;
    }
    if (r.status_code && LEAVE_CODES.includes(r.status_code)) {
      out.onLeave.push(mapRow(r, r.status_code));
      continue;
    }
    if (r.status_code === 'REST' || r.status_code === 'OFFICIAL_HOLIDAY' || r.day_type !== 'WORK') continue;
    const noPunch = !r.check_in_time && !r.check_out_time;
    if (r.status_code === 'UNAUTH_ABSENCE' || (!r.status_code && noPunch)) {
      out.absent.push(mapRow(r));
      continue;
    }
    if (r.check_in_time && !r.check_out_time) out.missingCheckout.push(mapRow(r, String(r.check_in_time).slice(0, 5)));
    if (Number(r.late_minutes) > 0) out.late.push(mapRow(r, `${r.late_minutes}`));
  }
  return out;
}

export type AnnualMonth = {
  month: number;
  workedDays: number;
  absentDays: number;
  leaveDays: number;
  lateMinutes: number;
  permissionMinutes: number;
  totalHours: number;
  overtimeHours: number;
};

export type AnnualEmployee = {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  totals: Omit<AnnualMonth, 'month'> & { leaveByType: Record<string, number> };
  months: AnnualMonth[];
};

const emptyMonth = (month: number): AnnualMonth => ({
  month, workedDays: 0, absentDays: 0, leaveDays: 0, lateMinutes: 0, permissionMinutes: 0, totalHours: 0, overtimeHours: 0,
});

export async function computeAnnualReport(companyId: string, year: number, employeeId?: string, pool: Queryable = getPool()): Promise<{ year: number; employees: AnnualEmployee[] }> {
  const params: unknown[] = [companyId, `${year}-01-01`, `${year}-12-31`];
  let empFilter = '';
  if (employeeId) {
    params.push(employeeId);
    empFilter = ` AND e.id = $${params.length}`;
  }
  const res = await pool.query(
    `SELECT e.id, e.employee_code, e.full_name, e.department,
            EXTRACT(MONTH FROM r.attendance_date)::int AS month,
            COUNT(*) FILTER (WHERE r.day_type = 'WORK' AND r.status_code IS NULL AND (r.check_in_time IS NOT NULL OR r.total_hours > 0))::int AS worked,
            COUNT(*) FILTER (WHERE r.status_code = 'UNAUTH_ABSENCE'
                              OR (r.day_type = 'WORK' AND r.status_code IS NULL AND r.check_in_time IS NULL AND r.check_out_time IS NULL AND r.total_hours = 0))::int AS absent,
            COUNT(*) FILTER (WHERE r.status_code = ANY($${params.length + 1}::text[]))::int AS leave_days,
            COALESCE(SUM(r.late_minutes),0)::float AS late_min,
            COALESCE(SUM(r.permission_minutes),0)::float AS perm_min,
            COALESCE(SUM(r.total_hours),0)::float AS hours,
            COALESCE(SUM(r.ot_day_hours + r.ot_night_hours + r.ot_holiday1_hours + r.ot_holiday2_hours),0)::float AS ot,
            r.status_code
       FROM payroll_employees e
       JOIN attendance_daily_records r ON r.company_id = e.company_id AND r.employee_id = e.id
        AND r.attendance_date BETWEEN $2::date AND $3::date
      WHERE e.company_id = $1${empFilter}
      GROUP BY e.id, e.employee_code, e.full_name, e.department, month, r.status_code
      ORDER BY e.full_name, month`,
    [...params, LEAVE_CODES],
  );
  const byEmp = new Map<string, AnnualEmployee>();
  for (const r of res.rows) {
    let e = byEmp.get(r.id);
    if (!e) {
      e = {
        employeeId: r.id, employeeCode: r.employee_code, fullName: r.full_name, department: r.department,
        totals: { workedDays: 0, absentDays: 0, leaveDays: 0, lateMinutes: 0, permissionMinutes: 0, totalHours: 0, overtimeHours: 0, leaveByType: {} },
        months: Array.from({ length: 12 }, (_, i) => emptyMonth(i + 1)),
      };
      byEmp.set(r.id, e);
    }
    const m = e.months[r.month - 1];
    const add = (k: keyof Omit<AnnualMonth, 'month'>, v: number) => { m[k] += v; e!.totals[k] += v; };
    add('workedDays', r.worked);
    add('absentDays', r.absent);
    add('leaveDays', r.leave_days);
    add('lateMinutes', r.late_min);
    add('permissionMinutes', r.perm_min);
    add('totalHours', r.hours);
    add('overtimeHours', r.ot);
    if (r.status_code && LEAVE_CODES.includes(r.status_code)) {
      e.totals.leaveByType[r.status_code] = (e.totals.leaveByType[r.status_code] ?? 0) + r.leave_days;
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const employees = [...byEmp.values()];
  for (const e of employees) {
    e.totals.lateMinutes = round(e.totals.lateMinutes); e.totals.permissionMinutes = round(e.totals.permissionMinutes);
    e.totals.totalHours = round(e.totals.totalHours); e.totals.overtimeHours = round(e.totals.overtimeHours);
    for (const m of e.months) { m.lateMinutes = round(m.lateMinutes); m.permissionMinutes = round(m.permissionMinutes); m.totalHours = round(m.totalHours); m.overtimeHours = round(m.overtimeHours); }
  }
  return { year, employees };
}
