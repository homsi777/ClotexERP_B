import { Link } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { QualityChecklist, type ChecklistRow } from './QualityChecklist';
import { listQualityInbox, type QualityInboxRow, type ProductionQualityReport } from '../../lib/api/manufacturingQualityApi';
import { ExternalQualityEntry } from './ExternalQualityEntry';
import { useCallback, useEffect, useState } from "react";
import {
  listFabricColors,
  type ApiFabricColor,
} from "../../lib/api/fabricColorsApi";
import {
  listFabricItems,
  type ApiFabricItem,
} from "../../lib/api/fabricItemsApi";
import type { QualityDefect } from "../../lib/api/manufacturingReferenceApi";
import {
  approveBatchInspection,
  getProductionQualityReport,
  listProductionBatches,
  receiveBatchRolls,
  saveBatchInspection,
  type ProductionBatch,
} from "../../lib/api/manufacturingQualityApi";
import {
  listLocations,
  listWarehouses,
  type ApiWarehouse,
  type ApiWarehouseLocation,
} from "../../lib/api/warehousesApi";
import { openDocumentPrintWindow } from "../../lib/printing/documentPrint";
import { renderProductionQualityReportHtml } from "../../lib/printing/renderProductionQualityReportHtml";

const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
type DefectLine = {
  defectId: string;
  positionM: string;
  quantity: string;
  severity: string;
  notes: string;
};
type RollLine = {
  rollNo: string;
  lengthM: string;
  widthCm: string;
  actualWeightKg: string;
  gsm: string;
};
const newDefect = (): DefectLine => ({
  defectId: "",
  positionM: "",
  quantity: "1",
  severity: "",
  notes: "",
});
const newRoll = (batchNo: string, index: number): RollLine => ({
  rollNo: `${batchNo}-R${index}`,
  lengthM: "",
  widthCm: "",
  actualWeightKg: "",
  gsm: "",
});

export function RawProductionQualityPanel({
  canInspect,
  canReceive,
  defects, batchId, receivingOnly = false, onChanged,
}: {
  canInspect: boolean;
  canReceive: boolean;
  defects: QualityDefect[]; batchId?: string; receivingOnly?: boolean; onChanged?: () => void;
}) {
  const { user: qualityUser } = usePermissions();
  const [rows, setRows] = useState<ProductionBatch[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [inspection, setInspection] = useState<ProductionBatch | null>(null),
    [receipt, setReceipt] = useState<ProductionBatch | null>(null);
  const [items, setItems] = useState<ApiFabricItem[]>([]),
    [colors, setColors] = useState<ApiFabricColor[]>([]),
    [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]),
    [locations, setLocations] = useState<ApiWarehouseLocation[]>([]);
  const [report, setReport] = useState<ProductionQualityReport | null>(null);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [quality, setQuality] = useState({
    clean: "",
    rework: "0",
    rejected: "0",
    pending: "0",
    notes: "",
    defects: [] as DefectLine[],
  });
  const [stock, setStock] = useState({
    itemId: "",
    colorId: "",
    warehouseId: "",
    locationId: "",
    notes: "",
    rolls: [] as RollLine[],
  });
  const load = useCallback(async () => {
    try {
      setRows((await listProductionBatches()).filter(b => !batchId || b.id === batchId));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل دفعات الجودة");
    }
  }, [batchId]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!batchId || !rows.length) return;
    let active = true;
    getProductionQualityReport(batchId).then(value => { if (active) setReport(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [batchId, rows]);
  useEffect(() => {
    if (!stock.warehouseId) {
      setLocations([]);
      return;
    }
    void listLocations(stock.warehouseId)
      .then(setLocations)
      .catch(() => setLocations([]));
  }, [stock.warehouseId]);

  const openInspection = async (batch: ProductionBatch) => {
    setBusy(true); setError('');
    try {
      const saved = await getProductionQualityReport(batch.id);
      const b = saved.batch;
      setReport(saved);
      setChecklist(b.quality_checklist ?? []);
      setQuality({
        clean: String(b.status === 'PENDING_INSPECTION' ? b.produced_length_m : b.clean_length_m),
        rework: String(b.rework_length_m), rejected: String(b.rejected_length_m),
        pending: String(b.status === 'PENDING_INSPECTION' ? 0 : b.pending_length_m), notes: b.inspection_notes ?? '',
        defects: saved.defects.map(d => ({defectId: String(d.defect_id), positionM: d.position_m == null ? '' : String(d.position_m),quantity: String(d.quantity),severity: d.severity == null ? '' : String(d.severity),notes: d.notes == null ? '' : String(d.notes)})),
      });
      setInspection(b);
    } catch(e) {setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false);}
  };
  const openReceipt = async (batch: ProductionBatch) => {
    setBusy(true);
    setError("");
    try {
      const [itemResult, colorResult, warehouseResult] = await Promise.all([
        listFabricItems({ status: "active", pageSize: 500 }),
        listFabricColors({ status: "active", pageSize: 500 }),
        listWarehouses({ status: "active" }),
      ]);
      setItems(itemResult.data);
      setColors(colorResult.data);
      setWarehouses(warehouseResult);
      setReceipt(batch);
      setStock({
        itemId: "",
        colorId: "",
        warehouseId: "",
        locationId: "",
        notes: "",
        rolls: [newRoll(batch.batch_no, 1)],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل خيارات المخزون");
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: () => Promise<unknown>, close: () => void) => {
    setBusy(true);
    setError("");
    try {
      await action();
      close();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية");
    } finally {
      setBusy(false);
    }
  };
  const printReport = async (batch: ProductionBatch) => {
    setBusy(true);
    setError("");
    try {
      const report = await getProductionQualityReport(batch.id);
      if (
        !openDocumentPrintWindow(
          renderProductionQualityReportHtml(report),
          `تقرير جودة ${batch.batch_no}`,
        )
      )
        setError("تعذر فتح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة لهذا الموقع");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إنشاء تقرير الجودة");
    } finally {
      setBusy(false);
    }
  };
  const qualityTotal =
    Number(quality.clean || 0) +
    Number(quality.rework || 0) +
    Number(quality.rejected || 0) +
    Number(quality.pending || 0);
  const rollTotal = stock.rolls.reduce(
    (sum, roll) => sum + Number(roll.lengthM || 0),
    0,
  );
  const updateDefect = (index: number, patch: Partial<DefectLine>) => {
    const next = [...quality.defects];
    next[index] = { ...next[index], ...patch };
    setQuality({ ...quality, defects: next });
  };
  const updateRoll = (index: number, patch: Partial<RollLine>) => {
    const next = [...stock.rolls];
    next[index] = { ...next[index], ...patch };
    setStock({ ...stock, rolls: next });
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-bold">جودة دفعات إنتاج النسج</h2>
          <p className="text-sm text-slate-500">
            تصنيف إجمالي الوردية أولاً، ثم اعتماد الجودة، ثم إدخال الرولات
            الفعلية للمخزون.
          </p>
        </div>
        <button
          className="rounded-lg border px-3 py-2 text-sm font-bold"
          onClick={() => void load()}
        >
          تحديث
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      {batchId && report && <section className="mb-4 space-y-2 rounded border p-3" aria-label="تفاصيل فحص الخام">
        <p>المصدر: {report.batch.work_order_no} / {report.batch.run_no} / {report.batch.batch_no}</p>
        <p>الفاحص: {String(report.batch.inspector_name ?? 'لم يفحص')} {String(report.batch.inspected_at ?? '')} — المعتمد: {String(report.batch.approver_name ?? 'لم يعتمد')} {String(report.batch.approved_at ?? '')}</p>
        <QualityChecklist value={report.batch.quality_checklist ?? []} onChange={() => undefined} disabled/>
        {report.defects.map((d,i) => <p key={i}>{String(d.code)} — {String(d.name)} / {String(d.severity ?? '—')} / {String(d.quantity)} / {String(d.notes ?? '')}</p>)}
      </section>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right">
              <th className="p-2">الدفعة</th>
              <th>الأمر/التشغيل</th>
              <th>الماكينة والوردية</th>
              <th>الإنتاج</th>
              <th>النظيف</th>
              <th>المعالجة/الهالك/المعلق</th>
              <th>الرولات المدخلة</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-b align-top">
                <td className="p-2 font-bold">
                  {b.batch_no}
                  <div className="text-xs font-normal text-slate-500">
                    {b.production_date}
                  </div>
                </td>
                <td>
                  {b.work_order_no}
                  <div className="text-xs text-slate-500">{b.run_no}</div>
                </td>
                <td>
                  {b.loom_code}
                  <div className="text-xs text-slate-500">
                    {b.shift_name || "—"} / {b.operator_name || "—"}
                  </div>
                </td>
                <td>{b.produced_length_m} م</td>
                <td>{b.clean_length_m} م</td>
                <td>
                  {b.rework_length_m} / {b.rejected_length_m} /{" "}
                  {b.pending_length_m}
                </td>
                <td>
                  {b.received_roll_length_m} م
                  <div className="text-xs text-slate-500">
                    فرق{" "}
                    {Math.max(
                      0,
                      Number(b.clean_length_m) -
                        Number(b.received_roll_length_m),
                    ).toFixed(3)}{" "}
                    م
                  </div>
                </td>
                <td>{b.status}</td>
                <td className="space-x-1 space-x-reverse">
                  <button
                    className="rounded border px-2 py-1"
                    disabled={busy}
                    onClick={() => void printReport(b)}
                  >
                    طباعة التقرير
                  </button>
                  {!receivingOnly && canInspect && !["APPROVED", "CLOSED"].includes(b.status) && (
                    <button
                      className="rounded border px-2 py-1"
                      disabled={busy}
                      onClick={() => void openInspection(b)}
                    >
                      تسجيل الفحص
                    </button>
                  )}
                  {!receivingOnly && (canInspect || qualityUser?.role === "accountant") && b.status === "INSPECTED" && (Number(b.rejected_length_m) === 0 || (["admin","accountant"].includes(qualityUser?.role ?? "") && b.inspected_by_user_id !== qualityUser?.id)) && (
                    <button
                      className="rounded bg-emerald-600 px-2 py-1 text-white"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => approveBatchInspection(b.id),
                          () => undefined,
                        )
                      }
                    >
                      اعتماد
                    </button>
                  )}
                  {canReceive &&
                    ["APPROVED", "CLOSED"].includes(b.status) &&
                    Number(b.received_roll_length_m) <
                      Number(b.clean_length_m) && (
                      <button
                        className="rounded bg-indigo-600 px-2 py-1 text-white"
                        onClick={() => void openReceipt(b)}
                      >
                        إدخال رولات
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-10 text-center text-slate-500">
            لا توجد دفعات إنتاج مسجلة.
          </p>
        )}
      </div>

      {inspection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5">
            <h3 className="mb-1 text-lg font-bold">
              فحص الدفعة {inspection.batch_no}
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              إجمالي الإنتاج: {inspection.produced_length_m} م
            </p>
            {report && <p className="mb-3 text-sm">الفاحص: {String(report.batch.inspector_name ?? 'لم يفحص')} — المعتمد: {String(report.batch.approver_name ?? 'لم يعتمد')}</p>}
            <QualityChecklist value={checklist} onChange={setChecklist} disabled={busy}/>
            <div className="grid gap-3 md:grid-cols-4">
              {(
                [
                  ["نظيف مقبول", "clean"],
                  ["فرز أو معالجة", "rework"],
                  ["مرفوض أو هالك", "rejected"],
                  ["معلق", "pending"],
                ] as const
              ).map(([label, key]) => (
                <label key={key} className="text-sm">
                  {label}
                  <input
                    className={input}
                    type="number"
                    min="0"
                    step="0.001"
                    value={quality[key]}
                    onChange={(e) =>
                      setQuality({ ...quality, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <div
              className={`mt-3 rounded-lg p-3 text-sm font-bold ${Math.abs(qualityTotal - Number(inspection.produced_length_m)) < 0.0005 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
            >
              المجموع: {qualityTotal.toFixed(3)} م — الفرق:{" "}
              {(Number(inspection.produced_length_m) - qualityTotal).toFixed(3)}{" "}
              م
            </div>
            <label className="mt-3 block text-sm">
              ملاحظات
              <textarea
                className={input}
                rows={2}
                value={quality.notes}
                onChange={(e) =>
                  setQuality({ ...quality, notes: e.target.value })
                }
              />
            </label>
            <div className="mt-4 border-t pt-3">
              <div className="mb-2 flex justify-between">
                <b>العيوب</b>
                <button
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() =>
                    setQuality({
                      ...quality,
                      defects: [...quality.defects, newDefect()],
                    })
                  }
                >
                  إضافة عيب
                </button>
              </div>
              {quality.defects.map((d, i) => (
                <div
                  key={i}
                  className="mb-2 grid gap-2 rounded bg-slate-50 p-2 md:grid-cols-5"
                >
                  <select
                    className={input}
                    value={d.defectId}
                    onChange={(e) =>
                      updateDefect(i, { defectId: e.target.value })
                    }
                  >
                    <option value="">نوع العيب</option>
                    {defects
                      .filter(
                        (x) =>
                          x.is_active &&
                          (x.inspection_type === "ALL" ||
                            x.inspection_type === "RAW_FABRIC"),
                      )
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code} — {x.name}
                        </option>
                      ))}
                  </select>
                  <input aria-label="ملاحظات العيب" className={input} value={d.notes} onChange={e => updateDefect(i,{notes:e.target.value})}/>
                  <input
                    className={input}
                    type="number"
                    placeholder="الموقع م"
                    value={d.positionM}
                    onChange={(e) =>
                      updateDefect(i, { positionM: e.target.value })
                    }
                  />
                  <input
                    className={input}
                    type="number"
                    min="1"
                    placeholder="العدد"
                    value={d.quantity}
                    onChange={(e) =>
                      updateDefect(i, { quantity: e.target.value })
                    }
                  />
                  <select
                    className={input}
                    value={d.severity}
                    onChange={(e) =>
                      updateDefect(i, { severity: e.target.value })
                    }
                  >
                    <option value="">الدرجة</option>
                    <option value="MINOR">بسيط</option>
                    <option value="MAJOR">متوسط/جسيم</option>
                    <option value="CRITICAL">حرج</option>
                  </select>
                  <button
                    className="text-rose-700"
                    onClick={() =>
                      setQuality({
                        ...quality,
                        defects: quality.defects.filter((_, x) => x !== i),
                      })
                    }
                  >
                    حذف
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2"
                disabled={busy}
                onClick={() => setInspection(null)}
              >
                إلغاء
              </button>
              <button
                className="rounded bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                disabled={
                  busy ||
                  Math.abs(
                    qualityTotal - Number(inspection.produced_length_m),
                  ) >= 0.0005 ||
                  quality.defects.some((d) => !d.defectId)
                }
                onClick={() =>
                  void run(
                    () =>
                      saveBatchInspection(inspection.id, {
                        checklist,
                        cleanLengthM: Number(quality.clean),
                        reworkLengthM: Number(quality.rework),
                        rejectedLengthM: Number(quality.rejected),
                        pendingLengthM: Number(quality.pending),
                        notes: quality.notes || null,
                        defects: quality.defects.map((d) => ({
                          defectId: d.defectId,
                          positionM: d.positionM ? Number(d.positionM) : null,
                          quantity: Number(d.quantity),
                          severity: d.severity || null,
                          notes: d.notes || null,
                        })),
                      }),
                    () => setInspection(null),
                  )
                }
              >
                حفظ الفحص
              </button>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5">
            <h3 className="text-lg font-bold">
              إدخال رولات الدفعة {receipt.batch_no}
            </h3>
            <p className="mb-4 text-sm text-slate-500">
              المتاح للإدخال:{" "}
              {(
                Number(receipt.clean_length_m) -
                Number(receipt.received_roll_length_m)
              ).toFixed(3)}{" "}
              م
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-sm">
                الصنف
                <select
                  className={input}
                  value={stock.itemId}
                  onChange={(e) =>
                    setStock({ ...stock, itemId: e.target.value })
                  }
                >
                  <option value="">اختر</option>
                  {items.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.internal_code} — {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                اللون
                <select
                  className={input}
                  value={stock.colorId}
                  onChange={(e) =>
                    setStock({ ...stock, colorId: e.target.value })
                  }
                >
                  <option value="">بدون لون</option>
                  {colors.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.color_code} — {x.name_ar}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                المستودع
                <select
                  className={input}
                  value={stock.warehouseId}
                  onChange={(e) =>
                    setStock({
                      ...stock,
                      warehouseId: e.target.value,
                      locationId: "",
                    })
                  }
                >
                  <option value="">اختر</option>
                  {warehouses.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} — {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                الموقع
                <select
                  className={input}
                  value={stock.locationId}
                  onChange={(e) =>
                    setStock({ ...stock, locationId: e.target.value })
                  }
                >
                  <option value="">بدون موقع</option>
                  {locations.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} — {x.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4">
              <div className="mb-2 flex justify-between">
                <b>الرولات الفعلية</b>
                <button
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() =>
                    setStock({
                      ...stock,
                      rolls: [
                        ...stock.rolls,
                        newRoll(receipt.batch_no, stock.rolls.length + 1),
                      ],
                    })
                  }
                >
                  إضافة رول
                </button>
              </div>
              {stock.rolls.map((roll, i) => (
                <div
                  key={i}
                  className="mb-2 grid gap-2 rounded bg-slate-50 p-2 md:grid-cols-6"
                >
                  <input
                    className={input}
                    placeholder="رقم الرول"
                    value={roll.rollNo}
                    onChange={(e) => updateRoll(i, { rollNo: e.target.value })}
                  />
                  <input
                    className={input}
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="الطول م"
                    value={roll.lengthM}
                    onChange={(e) => updateRoll(i, { lengthM: e.target.value })}
                  />
                  <input
                    className={input}
                    type="number"
                    min="0"
                    placeholder="العرض سم"
                    value={roll.widthCm}
                    onChange={(e) => updateRoll(i, { widthCm: e.target.value })}
                  />
                  <input
                    className={input}
                    type="number"
                    min="0"
                    placeholder="الوزن كغ"
                    value={roll.actualWeightKg}
                    onChange={(e) =>
                      updateRoll(i, { actualWeightKg: e.target.value })
                    }
                  />
                  <input
                    className={input}
                    type="number"
                    min="0"
                    placeholder="GSM"
                    value={roll.gsm}
                    onChange={(e) => updateRoll(i, { gsm: e.target.value })}
                  />
                  <button
                    className="text-rose-700"
                    onClick={() =>
                      setStock({
                        ...stock,
                        rolls: stock.rolls.filter((_, x) => x !== i),
                      })
                    }
                  >
                    حذف
                  </button>
                </div>
              ))}
            </div>
            <div className="rounded bg-slate-100 p-3 text-sm font-bold">
              مجموع هذه الدفعة: {rollTotal.toFixed(3)} م — الفرق المتبقي بعد
              الحفظ:{" "}
              {(
                Number(receipt.clean_length_m) -
                Number(receipt.received_roll_length_m) -
                rollTotal
              ).toFixed(3)}{" "}
              م
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2"
                disabled={busy}
                onClick={() => setReceipt(null)}
              >
                إلغاء
              </button>
              <button
                className="rounded bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                disabled={
                  busy ||
                  !stock.itemId ||
                  !stock.warehouseId ||
                  !stock.rolls.length ||
                  stock.rolls.some(
                    (r) => !r.rollNo || Number(r.lengthM) <= 0,
                  ) ||
                  rollTotal >
                    Number(receipt.clean_length_m) -
                      Number(receipt.received_roll_length_m) +
                      0.0005
                }
                onClick={() =>
                  void run(
                    () =>
                      receiveBatchRolls(receipt.id, {
                        itemId: stock.itemId,
                        colorId: stock.colorId || null,
                        warehouseId: stock.warehouseId,
                        locationId: stock.locationId || null,
                        notes: stock.notes || null,
                        rolls: stock.rolls.map((r) => ({
                          rollNo: r.rollNo,
                          lengthM: Number(r.lengthM),
                          widthCm: r.widthCm ? Number(r.widthCm) : null,
                          actualWeightKg: r.actualWeightKg
                            ? Number(r.actualWeightKg)
                            : null,
                          gsm: r.gsm ? Number(r.gsm) : null,
                        })),
                      }),
                    () => setReceipt(null),
                  )
                }
              >
                حفظ وإصدار الباركود
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Warehouse adapter reuses the authoritative batch receipt and its existing roll editor.
// Parent can mount at /inventory/create?productionBatchId=... without a second posting path.
export function ManufacturingRawReceiptAdapter({batchId}:{batchId:string}) {
  return <RawProductionQualityPanel batchId={batchId} canInspect={false} canReceive defects={[]} receivingOnly/>;
}
export function ProductionQualityPanel(props: {canInspect:boolean;canReceive:boolean;defects:QualityDefect[]}) {
  const {user,has}=usePermissions();
  const [rows,setRows]=useState<QualityInboxRow[]>([]),[selected,setSelected]=useState<QualityInboxRow|null>(null);
  const [error,setError]=useState(''),[search,setSearch]=useState(''),[kind,setKind]=useState('ALL'),[pending,setPending]=useState(true);
  const load=useCallback(async()=>{try{setRows(await listQualityInbox());setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}},[]);
  useEffect(()=>{void load();},[load]);
  const filtered=rows.filter(r=>(kind==='ALL'||r.kind===kind)&&(!pending||['PENDING_INSPECTION','INSPECTED','APPROVED','QUALITY_HOLD'].includes(r.status))&&`${r.source_no} ${r.status} ${r.id} ${r.order_refs.map(o=>`${o.customer_order_id??''} ${o.customer_order_line_id??''}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <section dir="rtl" className="space-y-4">
    <h2 className="font-bold">صندوق جودة الإنتاج — خام وجاهز</h2>
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="بحث الجودة" placeholder="المصدر أو مرجع الطلب" className={input} value={search} onChange={e=>setSearch(e.target.value)}/>
      <select aria-label="نوع الجودة" className="rounded border p-2" value={kind} onChange={e=>setKind(e.target.value)}><option value="ALL">الكل</option><option value="RAW">خام</option><option value="FINISHED">جاهز / تجهيز خارجي</option></select>
      <label><input type="checkbox" checked={pending} onChange={e=>setPending(e.target.checked)}/> بانتظار إجراء</label>
      <button className="rounded border p-2" onClick={()=>void load()}>تحديث</button>
    </div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['النوع','المصدر','الكمية م','الحالة','مراجع أسطر الطلب','التفاصيل'].map(h=><th className="p-2 text-right" key={h}>{h}</th>)}</tr></thead><tbody>
      {filtered.map(r=><tr key={`${r.kind}:${r.id}`} className="border-t"><td>{r.kind==='RAW'?'خام':'جاهز'}</td><td>{r.source_no}</td><td>{r.length_m}</td><td>{r.status}</td><td className="max-w-xs break-all text-xs">{r.order_refs.map((o,i)=><div key={i}>{o.customer_order_id??'مخزون'} / {o.customer_order_line_id??'—'}</div>)}</td><td><button className="rounded border p-2" onClick={()=>setSelected(r)}>عرض / إجراء</button></td></tr>)}
    </tbody></table>{!filtered.length&&<p className="p-6">لا توجد سجلات مطابقة.</p>}</div>
    {selected&&<><button className="rounded border p-2" onClick={()=>setSelected(null)}>إغلاق التفاصيل</button>
      {selected.kind==='RAW'?<div key={selected.id}>
        <Link className="text-indigo-700" to={`/inventory/create?productionBatchId=${selected.id}`}>استلام الخام في المستودع</Link>
        <RawProductionQualityPanel {...props} batchId={selected.id} onChanged={()=>void load()}/>
      </div>:<ExternalQualityEntry key={selected.id} id={selected.id} defects={props.defects} canInspect={props.canInspect||has('inventory.manage')} canApprove={user?.role==='admin'||user?.role==='accountant'} onChanged={()=>void load()}/>}</>}
  </section>;
}
