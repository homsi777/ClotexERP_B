/** TASK 013: رموز/تسميات حالات الحضور للعرض (مرآة لـ server/src/services/hr/attendanceStatus.ts). */
export const ATTENDANCE_STATUS_OPTIONS = [
  { code: 'UNAUTH_ABSENCE', symbol: 'غ', label: 'غياب بدون إذن' },
  { code: 'ANNUAL', symbol: 'س', label: 'إجازة سنوية' },
  { code: 'CASUAL', symbol: 'ع', label: 'إجازة عارضة' },
  { code: 'SICK', symbol: 'م', label: 'إجازة مرضية' },
  { code: 'MARRIAGE', symbol: 'ز', label: 'إجازة زواج' },
  { code: 'PERMITTED_ABSENCE', symbol: 'ج', label: 'غياب بإذن' },
  { code: 'BAN', symbol: '', label: 'حظر' },
  { code: 'COMP_LEAVE', symbol: '', label: 'إجازة بدل' },
  { code: 'MISSION_LEAVE', symbol: '', label: 'إجازة مأمورية' },
  { code: 'OFFICIAL_HOLIDAY', symbol: '', label: 'إجازة رسمية' },
  { code: 'REST', symbol: '', label: 'راحة' },
  { code: 'MISSION', symbol: '', label: 'مأمورية' },
] as const;

export function attendanceStatusLabel(code: string | null | undefined): string {
  if (!code) return '—';
  const o = ATTENDANCE_STATUS_OPTIONS.find((x) => x.code === code);
  return o ? (o.symbol ? `${o.symbol} — ${o.label}` : o.label) : code;
}
