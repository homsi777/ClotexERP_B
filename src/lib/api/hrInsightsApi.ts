import { apiFetch } from './client';

export interface AlertEmployee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  detail?: string | null;
}

export interface DailyAlerts {
  date: string;
  activeEmployees: number;
  notRecorded: AlertEmployee[];
  absent: AlertEmployee[];
  missingCheckout: AlertEmployee[];
  late: AlertEmployee[];
  onLeave: AlertEmployee[];
}

export interface AnnualMonth {
  month: number;
  workedDays: number;
  absentDays: number;
  leaveDays: number;
  lateMinutes: number;
  permissionMinutes: number;
  totalHours: number;
  overtimeHours: number;
}

export interface AnnualEmployee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  totals: Omit<AnnualMonth, 'month'> & { leaveByType: Record<string, number> };
  months: AnnualMonth[];
}

export async function fetchDailyAlerts(date?: string): Promise<DailyAlerts> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await apiFetch<{ ok: boolean; data: DailyAlerts }>(`/api/attendance/alerts${qs}`);
  return res.data;
}

export async function fetchAnnualReport(year: number): Promise<{ year: number; employees: AnnualEmployee[] }> {
  const res = await apiFetch<{ ok: boolean; data: { year: number; employees: AnnualEmployee[] } }>(
    `/api/attendance/annual-report?year=${year}`,
  );
  return res.data;
}
