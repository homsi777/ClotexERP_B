import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, UserCheck } from 'lucide-react';
import { listSupervisorAssignmentsApi, setSupervisorApi, type SupervisorAssignment } from '../lib/api/editRequestsApi';
import { useToast } from '../components/NonBlockingToast';

const ROLE_AR: Record<string, string> = { admin: 'مدير النظام', manager: 'مدير عمليات', inventory: 'مخزون', accountant: 'محاسب', viewer: 'مشاهد' };

/** مركز الإعدادات: ربط كل موظف بمسؤوله — إليه تُرسَل طلبات إذن التعديل (بالدردشة الداخلية وبالجرس). */
export const ApprovalSettings: React.FC = () => {
  const { showToast } = useToast();
  const [rows, setRows] = useState<SupervisorAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listSupervisorAssignmentsApi());
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر التحميل' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);

  const change = async (userId: string, supervisorId: string) => {
    setSavingId(userId);
    try {
      await setSupervisorApi(userId, supervisorId || null);
      setRows((cur) => cur.map((r) => (r.userId === userId ? { ...r, supervisorId: supervisorId || null } : r)));
      showToast({ type: 'success', message: 'تم الحفظ' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذّر الحفظ' });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><UserCheck className="h-6 w-6 text-indigo-600" /> ربط الموظفين بالمسؤولين</h1>
        <p className="text-sm text-slate-500">
          حين يريد موظف تعديل عنصر محفوظ لا يملك تعديله مباشرة (عميل، فاتورة…) يطلب إذناً من مسؤوله: تصل المسؤول رسالة بالدردشة الداخلية مرتبطة بالعملية وإشعار بالجرس، وإن وافق يعدّل الموظف مرة واحدة.
          من لا مسؤول له يراه كل مدير ومحاسب.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr><th className="p-3">الموظف</th><th className="p-3">الدور</th><th className="p-3">المسؤول المباشر</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="p-6 text-center text-slate-400"><Loader2 className="inline h-5 w-5 animate-spin" /></td></tr>}
            {rows.map((r) => (
              <tr key={r.userId} className="border-t border-slate-100">
                <td className="p-3 font-bold text-slate-900">{r.name} <span className="font-mono text-xs font-normal text-slate-400" dir="ltr">{r.username}</span></td>
                <td className="p-3 text-slate-600">{ROLE_AR[r.role] ?? r.role}</td>
                <td className="p-3">
                  <select
                    value={r.supervisorId ?? ''}
                    disabled={savingId === r.userId}
                    onChange={(e) => void change(r.userId, e.target.value)}
                    className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  >
                    <option value="">— لا مسؤول (يراه كل مدير/محاسب) —</option>
                    {rows.filter((x) => x.userId !== r.userId).map((x) => (
                      <option key={x.userId} value={x.userId}>{x.name} ({ROLE_AR[x.role] ?? x.role})</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
