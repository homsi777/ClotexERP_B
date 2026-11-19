import React, { useCallback, useEffect, useState } from "react";
import {
  completeWarpingOrder,
  createWarpingYarnIssue,
  approveWarpingYarnIssue,
  closeWarpingYarnIssue,
  createWarpingOrder,
  getWarpingOptions,
  listWarpingOrders,
  listWarpingYarnIssues,
  recordAndGetWarpCardPrint,
  releaseWarpingOrder,
  transitionWarpingOrder,
  type WarpingOptions,
  type WarpingOrder,
} from "../../lib/api/manufacturingWarpingApi";
import { renderWarpCardHtml } from "../../lib/printing/renderWarpCardHtml";
const cls = "rounded-lg border px-3 py-2 text-sm";
export function WarpingOrdersPanel({
  canManage,
  canQuality,
  canApproveYarn,
}: {
  canManage: boolean;
  canQuality: boolean;
  canApproveYarn: boolean;
}) {
  const [rows, setRows] = useState<WarpingOrder[]>([]),
    [options, setOptions] = useState<WarpingOptions | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [issueFor, setIssueFor] = useState<WarpingOrder | null>(null),
    [issueForm, setIssueForm] = useState({ yarnLotId: "", weightKg: "" }),
    [yarnIssues, setYarnIssues] = useState<
      Array<{ id: string; issue_no: string; status: string; warpingOrderNo: string; lines:Array<{id:string;issuedWeightKg:number}> }>
    >([]);
  const [form, setForm] = useState({
    workOrderId: "",
    plannedLengthM: "",
    warpingMachineId: "",
    targetLoomId: "",
    operatorEmployeeId: "",
    shiftTypeId: "",
    tieCount: "",
    beamNo: "",
    notes: "",
  });
  const [completion,setCompletion]=useState<WarpingOrder|null>(null);
  const [completionLength,setCompletionLength]=useState('');
  const [completionQuality,setCompletionQuality]=useState<'ACCEPTED'|'CONDITIONAL'|'REJECTED'>('ACCEPTED');
  const [completionNextStage,setCompletionNextStage]=useState<'SIZING'|'WEAVING'>('WEAVING');
  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([listWarpingOrders(), getWarpingOptions()]);
      setRows(r);
      setOptions(o);
      const issueGroups = await Promise.all(
        r.map(async (order) =>
          (await listWarpingYarnIssues(order.id)).map((issue) => ({
            ...issue,
            warpingOrderNo: order.warping_order_no,
          })),
        ),
      );
      setYarnIssues(issueGroups.flat());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل أوامر التسدية");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية");
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      await createWarpingOrder({
        ...form,
        plannedLengthM: Number(form.plannedLengthM),
        tieCount: form.tieCount ? Number(form.tieCount) : null,
        warpingMachineId: form.warpingMachineId || null,
        targetLoomId: form.targetLoomId || null,
        operatorEmployeeId: form.operatorEmployeeId || null,
        shiftTypeId: form.shiftTypeId || null,
      });
      setOpen(false);
    });
  const printCard = async (row: WarpingOrder) => {
    const popup = window.open("", "_blank", "width=1000,height=700");
    if (!popup) {
      setError("اسمح بفتح نافذة الطباعة من المتصفح");
      return;
    }
    popup.opener=null;
    setBusy(true);
    try {
      const card = await recordAndGetWarpCardPrint(row.id);
      popup.document.write(renderWarpCardHtml({ cardNo: card.cardNo, barcode: card.barcode, data: card.cardData }));
      popup.document.close();
      await load();
    } catch (e) {
      popup.close();
      setError(e instanceof Error ? e.message : "تعذرت طباعة الكارت");
    } finally {
      setBusy(false);
    }
  };
  const requestYarn = () =>
    run(async () => {
      if (!issueFor) return;
      await createWarpingYarnIssue(issueFor.id, {
        lines: [{ yarnLotId: issueForm.yarnLotId, requestedWeightKg: Number(issueForm.weightKg) }],
      });
      setIssueFor(null);
      setIssueForm({ yarnLotId: "", weightKg: "" });
    });
  const settleYarn=(issue:(typeof yarnIssues)[number])=>{const lines:Array<{lineId:string;returnedWeightKg:number;wasteWeightKg:number}>=[];for(const line of issue.lines){const returned=Number(prompt(`الوزن المرتجع من المصروف ${line.issuedWeightKg} كغ`,`0`));if(!Number.isFinite(returned)||returned<0)return;const waste=Number(prompt("وزن الهالك كغ","0"));if(!Number.isFinite(waste)||waste<0)return;lines.push({lineId:line.id,returnedWeightKg:returned,wasteWeightKg:waste});}void run(()=>closeWarpingYarnIssue(issue.id,lines));};
  return (
    <div className="p-4">
      {error && <div className="mb-3 rounded bg-rose-50 p-3 text-rose-700">{error}</div>}
      {completion&&<form className="mb-4 grid gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 md:grid-cols-4" onSubmit={e=>{e.preventDefault();if(!completionLength.trim()||!Number.isFinite(Number(completionLength))||Number(completionLength)<0||(completionQuality!=='REJECTED'&&Number(completionLength)<=0))return;void run(async()=>{await completeWarpingOrder(completion.id,{version:completion.version,actualLengthM:Number(completionLength),qualityStatus:completionQuality,nextStage:completionNextStage});setCompletion(null);});}}>
        <strong className="md:col-span-4">فحص التسدية — {completion.warping_order_no}</strong>
        <label className="text-sm">الطول الفعلي بالمتر<input aria-label="الطول الفعلي للتسدية" required type="number" min={completionQuality==='REJECTED'?0:0.001} step="0.001" className={`${cls} w-full`} value={completionLength} onChange={e=>setCompletionLength(e.target.value)}/></label>
        <label className="text-sm">نتيجة الفحص<select aria-label="نتيجة فحص التسدية" className={`${cls} w-full`} value={completionQuality} onChange={e=>setCompletionQuality(e.target.value as typeof completionQuality)}><option value="ACCEPTED">مقبول</option><option value="CONDITIONAL">قبول مشروط</option><option value="REJECTED">مرفوض</option></select></label>
        <label className="text-sm">المرحلة التالية<select aria-label="المرحلة التالية للمطواة" disabled={completionQuality==='REJECTED'} className={`${cls} w-full`} value={completionNextStage} onChange={e=>setCompletionNextStage(e.target.value as typeof completionNextStage)}><option value="WEAVING">النسج مباشرة</option><option value="SIZING">التصميغ أولاً</option></select></label>
        <div className="flex items-end gap-2"><button disabled={busy} type="submit" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">حفظ نتيجة الفحص</button><button disabled={busy} type="button" className={cls} onClick={()=>setCompletion(null)}>إلغاء</button></div>
      </form>}
      {issueFor && (
        <div className="mb-4 grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 md:grid-cols-4">
          <strong>طلب صرف خيط — {issueFor.warping_order_no}</strong>
          <select
            className={cls}
            value={issueForm.yarnLotId}
            onChange={(e) => setIssueForm({ ...issueForm, yarnLotId: e.target.value })}
          >
            <option value="">اختر لوط الخيط</option>
            {options?.yarnLots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.item_name} — {l.color_name || "—"} — {l.barcode} ({l.weight_kg} كغ)
              </option>
            ))}
          </select>
          <input
            className={cls}
            type="number"
            step="0.001"
            placeholder="الوزن المطلوب كغ"
            value={issueForm.weightKg}
            onChange={(e) => setIssueForm({ ...issueForm, weightKg: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              disabled={busy || !issueForm.yarnLotId || Number(issueForm.weightKg) <= 0}
              className="rounded bg-amber-600 px-3 py-2 font-bold text-white disabled:opacity-50"
              onClick={() => void requestYarn()}
            >
              إرسال للاعتماد
            </button>
            <button className={cls} onClick={() => setIssueFor(null)}>
              إلغاء
            </button>
          </div>
        </div>
      )}
      {canApproveYarn && yarnIssues.some((i) => i.status === "REQUESTED") && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
          <h3 className="mb-2 font-bold">طلبات صرف تنتظر اعتماد مدير المصنع/الإنتاج</h3>
          <div className="flex flex-wrap gap-2">
            {yarnIssues
              .filter((i) => i.status === "REQUESTED")
              .map((i) => (
                <div key={i.id} className="rounded border bg-white p-2 text-sm">
                  {i.issue_no} — {i.warpingOrderNo}
                  <button
                    className="mr-3 rounded bg-blue-600 px-3 py-1 font-bold text-white"
                    disabled={busy}
                    onClick={() => void run(() => approveWarpingYarnIssue(i.id))}
                  >
                    اعتماد وصرف
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
      {yarnIssues.some((i)=>i.status==="ISSUED")&&<div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><h3 className="mb-2 font-bold">عهد خيط مصروفة تنتظر المرتجع والهالك</h3><div className="flex flex-wrap gap-2">{yarnIssues.filter(i=>i.status==="ISSUED").map(i=><div key={i.id} className="rounded border bg-white p-2 text-sm">{i.issue_no} — {i.warpingOrderNo}<button className="mr-3 rounded bg-emerald-700 px-3 py-1 font-bold text-white" disabled={busy} onClick={()=>settleYarn(i)}>تسوية وإغلاق</button></div>)}</div></div>}
      <div className="mb-4 flex justify-between">
        <div>
          <h2 className="font-bold">أوامر التسدية وكروت السداء</h2>
          <p className="text-sm text-slate-500">يسمح بالسدى المشترك وربط أكثر من أوردر بالماكينة.</p>
        </div>
        {canManage && (
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white"
            onClick={() => setOpen(!open)}
          >
            أمر تسدية جديد
          </button>
        )}
      </div>
      {open && (
        <div className="mb-4 grid gap-2 rounded-xl border bg-slate-50 p-3 md:grid-cols-3">
          <select
            className={cls}
            value={form.workOrderId}
            onChange={(e) => {
              const w = options?.workOrders.find((x) => x.id === e.target.value);
              setForm({
                ...form,
                workOrderId: e.target.value,
                plannedLengthM: w ? String(w.target_length_m) : form.plannedLengthM,
              });
            }}
          >
            <option value="">أمر الإنتاج</option>
            {options?.workOrders.map((x) => (
              <option key={x.id} value={x.id}>
                {x.work_order_no}
              </option>
            ))}
          </select>
          <input
            className={cls}
            type="number"
            placeholder="الطول المخطط"
            value={form.plannedLengthM}
            onChange={(e) => setForm({ ...form, plannedLengthM: e.target.value })}
          />
          <select
            className={cls}
            value={form.warpingMachineId}
            onChange={(e) => setForm({ ...form, warpingMachineId: e.target.value })}
          >
            <option value="">ماكينة التسدية</option>
            {options?.machines
              .filter((x) => x.machine_type === "WARPING")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name}
                </option>
              ))}
          </select>
          <select
            className={cls}
            value={form.targetLoomId}
            onChange={(e) => setForm({ ...form, targetLoomId: e.target.value })}
          >
            <option value="">النول المستهدف</option>
            {options?.machines
              .filter((x) => x.machine_type === "LOOM")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name}
                </option>
              ))}
          </select>
          <select
            className={cls}
            value={form.operatorEmployeeId}
            onChange={(e) => setForm({ ...form, operatorEmployeeId: e.target.value })}
          >
            <option value="">عامل التسدية</option>
            {options?.employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.employee_code} — {x.full_name}
              </option>
            ))}
          </select>
          <select
            className={cls}
            value={form.shiftTypeId}
            onChange={(e) => setForm({ ...form, shiftTypeId: e.target.value })}
          >
            <option value="">الوردية</option>
            {options?.shifts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <input
            className={cls}
            type="number"
            placeholder="عدد الأربطة"
            value={form.tieCount}
            onChange={(e) => setForm({ ...form, tieCount: e.target.value })}
          />
          <input
            className={cls}
            placeholder="رقم المطواة"
            value={form.beamNo}
            onChange={(e) => setForm({ ...form, beamNo: e.target.value })}
          />
          <input
            className={cls}
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <button
            disabled={busy || !form.workOrderId || !form.plannedLengthM}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50"
            onClick={() => void create()}
          >
            حفظ المسودة
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm [&_th]:px-2 [&_td]:px-2">
          <thead>
            <tr className="border-b text-right text-slate-500">
              <th className="p-2">الأمر</th>
              <th>أمر الإنتاج</th>
              <th>الماكينة</th>
              <th>النول</th>
              <th>الطول</th>
              <th>العامل/الوردية</th>
              <th>الكارت</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-2 font-bold">{r.warping_order_no}</td>
                <td>{r.work_order_no}</td>
                <td>{r.machine_code || "—"}</td>
                <td>{r.loom_code || "—"}</td>
                <td>{r.actual_length_m ?? r.planned_length_m}</td>
                <td>
                  {r.operator_name || "—"}
                  <br />
                  <span className="text-xs text-slate-500">{r.shift_name || "—"}</span>
                </td>
                <td>
                  {r.card_no || "—"}
                  {r.card_no && (
                    <button className="mr-2 text-indigo-700 underline" onClick={() => void printCard(r)}>
                      طباعة ({r.print_count ?? 0})
                    </button>
                  )}
                </td>
                <td>{r.status}{r.output_beams.map(b=><div key={b.id} className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs">{b.beamNo} — {b.status}</div>)}</td>
                <td className="space-x-1 space-x-reverse whitespace-nowrap">
                  {canManage && r.status === "DRAFT" && (
                    <button
                      disabled={busy}
                      className={cls}
                      onClick={() => void run(() => releaseWarpingOrder(r.id, r.version))}
                    >
                      إصدار
                    </button>
                  )}
                  {canManage && r.status === "RELEASED" && (
                    <button
                      disabled={busy}
                      className={cls}
                      onClick={() => void run(() => transitionWarpingOrder(r.id, r.version, "IN_PROGRESS"))}
                    >
                      بدء
                    </button>
                  )}
                  {canManage && ["RELEASED", "IN_PROGRESS"].includes(r.status) && (
                    <button disabled={busy} className={cls} onClick={() => setIssueFor(r)}>
                      طلب خيط
                    </button>
                  )}
                  {canQuality && r.status === "IN_PROGRESS" && (
                    <button
                      disabled={busy}
                      className={cls}
                      onClick={() => {
                        setCompletion(r);
                        setCompletionLength(String(r.planned_length_m));
                        setCompletionQuality('ACCEPTED');
                        setCompletionNextStage('WEAVING');
                      }}
                    >
                      قبول وفحص
                    </button>
                  )}
                  {canManage && ["DRAFT", "RELEASED", "IN_PROGRESS"].includes(r.status) && (
                    <button
                      disabled={busy}
                      className={cls}
                      onClick={() => {
                        const reason = prompt("سبب الإلغاء");
                        if (reason) void run(() => transitionWarpingOrder(r.id, r.version, "CANCELLED", reason));
                      }}
                    >
                      إلغاء
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-8 text-center text-slate-500">لا توجد أوامر تسدية</p>}
      </div>
    </div>
  );
}
