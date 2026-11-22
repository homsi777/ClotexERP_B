import { DateInput } from '../common/DateInput';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  getMonthlyStatusEffects,
  setAttendanceStatus,
  type MonthlyEffectsRowDto,
} from '../../lib/api/attendanceApi';
import { listPayrollEmployees, type PayrollEmployeeDto } from '../../lib/api/payrollApi';
import { ATTENDANCE_STATUS_OPTIONS } from '../../lib/hr/attendanceStatusLabels';
import { useToast } from '../NonBlockingToast';
import { todayYmd } from '../../lib/businessDate';

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
const todayIso = () => todayYmd();

type Props = {
  /** يُستدعى بعد تسجيل حالة ليُحدّث الجدول الرئيسي. */
  onChanged?: () => void;
};

/**
 * TASK 013: تسجيل حالة يوم (غ، س، ع، م، ز، ج…) ومعاينة أثر حالات الشهر على الراتب
 * ورصيد الإجازات. معاينة فقط: لا يُرحَّل شيء لمسير الرواتب.
 */
export const AttendanceStatusPanel: React.FC<Props> = ({ onChanged }) => {
  const { t } = useTranslation('hrAttendance');
  const { showToast } = useToast();

  const [employees, setEmployees] = useState<PayrollEmployeeDto[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [statusCode, setStatusCode] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<MonthlyEffectsRowDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    listPayrollEmployees({ active: true }).then((r) => setEmployees(r.data)).catch(() => setEmployees([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMonthlyStatusEffects(year, month)
      .then((res) => {
        if (!cancelled) setRows(res.data.rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('status.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month, tick, t]);

  const visibleRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.summary.unauthorizedAbsenceDays + r.summary.halfPayDays + r.summary.leaveDaysUsed > 0 ||
          r.overtime.totalActualHours > 0,
      ),
    [rows],
  );

  const save = async () => {
    if (!employeeId || !date || !reason.trim()) {
      showToast({ type: 'warning', message: t('status.fillRequired') });
      return;
    }
    setSaving(true);
    try {
      await setAttendanceStatus({ employeeId, date, statusCode: statusCode || null, reason: reason.trim() });
      showToast({ type: 'success', message: statusCode ? t('status.saved') : t('status.cleared') });
      setReason('');
      setTick((n) => n + 1);
      onChanged?.();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('status.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const ruleLabel = (rule: string) => (rule === 'GRADUATED' ? t('status.ruleGraduated') : t('status.ruleLegacy'));

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="font-bold text-slate-900">{t('status.title')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('status.hint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-xs font-bold text-slate-600">
          {t('filters.employee')}
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${inputCls} bg-white`}>
            <option value="">—</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-600">
          {t('table.date')}
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          {t('status.dayStatus')}
          <select value={statusCode} onChange={(e) => setStatusCode(e.target.value)} className={`${inputCls} bg-white`}>
            <option value="">{t('status.clearOption')}</option>
            {ATTENDANCE_STATUS_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>{o.symbol ? `${o.symbol} — ${o.label}` : o.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-600 lg:col-span-2">
          {t('editModal.reason')}
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </label>
      </div>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('status.save')}
      </button>

      <div className="border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <h4 className="font-bold text-slate-800">{t('status.effectsTitle')}</h4>
          <label className="text-xs font-bold text-slate-600">
            {t('status.month')}
            <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value) || month)}
              className="mx-1 w-16 rounded-lg border border-slate-300 px-2 py-1" dir="ltr" />
          </label>
          <label className="text-xs font-bold text-slate-600">
            {t('status.year')}
            <input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)}
              className="mx-1 w-20 rounded-lg border border-slate-300 px-2 py-1" dir="ltr" />
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('status.previewNote')}</p>

        {loading && <Loader2 className="mt-3 h-4 w-4 animate-spin text-slate-400" />}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {!loading && !error && visibleRows.length === 0 && <p className="mt-3 text-sm text-slate-400">{t('status.noEffects')}</p>}
        {!loading && !error && visibleRows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 text-start">{t('table.fullName')}</th>
                  <th className="p-2 text-end">{t('status.colAbsent')}</th>
                  <th className="p-2 text-end">{t('status.colLeaveDays')}</th>
                  <th className="p-2 text-end">{t('status.colHalfPay')}</th>
                  <th className="p-2 text-end">{t('status.colAbsenceDeduction')}</th>
                  <th className="p-2 text-end">{t('status.colOvertime')}</th>
                  <th className="p-2 text-end">{t('status.colTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.employeeId} className="border-t border-slate-100">
                    <td className="p-2">
                      <span className="font-mono text-xs text-slate-500">{r.employeeCode}</span>{' '}
                      <span className="font-bold text-slate-800">{r.fullName}</span>
                      {!r.moneyComputed && (
                        <span className="mt-0.5 block text-[10px] text-amber-700">{t('status.weeklyNoMoney')}</span>
                      )}
                      <span className="block text-[10px] text-slate-400">{ruleLabel(r.summary.absenceRule)}</span>
                    </td>
                    <td className="p-2 text-end">{r.summary.unauthorizedAbsenceDays}</td>
                    <td className="p-2 text-end">{r.summary.leaveDaysUsed}</td>
                    <td className="p-2 text-end">
                      {r.summary.halfPayDays}
                      {r.moneyComputed && r.summary.halfPayDays > 0 && (
                        <span className="block text-[10px] text-slate-500">−{money(r.summary.halfPayDeduction)}</span>
                      )}
                    </td>
                    <td className="p-2 text-end">
                      {r.moneyComputed ? (
                        <>
                          −{money(r.summary.absenceDeduction)}
                          {r.summary.unauthorizedAbsenceDays > 0 && (
                            <span className="block text-[10px] text-slate-500">
                              {t('status.wagePlusPenalty', {
                                wage: money(r.summary.absenceWageDeduction),
                                penalty: money(r.summary.absencePenaltyDeduction),
                              })}
                            </span>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="p-2 text-end">
                      {r.overtime.totalActualHours > 0 ? (
                        r.moneyComputed ? (
                          <>
                            +{money(r.overtime.totalAmount)}
                            <span className="block text-[10px] text-slate-500">
                              {t('status.overtimeHours', { hours: r.overtime.totalActualHours })}
                            </span>
                          </>
                        ) : (
                          t('status.overtimeHours', { hours: r.overtime.totalActualHours })
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-2 text-end font-bold text-rose-700">
                      {r.moneyComputed ? `−${money(r.summary.totalPayrollDeduction)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
