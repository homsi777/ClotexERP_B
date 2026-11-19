import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { fetchAnnualReport, type AnnualEmployee } from '../../lib/api/hrInsightsApi';
import { attendanceStatusLabel } from '../../lib/hr/attendanceStatusLabels';

const n2 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export const HrAnnualReports: React.FC = () => {
  const { t } = useTranslation('hrHub');
  const [year, setYear] = useState(new Date().getFullYear());
  const [mode, setMode] = useState<'general' | 'detailed'>('general');
  const [rows, setRows] = useState<AnnualEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAnnualReport(year);
      setRows(res.employees);
      setSelected((cur) => (res.employees.some((e) => e.employeeId === cur) ? cur : res.employees[0]?.employeeId ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [year, t]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? rows.filter((r) => r.fullName.toLowerCase().includes(s) || r.employeeCode.toLowerCase().includes(s) || (r.department ?? '').toLowerCase().includes(s)) : rows;
  }, [rows, search]);
  const current = rows.find((r) => r.employeeId === selected) ?? null;

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const general = filtered.map((e) => ({
      [t('cols.code')]: e.employeeCode, [t('cols.name')]: e.fullName, [t('cols.department')]: e.department ?? '',
      [t('cols.worked')]: e.totals.workedDays, [t('cols.absent')]: e.totals.absentDays, [t('cols.leave')]: e.totals.leaveDays,
      [t('cols.late')]: e.totals.lateMinutes, [t('cols.permission')]: e.totals.permissionMinutes,
      [t('cols.hours')]: e.totals.totalHours, [t('cols.overtime')]: e.totals.overtimeHours,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(general), t('modes.general'));
    const detailed = filtered.flatMap((e) => e.months.map((m) => ({
      [t('cols.code')]: e.employeeCode, [t('cols.name')]: e.fullName, [t('cols.month')]: m.month,
      [t('cols.worked')]: m.workedDays, [t('cols.absent')]: m.absentDays, [t('cols.leave')]: m.leaveDays,
      [t('cols.late')]: m.lateMinutes, [t('cols.permission')]: m.permissionMinutes,
      [t('cols.hours')]: m.totalHours, [t('cols.overtime')]: m.overtimeHours,
    })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailed), t('modes.detailed'));
    XLSX.writeFile(wb, `hr-annual-${year}.xlsx`);
  };

  const th = 'p-2.5 text-right font-bold whitespace-nowrap';
  const td = 'p-2.5 whitespace-nowrap';

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('annual.title')}</h1>
          <p className="text-sm text-slate-500">{t('annual.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value) || year)}
            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" dir="ltr" />
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold">
            {(['general', 'detailed'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`px-4 py-2 ${mode === m ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{t(`modes.${m}`)}</button>
            ))}
          </div>
          <button type="button" onClick={() => void exportExcel()} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="h-4 w-4" />{t('annual.export')}
          </button>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {mode === 'general' && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-3 border-b border-slate-100">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('annual.search')}
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className={th}>{t('cols.code')}</th><th className={th}>{t('cols.name')}</th><th className={th}>{t('cols.department')}</th>
                  <th className={th}>{t('cols.worked')}</th><th className={th}>{t('cols.absent')}</th><th className={th}>{t('cols.leave')}</th>
                  <th className={th}>{t('cols.late')}</th><th className={th}>{t('cols.permission')}</th>
                  <th className={th}>{t('cols.hours')}</th><th className={th}>{t('cols.overtime')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-slate-500">{t('annual.empty')}</td></tr>}
                {filtered.map((e) => (
                  <tr key={e.employeeId} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className={`${td} font-mono text-xs`} dir="ltr">{e.employeeCode}</td>
                    <td className={`${td} font-bold`}>{e.fullName}</td>
                    <td className={td}>{e.department || '—'}</td>
                    <td className={td}>{e.totals.workedDays}</td>
                    <td className={`${td} ${e.totals.absentDays ? 'font-bold text-rose-700' : ''}`}>{e.totals.absentDays}</td>
                    <td className={td} title={Object.entries(e.totals.leaveByType).map(([c, v]) => `${attendanceStatusLabel(c)}: ${v}`).join(' | ')}>{e.totals.leaveDays}</td>
                    <td className={td}>{n2(e.totals.lateMinutes)}</td>
                    <td className={td}>{n2(e.totals.permissionMinutes)}</td>
                    <td className={td}>{n2(e.totals.totalHours)}</td>
                    <td className={td}>{n2(e.totals.overtimeHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {mode === 'detailed' && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <label className="text-xs font-bold text-slate-600">{t('annual.employee')}</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-[14rem]">
              {rows.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.fullName} ({e.employeeCode})</option>)}
            </select>
            {current && <span className="text-xs text-slate-500">{current.department || ''}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className={th}>{t('cols.month')}</th><th className={th}>{t('cols.worked')}</th><th className={th}>{t('cols.absent')}</th>
                  <th className={th}>{t('cols.leave')}</th><th className={th}>{t('cols.late')}</th><th className={th}>{t('cols.permission')}</th>
                  <th className={th}>{t('cols.hours')}</th><th className={th}>{t('cols.overtime')}</th>
                </tr>
              </thead>
              <tbody>
                {!current && <tr><td colSpan={8} className="p-6 text-center text-slate-500">{t('annual.empty')}</td></tr>}
                {current?.months.map((m) => (
                  <tr key={m.month} className="border-t border-slate-100">
                    <td className={`${td} font-bold`}>{t(`months.${m.month}`)}</td>
                    <td className={td}>{m.workedDays}</td>
                    <td className={`${td} ${m.absentDays ? 'font-bold text-rose-700' : ''}`}>{m.absentDays}</td>
                    <td className={td}>{m.leaveDays}</td>
                    <td className={td}>{n2(m.lateMinutes)}</td>
                    <td className={td}>{n2(m.permissionMinutes)}</td>
                    <td className={td}>{n2(m.totalHours)}</td>
                    <td className={td}>{n2(m.overtimeHours)}</td>
                  </tr>
                ))}
                {current && (
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className={td}>{t('annual.total')}</td>
                    <td className={td}>{current.totals.workedDays}</td><td className={td}>{current.totals.absentDays}</td>
                    <td className={td}>{current.totals.leaveDays}</td><td className={td}>{n2(current.totals.lateMinutes)}</td>
                    <td className={td}>{n2(current.totals.permissionMinutes)}</td><td className={td}>{n2(current.totals.totalHours)}</td>
                    <td className={td}>{n2(current.totals.overtimeHours)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {current && Object.keys(current.totals.leaveByType).length > 0 && (
            <div className="border-t border-slate-100 p-3 text-xs text-slate-600">
              {Object.entries(current.totals.leaveByType).map(([c, v]) => `${attendanceStatusLabel(c)}: ${v}`).join('  •  ')}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
