import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { ENTITY_AR, myEditRequests, requestEditPermission, setEditGrant, type EditEntityType, type EditRequestDto } from '../lib/api/editRequestsApi';

/**
 * شريط إذن التعديل: لمن لا يملك تعديلاً مباشراً. يطلب الإذن من مسؤوله (تصله رسالة دردشة مرتبطة بالعملية)،
 * وإن وُوفق يُفتح التعديل مرة واحدة (يُرفَق الإذن تلقائياً بطلب الحفظ). onAllowed(true) حين يصير التعديل متاحاً.
 */
export const EditRequestBar: React.FC<{
  entityType: EditEntityType;
  entityId: string;
  /** هل يملك المستخدم تعديلاً مباشراً (لا حاجة لإذن)؟ */
  direct: boolean;
  onAllowed?: (allowed: boolean) => void;
}> = ({ entityType, entityId, direct, onAllowed }) => {
  const [req, setReq] = useState<EditRequestDto | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await myEditRequests(entityType, entityId);
      const live = list.find((r) => r.status === 'PENDING' || r.status === 'APPROVED') ?? list[0] ?? null;
      setReq(live);
      setEditGrant(entityId, live?.status === 'APPROVED' ? live.id : null);
      onAllowed?.(live?.status === 'APPROVED');
    } catch {
      /* تجاهل */
    }
  }, [entityType, entityId, onAllowed]);

  useEffect(() => {
    if (direct) {
      onAllowed?.(true);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => {
      window.clearInterval(id);
      setEditGrant(entityId, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, entityId]);

  if (direct) return null;

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      setReq(await requestEditPermission(entityType, entityId, reason));
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر إرسال الطلب');
    } finally {
      setBusy(false);
    }
  };

  const approved = req?.status === 'APPROVED';
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${approved ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`} dir="rtl">
      {approved ? (
        <p className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4" /> تمت الموافقة — يمكنك تعديل هذا الـ{ENTITY_AR[entityType]} الآن (مرة واحدة).</p>
      ) : req?.status === 'PENDING' ? (
        <p className="flex items-center gap-2 font-bold"><Loader2 className="h-4 w-4 animate-spin" /> طلبك بانتظار موافقة المسؤول — أُرسلت له رسالة بالدردشة الداخلية.</p>
      ) : (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-bold"><Lock className="h-4 w-4" /> التعديل بعد الحفظ يحتاج إذن المسؤول.{req?.status === 'REJECTED' && ` (رُفض الطلب السابق${req.decisionNote ? `: ${req.decisionNote}` : ''})`}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب التعديل المطلوب…" className="min-w-[220px] flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm" />
            <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void send()} className="rounded-lg bg-amber-600 px-4 py-1.5 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
              طلب إذن التعديل
            </button>
          </div>
          {error && <p className="text-xs text-rose-700">{error}</p>}
        </div>
      )}
    </div>
  );
};
