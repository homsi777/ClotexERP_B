import { useCallback, useEffect, useState } from "react";
import {
  addWeavingShiftLog,
  completeWeavingRun,
  createWeavingRun,
  getWeavingOptions,
  listWeavingRuns,
  startWeavingRun,
  type WeavingOptions,
  type WeavingRun,
} from "../../lib/api/manufacturingWeavingApi";
const cls = "rounded-lg border px-3 py-2 text-sm";
export function WeavingRunsPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<WeavingRun[]>([]),
    [options, setOptions] = useState<WeavingOptions | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [form, setForm] = useState({
      beamKey: "",
      loomId: "",
      operatorEmployeeId: "",
      shiftTypeId: "",
      openingCounter: "",
    });
  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([listWeavingRuns(), getWeavingOptions()]);
      setRows(r);
      setOptions(o);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل تشغيل النسج");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر التنفيذ");
    } finally {
      setBusy(false);
    }
  };
  const beams = [
    ...(options?.beams ?? []).map((x) => ({ ...x, type: "WARP" })),
    ...(options?.sizedBeams ?? []).map((x) => ({ ...x, type: "SIZED" })),
  ];
  return (
    <div className="p-4">
      {error && <div className="mb-3 bg-rose-50 p-3 text-rose-700">{error}</div>}
      <div className="mb-4 flex justify-between">
        <div>
          <h2 className="font-bold">تشغيل النسج وإنتاج الورديات</h2>
          <p className="text-sm text-slate-500">ربط المطواة بالنول والعامل والوردية والعداد والتوقفات.</p>
        </div>
        {canManage && (
          <button className="rounded bg-indigo-600 px-4 py-2 font-bold text-white" onClick={() => setOpen(!open)}>
            تشغيل نول جديد
          </button>
        )}
      </div>
      {open && (
        <div className="mb-4 grid gap-2 rounded border p-3 md:grid-cols-3">
          <select className={cls} value={form.beamKey} onChange={(e) => setForm({ ...form, beamKey: e.target.value })}>
            <option value="">المطواة</option>
            {beams.map((x) => (
              <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>
                {x.beam_no} — {x.type === "SIZED" ? "مصمغة" : "بدون تصميغ"} — {x.length_m}م
              </option>
            ))}
          </select>
          <select className={cls} value={form.loomId} onChange={(e) => setForm({ ...form, loomId: e.target.value })}>
            <option value="">النول</option>
            {options?.looms.map((x) => (
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
            <option value="">العامل</option>
            {options?.employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.full_name}
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
            placeholder="عداد البداية"
            value={form.openingCounter}
            onChange={(e) => setForm({ ...form, openingCounter: e.target.value })}
          />
          <button
            disabled={busy || !form.beamKey || !form.loomId}
            className="rounded bg-indigo-600 text-white disabled:opacity-50"
            onClick={() =>
              void run(async () => {
                const [type, beamId] = form.beamKey.split(":");
                await createWeavingRun({
                  beamType: type,
                  beamId,
                  loomId: form.loomId,
                  operatorEmployeeId: form.operatorEmployeeId || null,
                  shiftTypeId: form.shiftTypeId || null,
                  openingCounter: form.openingCounter ? Number(form.openingCounter) : null,
                });
                setOpen(false);
              })
            }
          >
            حفظ
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right">
              <th className="p-2">التشغيل</th>
              <th>أمر الإنتاج</th>
              <th>النول</th>
              <th>العامل/الوردية</th>
              <th>المخطط</th>
              <th>المنتج</th>
              <th>المتبقي</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-2 font-bold">{r.run_no}</td>
                <td>{r.work_order_no}</td>
                <td>{r.loom_code}</td>
                <td>
                  {r.operator_name || "—"} / {r.shift_name || "—"}
                </td>
                <td>{r.planned_length_m}</td>
                <td>{r.produced_length_m}</td>
                <td>{r.remaining_length_m}</td>
                <td>{r.status}</td>
                <td>
                  {canManage && r.status === "DRAFT" && (
                    <button className={cls} onClick={() => void run(() => startWeavingRun(r.id))}>
                      بدء
                    </button>
                  )}
                  {canManage && r.status === "IN_PROGRESS" && (
                    <><button
                      className={cls}
                      onClick={() => {
                        const start = Number(prompt("عداد بداية الوردية", String(r.current_counter ?? 0)));
                        const end = Number(prompt("عداد نهاية الوردية"));
                        const downtime = Number(prompt("دقائق التوقف", "0"));
                        if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(downtime))
                          void run(() =>
                            addWeavingShiftLog(r.id, {
                              productionDate: new Date().toISOString().slice(0, 10),
                              counterStart: start,
                              counterEnd: end,
                              downtimeMinutes: downtime,
                            }),
                          );
                      }}
                    >
                      تسجيل وردية
                    </button><button className={cls} onClick={()=>{const value=prompt("أطوال الرولات الناتجة مفصولة بفاصلة",String(r.produced_length_m));if(!value)return;const lengths=value.split(',').map(x=>Number(x.trim()));if(lengths.length&&lengths.every(x=>Number.isFinite(x)&&x>0))void run(()=>completeWeavingRun(r.id,lengths.map((lengthM,index)=>({rollNo:`${r.run_no}-R${index+1}`,lengthM}))));}}>إغلاق وإنتاج رولات</button></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-8 text-center text-slate-500">لا توجد تشغيلات نسج</p>}
      </div>
    </div>
  );
}
