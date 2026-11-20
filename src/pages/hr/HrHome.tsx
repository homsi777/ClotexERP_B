import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BarChart3, CalendarCheck, ClipboardCheck, Clock, FileText, Loader2, UserX, Users, Wallet } from 'lucide-react';
import { fetchDailyAlerts, type AlertEmployee, type DailyAlerts } from '../../lib/api/hrInsightsApi';
import { todayYmd } from '../../lib/businessDate';

const today = () => todayYmd();

type AlertKey = 'notRecorded' | 'absent' | 'missingCheckout' | 'late';
const ALERT_STYLE: Record<AlertKey, { tone: string; icon: React.ElementType }> = {
  notRecorded: { tone: 'border-amber-200 bg-amber-50 text-amber-900', icon: AlertTriangle },
  absent: { tone: 'border-rose-200 bg-rose-50 text-rose-900', icon: UserX },
  missingCheckout: { tone: 'border-orange-200 bg-orange-50 text-orange-900', icon: Clock },
  late: { tone: 'border-sky-200 bg-sky-50 text-sky-900', icon: Clock },
};

export const HrHome: React.FC = () => {
  const { t } = useTranslation('hrHub');
  const [date, setDate] = useState(today());
  const [data, setData] = useState<DailyAlerts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<AlertKey | null>('absent');

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchDailyAlerts(d));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(date); }, [date, load]);

  const sections: { to: string; icon: React.ElementType; key: string }[] = [
    { to: '/hr/employees', icon: Users, key: 'employees' },
    { to: '/hr/attendance', icon: CalendarCheck, key: 'attendance' },
    { to: '/hr/monthly-review', icon: ClipboardCheck, key: 'monthlyReview' },
    { to: '/hr/annual-reports', icon: BarChart3, key: 'annualReports' },
    { to: '/salaries', icon: Wallet, key: 'payroll' },
    { to: '/salaries/log', icon: FileText, key: 'payrollLog' },
  ];

  const renderList = (rows: AlertEmployee[], kind: AlertKey) => (
    <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white">
      {rows.length === 0 ? (
        <p className="p-4 text-center text-sm text-slate-500">{t('none')}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="border-t border-slate-100 first:border-0">
                <td className="p-2.5 font-mono text-xs text-slate-500" dir="ltr">{r.employeeCode}</td>
                <td className="p-2.5 font-bold text-slate-900">{r.fullName}</td>
                <td className="p-2.5 text-slate-600">{r.department || '—'}</td>
                <td className="p-2.5 text-xs text-slate-500" dir="ltr">
                  {kind === 'late' && r.detail ? `${r.detail} ${t('minutes')}` : r.detail || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map(({ to, icon: Icon, key }) => (
          <Link key={to} to={to}
            className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100">
              <Icon className="h-6 w-6" />
            </span>
            <span>
              <span className="block font-bold text-slate-900">{t(`sections.${key}.title`)}</span>
              <span className="mt-1 block text-xs text-slate-500">{t(`sections.${key}.desc`)}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-slate-900">{t('alerts.title')}</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-slate-600">{t('alerts.date')}</label>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" dir="ltr" />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {data && (
          <>
            <p className="text-xs text-slate-500">{t('alerts.activeCount', { count: data.activeEmployees, leave: data.onLeave.length })}</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(Object.keys(ALERT_STYLE) as AlertKey[]).map((k) => {
                const { tone, icon: Icon } = ALERT_STYLE[k];
                const count = data[k].length;
                return (
                  <button key={k} type="button" onClick={() => setOpen(open === k ? null : k)}
                    className={`rounded-xl border p-4 text-right transition ${tone} ${open === k ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}>
                    <Icon className="mb-2 h-5 w-5" />
                    <span className="block text-3xl font-black">{count}</span>
                    <span className="text-xs font-bold">{t(`alerts.${k}`)}</span>
                  </button>
                );
              })}
            </div>
            {open && (
              <div>
                <p className="text-sm font-bold text-slate-700">{t(`alerts.${open}`)} — {t(`alerts.hint.${open}`)}</p>
                {renderList(data[open], open)}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
