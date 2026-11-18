import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { getLeaveBalances, type LeaveBalanceRow } from '../../lib/api/payrollApi';

type Props = { onClose: () => void };

/**
 * TASK 011: أرصدة الإجازات السنوية المحسوبة بقواعد HR (قراءة فقط).
 * لا تُحفظ ولا تُغيّر أي بيانات؛ تُحسب من تاريخ التعيين وقت الطلب.
 */
export const LeaveBalancesModal: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation('salaries');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [rows, setRows] = useState<LeaveBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getLeaveBalances(year)
      .then((res) => {
        if (!cancelled) setRows(res.data.rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('leaveBalances.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, t]);

  const missing = rows.filter((r) => r.missingHireDate).length;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/55 p-4" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-black text-slate-900">{t('leaveBalances.title')}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm">
            <label className="font-bold text-slate-600">{t('leaveBalances.year')}</label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              className="w-24 rounded-lg border border-slate-300 px-2 py-1.5"
              dir="ltr"
            />
          </div>
          <p className="text-xs text-slate-500">{t('leaveBalances.hint')}</p>
          {missing > 0 && <p className="text-xs font-bold text-amber-700">{t('leaveBalances.missingHire', { count: missing })}</p>}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!loading && !error && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 text-right">{t('leaveBalances.colEmployee')}</th>
                  <th className="p-2 text-right">{t('leaveBalances.colHire')}</th>
                  <th className="p-2 text-right">{t('leaveBalances.colDays')}</th>
                  <th className="p-2 text-right">{t('leaveBalances.colUsable')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} className="border-t border-slate-100">
                    <td className="p-2">
                      <span className="font-mono text-xs text-slate-500">{r.employeeCode}</span>{' '}
                      <span className="font-bold text-slate-800">{r.fullName}</span>
                    </td>
                    <td className="p-2" dir="ltr">{r.hireDate ?? '—'}</td>
                    <td className="p-2 font-bold text-indigo-700">{r.days ?? '—'}</td>
                    <td className="p-2" dir="ltr">{r.usableFrom ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
