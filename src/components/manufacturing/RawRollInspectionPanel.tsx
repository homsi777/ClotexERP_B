import { useCallback, useEffect, useState } from "react";
import { listFabricColors, type ApiFabricColor } from "../../lib/api/fabricColorsApi";
import { listFabricItems, type ApiFabricItem } from "../../lib/api/fabricItemsApi";
import { inspectRawRoll, listRawRollOutputs, type RawRollOutput } from "../../lib/api/manufacturingWeavingApi";
import { listLocations, listWarehouses, type ApiWarehouse, type ApiWarehouseLocation } from "../../lib/api/warehousesApi";
import type { QualityDefect } from "../../lib/api/manufacturingReferenceApi";

type Result = "ACCEPTED" | "CONDITIONAL" | "REJECTED";
type DefectLine = { defectId: string; positionM: string; quantity: string; severity: string; notes: string };
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const emptyDefect = (): DefectLine => ({ defectId: "", positionM: "", quantity: "1", severity: "", notes: "" });

export function RawRollInspectionPanel({ canManage, defects }: { canManage: boolean; defects: QualityDefect[] }) {
  const [rows, setRows] = useState<RawRollOutput[]>([]);
  const [items, setItems] = useState<ApiFabricItem[]>([]);
  const [colors, setColors] = useState<ApiFabricColor[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [locations, setLocations] = useState<ApiWarehouseLocation[]>([]);
  const [selected, setSelected] = useState<RawRollOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ result: "ACCEPTED" as Result, itemId: "", colorId: "", warehouseId: "", locationId: "", widthCm: "", actualWeightKg: "", gsm: "", grade: "A", notes: "", defects: [] as DefectLine[] });

  const load = useCallback(async () => {
    try {
      const [pending, itemResult, colorResult, warehouseResult] = await Promise.all([
        listRawRollOutputs(), listFabricItems({ status: "active", pageSize: 500 }),
        listFabricColors({ status: "active", pageSize: 500 }), listWarehouses({ status: "active" }),
      ]);
      setRows(pending); setItems(itemResult.data); setColors(colorResult.data); setWarehouses(warehouseResult); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل قائمة فحص الخام"); }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!form.warehouseId) { setLocations([]); return; }
    void listLocations(form.warehouseId).then(setLocations).catch(() => setLocations([]));
  }, [form.warehouseId]);

  const open = (roll: RawRollOutput) => {
    setSelected(roll);
    setForm({ result: "ACCEPTED", itemId: "", colorId: "", warehouseId: "", locationId: "", widthCm: "", actualWeightKg: "", gsm: "", grade: "A", notes: "", defects: [] });
  };
  const updateDefect = (index: number, patch: Partial<DefectLine>) => {
    const next = [...form.defects]; next[index] = { ...next[index], ...patch }; setForm({ ...form, defects: next });
  };
  const submit = async () => {
    if (!selected) return;
    if (form.result !== "REJECTED" && (!form.itemId || !form.warehouseId)) { setError("الصنف والمستودع مطلوبان عند قبول الرول أو قبوله بشروط"); return; }
    if (form.defects.some((x) => !x.defectId || Number(x.quantity) < 1)) { setError("أكمل نوع العيب والكمية في جميع أسطر العيوب"); return; }
    setBusy(true); setError("");
    try {
      await inspectRawRoll(selected.id, {
        result: form.result, itemId: form.result === "REJECTED" ? null : form.itemId,
        colorId: form.result === "REJECTED" ? null : form.colorId || null,
        warehouseId: form.result === "REJECTED" ? null : form.warehouseId,
        locationId: form.result === "REJECTED" ? null : form.locationId || null,
        widthCm: form.widthCm ? Number(form.widthCm) : null, actualWeightKg: form.actualWeightKg ? Number(form.actualWeightKg) : null,
        gsm: form.gsm ? Number(form.gsm) : null, grade: form.grade || null, notes: form.notes || null,
        defects: form.defects.map((x) => ({ defectId: x.defectId, positionM: x.positionM ? Number(x.positionM) : null, quantity: Number(x.quantity), severity: x.severity || null, notes: x.notes || null })),
      });
      setSelected(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر اعتماد نتيجة الفحص"); }
    finally { setBusy(false); }
  };

  return <div className="p-4">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">فحص واستلام أثواب النسيج الخام</h2><p className="text-sm text-slate-500">اعتماد نتيجة الفحص وتحويل المقبول فقط إلى مخزون الأثواب المتاحة.</p></div><button className="rounded-lg border bg-white px-3 py-2 text-sm font-bold" onClick={() => void load()}>تحديث</button></div>
    {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-right"><th className="p-2">الرول</th><th>دفعة الإنتاج</th><th>تشغيل النسج</th><th>النول</th><th>الطول</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id} className="border-b"><td className="p-2 font-bold">{r.roll_no}</td><td>{r.production_batch_no}</td><td>{r.run_no}</td><td>{r.loom_code}</td><td>{r.length_m} م</td><td><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">بانتظار الفحص</span></td><td>{canManage ? <button className="rounded-lg bg-indigo-600 px-3 py-2 font-bold text-white" onClick={() => open(r)}>فحص واعتماد</button> : "—"}</td></tr>)}</tbody></table>{!rows.length && <p className="p-10 text-center text-slate-500">لا توجد أثواب معلقة بانتظار الفحص.</p>}</div>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setSelected(null); }}><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <div className="mb-4 flex justify-between"><div><h3 className="text-lg font-bold">فحص الرول {selected.roll_no}</h3><p className="text-sm text-slate-500">الطول المنتج: {selected.length_m} م — {selected.production_batch_no}</p></div><button disabled={busy} onClick={() => setSelected(null)}>✕</button></div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">النتيجة<select className={field} value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value as Result })}><option value="ACCEPTED">مقبول</option><option value="CONDITIONAL">مقبول بشروط</option><option value="REJECTED">مرفوض</option></select></label>
        <label className="text-sm">العرض سم<input className={field} type="number" min="0" step="0.01" value={form.widthCm} onChange={(e) => setForm({ ...form, widthCm: e.target.value })} /></label>
        <label className="text-sm">الوزن الفعلي كغ<input className={field} type="number" min="0" step="0.001" value={form.actualWeightKg} onChange={(e) => setForm({ ...form, actualWeightKg: e.target.value })} /></label>
        <label className="text-sm">GSM<input className={field} type="number" min="0" step="0.01" value={form.gsm} onChange={(e) => setForm({ ...form, gsm: e.target.value })} /></label>
        <label className="text-sm">الدرجة<input className={field} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} /></label>
        {form.result !== "REJECTED" && <><label className="text-sm">الصنف<select className={field} value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}><option value="">اختر الصنف</option>{items.map((x) => <option key={x.id} value={x.id}>{x.internal_code} — {x.name}</option>)}</select></label><label className="text-sm">اللون<select className={field} value={form.colorId} onChange={(e) => setForm({ ...form, colorId: e.target.value })}><option value="">بدون لون</option>{colors.map((x) => <option key={x.id} value={x.id}>{x.color_code} — {x.name_ar}</option>)}</select></label><label className="text-sm">المستودع<select className={field} value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value, locationId: "" })}><option value="">اختر المستودع</option>{warehouses.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></label><label className="text-sm">الموقع<select className={field} value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}><option value="">بدون موقع</option>{locations.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></label></>}
        <label className="text-sm md:col-span-3">ملاحظات<textarea className={field} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      </div>
      <div className="mt-5 border-t pt-4"><div className="mb-3 flex justify-between"><h4 className="font-bold">العيوب المسجلة</h4><button className="rounded-lg border px-3 py-2 text-sm font-bold" onClick={() => setForm({ ...form, defects: [...form.defects, emptyDefect()] })}>إضافة عيب</button></div><div className="space-y-2">{form.defects.map((d, index) => <div key={index} className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-6"><select className={field} value={d.defectId} onChange={(e) => updateDefect(index,{defectId:e.target.value})}><option value="">نوع العيب</option>{defects.filter((x) => x.is_active && (x.inspection_type === "ALL" || x.inspection_type === "RAW_FABRIC")).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select><input className={field} type="number" min="0" placeholder="الموقع بالمتر" value={d.positionM} onChange={(e) => updateDefect(index,{positionM:e.target.value})} /><input className={field} type="number" min="1" placeholder="الكمية" value={d.quantity} onChange={(e) => updateDefect(index,{quantity:e.target.value})} /><select className={field} value={d.severity} onChange={(e) => updateDefect(index,{severity:e.target.value})}><option value="">الشدة الافتراضية</option><option value="MINOR">بسيط</option><option value="MAJOR">جسيم</option><option value="CRITICAL">حرج</option></select><input className={`${field} md:col-span-2`} placeholder="ملاحظة العيب" value={d.notes} onChange={(e) => updateDefect(index,{notes:e.target.value})} /><button className="text-sm font-bold text-rose-700" onClick={() => setForm({...form,defects:form.defects.filter((_,i)=>i!==index)})}>حذف العيب</button></div>)}</div></div>
      <div className="mt-5 flex justify-end gap-2"><button className="rounded-lg border px-4 py-2 font-bold" disabled={busy} onClick={() => setSelected(null)}>إلغاء</button><button className="rounded-lg bg-indigo-600 px-5 py-2 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void submit()}>{busy ? "جارٍ الاعتماد..." : "اعتماد نتيجة الفحص"}</button></div>
    </div></div>}
  </div>;
}
