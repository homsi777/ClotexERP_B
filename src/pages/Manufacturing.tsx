import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Factory, FileSpreadsheet, Gauge, Plus, RefreshCw, Upload, Wrench } from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import { changeManufacturingMachineStatus, createManufacturingMaintenance, getManufacturingMachineHistory, getManufacturingOverview, listDowntimeReasons, listManufacturingDepartments, listManufacturingMachines, listQualityDefects, saveDowntimeReason, saveManufacturingDepartment, saveManufacturingMachine, saveQualityDefect, previewManufacturingWorkbook, listManufacturingSpecifications, listManufacturingSpecificationVersions, importManufacturingSpecification, approveManufacturingSpecificationVersion, type DowntimeReason, type ManufacturingDepartment, type ManufacturingMachine, type ManufacturingSpecificationSummary, type ManufacturingSpecificationVersion, type ManufacturingWorkbookPreview, type WarpCardTemplatePreview, type ManufacturingOverview, type MachineStatus, type QualityDefect } from "../lib/api/manufacturingReferenceApi";
import { createManufacturingWorkOrder, listManufacturingWorkOrders, releaseManufacturingWorkOrder, transitionManufacturingWorkOrder, type ManufacturingWorkOrderPriority, type ManufacturingWorkOrderSummary } from "../lib/api/manufacturingWorkOrderApi";
import { WarpingOrdersPanel } from "../components/manufacturing/WarpingOrdersPanel";

type Tab = "machines" | "departments" | "downtime" | "defects" | "specifications" | "workOrders" | "warping";
const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
const primary = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50";
const statusColor: Record<MachineStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  STOPPED: "bg-amber-100 text-amber-800",
  MAINTENANCE: "bg-blue-100 text-blue-800",
  OUT_OF_SERVICE: "bg-rose-100 text-rose-800",
};

export const Manufacturing = () => {
  const { t } = useTranslation("manufacturing");
  const { has } = usePermissions();
  const [tab, setTab] = useState<Tab>("machines");
  const [overview, setOverview] = useState<ManufacturingOverview | null>(null);
  const [departments, setDepartments] = useState<ManufacturingDepartment[]>([]);
  const [machines, setMachines] = useState<ManufacturingMachine[]>([]);
  const [downtime, setDowntime] = useState<DowntimeReason[]>([]);
  const [defects, setDefects] = useState<QualityDefect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [selected, setSelected] = useState<ManufacturingMachine | null>(null);
  const [history, setHistory] = useState<any>(null);
  const canRef = has("manufacturing.reference.manage"),
    canMachines = has("manufacturing.machines.manage"),
    canMaint = has("manufacturing.maintenance.manage"),
    canQuality = has("manufacturing.quality.catalog.manage");
  const canSpecImport = has("manufacturing.specifications.import"),
    canSpecApprove = has("manufacturing.specifications.approve");
  const canWorkManage = has("manufacturing.work_orders.manage"),
    canWorkRelease = has("manufacturing.work_orders.release");
  const canWarpManage = has("manufacturing.warping.manage"),
    canWarpQuality = has("manufacturing.warping.quality"),
    canApproveYarn = has("manufacturing.yarn_issue.approve");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, d, m, r, q] = await Promise.all([getManufacturingOverview(), listManufacturingDepartments(), listManufacturingMachines(), listDowntimeReasons(), listQualityDefects()]);
      setOverview(o);
      setDepartments(d);
      setMachines(m);
      setDowntime(r);
      setDefects(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const cards = useMemo(
    () =>
      [
        [t("summary.machines"), overview?.machines ?? 0, Factory, "text-indigo-600 bg-indigo-50"],
        [t("summary.active"), overview?.active_machines ?? 0, Gauge, "text-emerald-600 bg-emerald-50"],
        [t("summary.unavailable"), overview?.unavailable_machines ?? 0, AlertTriangle, "text-amber-600 bg-amber-50"],
        [t("summary.openMaintenance"), overview?.open_maintenance ?? 0, Wrench, "text-rose-600 bg-rose-50"],
      ] as const,
    [overview, t],
  );
  const mayAdd = (tab === "machines" && canMachines) || (tab === "defects" && canQuality) || ((tab === "departments" || tab === "downtime") && canRef);
  const openHistory = async (m: ManufacturingMachine) => {
    setSelected(m);
    setHistory(null);
    try {
      setHistory(await getManufacturingMachineHistory(m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.load"));
    }
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("pageTitle")}</h1>
          <p className="mt-1 text-slate-500">{t("referenceSubtitle")}</p>
        </div>
        <button onClick={() => void load()} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-bold">
          <RefreshCw className="h-4 w-4" />
          {t("refresh")}
        </button>
      </header>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value, Icon, color]) => (
          <div key={label} className="flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm">
            <div className={`rounded-full p-3 ${color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">{label}</p>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 p-3">
          <div className="flex flex-wrap gap-2">
            {(["machines", "departments", "downtime", "defects", "specifications", "workOrders", "warping"] as Tab[]).map((x) => (
              <button
                key={x}
                onClick={() => {
                  setTab(x);
                  setFormOpen(false);
                }}
                className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === x ? "bg-indigo-600 text-white" : "border bg-white text-slate-700"}`}
              >
                {t(`tabs.${x}`)}
              </button>
            ))}
          </div>
          {mayAdd && (
            <button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className={`${primary} flex items-center gap-2`}
            >
              <Plus className="h-4 w-4" />
              {t("add")}
            </button>
          )}
        </div>
        {formOpen && (
          <ReferenceForm
            tab={tab}
            editing={editing}
            departments={departments}
            t={t}
            onCancel={() => setFormOpen(false)}
            onError={setError}
            onSaved={async () => {
              setFormOpen(false);
              await load();
            }}
          />
        )}
        <div className="overflow-x-auto">
          {tab === "specifications" ? (
            <WorkbookPreviewPanel t={t} canImport={canSpecImport} canApprove={canSpecApprove} />
          ) : tab === "workOrders" ? (
            <WorkOrdersPanel t={t} canManage={canWorkManage} canRelease={canWorkRelease} />
          ) : tab === "warping" ? (
            <WarpingOrdersPanel canManage={canWarpManage} canQuality={canWarpQuality} canApproveYarn={canApproveYarn} />
          ) : loading ? (
            <div className="p-12 text-center text-slate-500">{t("loading")}</div>
          ) : tab === "machines" ? (
            <MachinesTable
              rows={machines}
              t={t}
              canEdit={canMachines}
              onEdit={(m) => {
                setEditing(m);
                setFormOpen(true);
              }}
              onHistory={(m) => void openHistory(m)}
            />
          ) : tab === "departments" ? (
            <SimpleTable
              rows={departments}
              columns={["code", "name", "description", "is_active"]}
              onEdit={
                canRef
                  ? (x) => {
                      setEditing(x);
                      setFormOpen(true);
                    }
                  : undefined
              }
              t={t}
            />
          ) : tab === "downtime" ? (
            <SimpleTable
              rows={downtime}
              columns={["code", "name", "stage", "is_planned", "is_active"]}
              onEdit={
                canRef
                  ? (x) => {
                      setEditing(x);
                      setFormOpen(true);
                    }
                  : undefined
              }
              t={t}
            />
          ) : (
            <SimpleTable
              rows={defects}
              columns={["code", "name", "inspection_type", "default_severity", "description", "is_active"]}
              onEdit={
                canQuality
                  ? (x) => {
                      setEditing(x);
                      setFormOpen(true);
                    }
                  : undefined
              }
              t={t}
            />
          )}
        </div>
      </section>
      {selected && (
        <MachinePanel
          machine={selected}
          history={history}
          t={t}
          canStatus={canMachines}
          canMaintenance={canMaint}
          onError={setError}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            setSelected(null);
            await load();
          }}
        />
      )}
    </div>
  );
};

function WorkOrdersPanel({ t, canManage, canRelease }: { t: any; canManage: boolean; canRelease: boolean }) {
  const [rows, setRows] = useState<ManufacturingWorkOrderSummary[]>([]);
  const [specs, setSpecs] = useState<ManufacturingSpecificationSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{
    specificationVersionId: string;
    targetLengthM: string;
    priority: ManufacturingWorkOrderPriority;
    plannedStartDate: string;
    plannedEndDate: string;
    notes: string;
  }>({
    specificationVersionId: "",
    targetLengthM: "",
    priority: "NORMAL",
    plannedStartDate: "",
    plannedEndDate: "",
    notes: "",
  });
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [orders, library] = await Promise.all([listManufacturingWorkOrders(), listManufacturingSpecifications()]);
      setRows(orders);
      setSpecs(library.filter((x) => x.approved_version_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workOrders.loadError"));
    } finally {
      setBusy(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    const length = Number(form.targetLengthM);
    if (!form.specificationVersionId || !Number.isFinite(length) || length <= 0) return;
    setBusy(true);
    setError("");
    try {
      await createManufacturingWorkOrder({
        specificationVersionId: form.specificationVersionId,
        targetLengthM: length,
        priority: form.priority,
        plannedStartDate: form.plannedStartDate || null,
        plannedEndDate: form.plannedEndDate || null,
        notes: form.notes || null,
      });
      setShowForm(false);
      setForm({
        specificationVersionId: "",
        targetLengthM: "",
        priority: "NORMAL",
        plannedStartDate: "",
        plannedEndDate: "",
        notes: "",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workOrders.saveError"));
    } finally {
      setBusy(false);
    }
  };
  const action = async (row: ManufacturingWorkOrderSummary, target: "RELEASED" | "IN_PROGRESS" | "CANCELLED") => {
    let reason: string | null = null;
    if (target === "CANCELLED") {
      reason = window.prompt(t("workOrders.cancelReason"))?.trim() || null;
      if (!reason) return;
    }
    setBusy(true);
    setError("");
    try {
      if (target === "RELEASED") await releaseManufacturingWorkOrder(row.id, row.version);
      else await transitionManufacturingWorkOrder(row.id, target, row.version, reason);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workOrders.actionError"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 p-5">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="font-bold">{t("workOrders.title")}</h3>
          <p className="text-sm text-slate-500">{t("workOrders.subtitle")}</p>
        </div>
        {canManage && (
          <button className={primary} onClick={() => setShowForm((x) => !x)}>
            <Plus className="me-1 inline h-4 w-4" />
            {t("workOrders.new")}
          </button>
        )}
      </div>
      {showForm && (
        <div className="grid gap-3 rounded-lg border bg-indigo-50/40 p-4 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs font-bold">{t("workOrders.approvedSpec")}</span>
            <select className={input} value={form.specificationVersionId} onChange={(e) => setForm({ ...form, specificationVersionId: e.target.value })}>
              <option value="">—</option>
              {specs.map((s) => (
                <option key={s.id} value={s.approved_version_id ?? ""}>
                  {s.code} — {s.name} (v{s.approved_version_no})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">{t("workOrders.targetLength")}</span>
            <input type="number" min="0.001" step="0.001" className={input} value={form.targetLengthM} onChange={(e) => setForm({ ...form, targetLengthM: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">{t("workOrders.priority")}</span>
            <select
              className={input}
              value={form.priority}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority: e.target.value as ManufacturingWorkOrderPriority,
                })
              }
            >
              {["LOW", "NORMAL", "HIGH", "URGENT"].map((x) => (
                <option key={x} value={x}>
                  {t(`workOrders.priorityValue.${x}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">{t("workOrders.startDate")}</span>
            <input type="date" className={input} value={form.plannedStartDate} onChange={(e) => setForm({ ...form, plannedStartDate: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">{t("workOrders.endDate")}</span>
            <input type="date" className={input} value={form.plannedEndDate} onChange={(e) => setForm({ ...form, plannedEndDate: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">{t("workOrders.notes")}</span>
            <input className={input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="md:col-span-3 flex justify-end">
            <button disabled={busy || !form.specificationVersionId || Number(form.targetLengthM) <= 0} className={primary} onClick={() => void create()}>
              {t("save")}
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-800 text-white">
            <tr>
              {["number", "specification", "target", "allocated", "priority", "status", "dates", "actions"].map((x) => (
                <th key={x} className="px-3 py-2">
                  {t(`workOrders.columns.${x}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 font-mono font-bold">{row.work_order_no}</td>
                <td className="px-3 py-2">
                  {row.specification_code} — {row.specification_name} (v
                  {row.specification_version_no})
                </td>
                <td className="px-3 py-2">{row.target_length_m}</td>
                <td className="px-3 py-2">{row.allocated_length_m}</td>
                <td className="px-3 py-2">{t(`workOrders.priorityValue.${row.priority}`)}</td>
                <td className="px-3 py-2 font-bold">{t(`workOrders.status.${row.status}`)}</td>
                <td className="px-3 py-2">
                  {row.planned_start_date || "—"} → {row.planned_end_date || "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {canRelease && row.status === "DRAFT" && (
                      <button disabled={busy} onClick={() => void action(row, "RELEASED")} className="text-indigo-700 hover:underline">
                        {t("workOrders.release")}
                      </button>
                    )}
                    {canManage && row.status === "RELEASED" && (
                      <button disabled={busy} onClick={() => void action(row, "IN_PROGRESS")} className="text-emerald-700 hover:underline">
                        {t("workOrders.start")}
                      </button>
                    )}
                    {canManage && ["DRAFT", "RELEASED", "IN_PROGRESS"].includes(row.status) && (
                      <button disabled={busy} onClick={() => void action(row, "CANCELLED")} className="text-rose-700 hover:underline">
                        {t("workOrders.cancel")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!busy && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  {t("workOrders.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkbookPreviewPanel({ t, canImport, canApprove }: { t: any; canImport: boolean; canApprove: boolean }) {
  const [documentType, setDocumentType] = useState<"SPECIFICATION" | "WARP_CARD">("SPECIFICATION");
  const [preview, setPreview] = useState<ManufacturingWorkbookPreview | WarpCardTemplatePreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({
    code: "",
    name: "",
    description: "",
    notes: "",
  });
  const [library, setLibrary] = useState<ManufacturingSpecificationSummary[]>([]);
  const [versions, setVersions] = useState<ManufacturingSpecificationVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await listManufacturingSpecifications());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workbook.libraryError"));
    }
  }, [t]);
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);
  const selectSpecification = async (id: string) => {
    setSelectedId(id);
    setError("");
    try {
      setVersions(await listManufacturingSpecificationVersions(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workbook.libraryError"));
    }
  };
  const choose = async (chosen: File | undefined) => {
    if (!chosen) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setFile(chosen);
    try {
      setPreview(await previewManufacturingWorkbook(chosen, documentType));
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : t("workbook.error"));
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = async () => {
    if (!file || !("sheetNames" in (preview ?? {})) || !meta.code.trim() || !meta.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const saved = await importManufacturingSpecification(file, {
        code: meta.code,
        name: meta.name,
        description: meta.description || null,
        notes: meta.notes || null,
      });
      await refreshLibrary();
      await selectSpecification(saved.specificationId);
      setMeta({ ...meta, code: saved.code });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workbook.saveError"));
    } finally {
      setSaving(false);
    }
  };
  const approve = async (versionId: string) => {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    try {
      await approveManufacturingSpecificationVersion(selectedId, versionId);
      await refreshLibrary();
      await selectSpecification(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workbook.approveError"));
    } finally {
      setSaving(false);
    }
  };
  const specification = preview && "sheetNames" in preview ? preview : null;
  const card = preview && "logicalRecordCount" in preview ? preview : null;
  return (
    <div className="space-y-6 p-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="overflow-hidden rounded-lg border">
          <h3 className="border-b bg-slate-50 px-3 py-2 font-bold">{t("workbook.library")}</h3>
          {library.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">{t("workbook.noSpecifications")}</p>
          ) : (
            <div className="max-h-64 divide-y overflow-y-auto">
              {library.map((item) => (
                <button key={item.id} onClick={() => void selectSpecification(item.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-right text-sm hover:bg-slate-50 ${selectedId === item.id ? "bg-indigo-50" : ""}`}>
                  <span>
                    <b className="font-mono">{item.code}</b>
                    <span className="mx-2">{item.name}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    v{item.latest_version_no ?? 0} · {item.latest_status ? t(`workbook.status.${item.latest_status}`) : "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border">
          <h3 className="border-b bg-slate-50 px-3 py-2 font-bold">{t("workbook.versionHistory")}</h3>
          {!selectedId ? (
            <p className="p-4 text-sm text-slate-500">{t("workbook.selectSpecification")}</p>
          ) : versions.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">{t("workbook.noVersions")}</p>
          ) : (
            <div className="max-h-64 divide-y overflow-y-auto">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <b>v{v.version_no}</b>
                    <span className="mx-2">{t(`workbook.status.${v.status}`)}</span>
                    <span className="text-xs text-slate-500">{v.source_file_name}</span>
                  </div>
                  {canApprove && v.status !== "APPROVED" && (
                    <button disabled={saving} onClick={() => void approve(v.id)} className="text-indigo-700 hover:underline disabled:opacity-50">
                      {t("workbook.approve")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-bold">{t("workbook.documentType")}</span>
          <select
            value={documentType}
            onChange={(e) => {
              setDocumentType(e.target.value as "SPECIFICATION" | "WARP_CARD");
              setPreview(null);
              setFile(null);
            }}
            className={input}
          >
            <option value="SPECIFICATION">{t("workbook.specification")}</option>
            <option value="WARP_CARD">{t("workbook.warpCard")}</option>
          </select>
        </label>
        <label className={`${primary} inline-flex cursor-pointer items-center gap-2`}>
          <Upload className="h-4 w-4" />
          {busy ? t("workbook.reading") : t("workbook.choose")}
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
        </label>
        {file && <span className="text-sm text-slate-600">{file.name}</span>}
      </div>
      <p className="text-sm text-slate-500">{documentType === "SPECIFICATION" ? t("workbook.previewAndSave") : t("workbook.previewOnly")}</p>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {!preview && !busy && (
        <div className="rounded-xl border-2 border-dashed p-10 text-center text-slate-500">
          <FileSpreadsheet className="mx-auto mb-3 h-10 w-10" />
          <p>{t("workbook.empty")}</p>
        </div>
      )}
      {specification && (
        <div className="space-y-4">
          {canImport && (
            <div className="grid gap-3 rounded-lg border bg-indigo-50/40 p-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-bold">{t("workbook.specCode")}</span>
                <input className={input} value={meta.code} onChange={(e) => setMeta({ ...meta, code: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold">{t("workbook.specName")}</span>
                <input className={input} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold">{t("workbook.description")}</span>
                <input className={input} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold">{t("workbook.notes")}</span>
                <input className={input} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
              </label>
              <div className="md:col-span-2 flex justify-end">
                <button className={primary} disabled={saving || !meta.code.trim() || !meta.name.trim()} onClick={() => void saveDraft()}>
                  {saving ? t("saving") : t("workbook.saveDraft")}
                </button>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PreviewStat label={t("workbook.sheets")} value={specification.sheetNames.length} />
            <PreviewStat label={t("workbook.warpLines")} value={specification.warp?.pattern.length ?? 0} />
            <PreviewStat label={t("workbook.weftLines")} value={specification.weft?.pattern.length ?? 0} />
            <PreviewStat label={t("workbook.warnings")} value={specification.warnings.length} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PreviewTable title={t("workbook.technicalFields")} rows={Object.entries(specification.technicalFields).map(([label, value]) => [label, String(value)])} />
            <PreviewTable title={t("workbook.detectedSheets")} rows={Object.entries(specification.resolvedSheets)} />
          </div>
          <WarningList warnings={specification.warnings} t={t} />
        </div>
      )}
      {card && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <PreviewStat label={t("workbook.logicalRecords")} value={card.logicalRecordCount} />
            <PreviewStat label={t("workbook.printCopies")} value={card.printCopiesInTemplate} />
            <PreviewStat label={t("workbook.fields")} value={card.fields.length} />
          </div>
          <PreviewTable title={t("workbook.cardFields")} rows={card.fields.map((x) => [x.label, x.occurrences.join("، ") || t("workbook.missing")])} />
          {card.missingFields.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {t("workbook.missingFields")}: {card.missingFields.join("، ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
function PreviewTable({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <h3 className="border-b bg-slate-50 px-3 py-2 font-bold">{title}</h3>
      <div className="max-h-72 overflow-y-auto divide-y">
        {rows.map(([a, b], i) => (
          <div key={`${a}-${i}`} className="grid grid-cols-2 gap-2 px-3 py-2 text-sm">
            <span className="font-medium">{a}</span>
            <span className="text-slate-600">{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function WarningList({
  warnings,
  t,
}: {
  warnings: Array<{
    code: string;
    message: string;
    sheet?: string;
    cell?: string;
  }>;
  t: any;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-amber-200">
      <h3 className="border-b border-amber-200 bg-amber-50 px-3 py-2 font-bold text-amber-900">{t("workbook.validationWarnings")}</h3>
      {warnings.length === 0 ? (
        <p className="p-3 text-sm text-emerald-700">{t("workbook.noWarnings")}</p>
      ) : (
        <div className="divide-y">
          {warnings.map((w, i) => (
            <div key={`${w.code}-${w.sheet}-${w.cell}-${i}`} className="p-3 text-sm">
              <p className="font-bold text-amber-900">{w.code}</p>
              <p className="text-slate-700">{w.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MachinesTable({ rows, t, canEdit, onEdit, onHistory }: { rows: ManufacturingMachine[]; t: any; canEdit: boolean; onEdit: (x: ManufacturingMachine) => void; onHistory: (x: ManufacturingMachine) => void }) {
  return (
    <table className="w-full text-right text-sm">
      <thead className="bg-slate-800 text-white">
        <tr>
          {["code", "name", "type", "model", "department", "width", "location", "ownership", "currentOperation", "status", "actions"].map((x) => (
            <th key={x} className="px-4 py-3">
              {x === "currentOperation" ? "التشغيل الحالي" : t(`columns.${x}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((m) => (
          <tr key={m.id} className="hover:bg-slate-50">
            <td className="px-4 py-3 font-mono">{m.code}</td>
            <td className="px-4 py-3 font-bold">{m.name}</td>
            <td className="px-4 py-3">{t(`machineType.${m.machine_type}`)}</td>
            <td className="px-4 py-3">{[m.manufacturer, m.model].filter(Boolean).join(" — ") || "—"}</td>
            <td className="px-4 py-3">{m.department_name || "—"}</td>
            <td className="px-4 py-3">{m.width_cm ?? "—"}</td>
            <td className="px-4 py-3">{m.fixed_location || "—"}</td>
            <td className="px-4 py-3">
              {t(`ownership.${m.ownership_type}`)}
              {m.owner_name ? ` — ${m.owner_name}` : ""}
            </td>
            <td className="px-4 py-3">
              {m.current_operations.length
                ? m.current_operations.map((operation) => (
                    <div key={`${operation.orderNo}-${operation.status}`} className="mb-1 rounded bg-indigo-50 px-2 py-1 text-xs">
                      {operation.orderNo} — {operation.workOrderNo} — {operation.status}
                    </div>
                  ))
                : "—"}
            </td>
            <td className="px-4 py-3">
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusColor[m.operational_status]}`}>{t(`machineStatus.${m.operational_status}`)}</span>
            </td>
            <td className="px-4 py-3">
              <div className="flex gap-3">
                <button onClick={() => onHistory(m)} className="text-indigo-700 hover:underline">
                  {t("history")}
                </button>
                {canEdit && (
                  <button onClick={() => onEdit(m)} className="text-slate-700 hover:underline">
                    {t("edit")}
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SimpleTable({ rows, columns, onEdit, t }: { rows: any[]; columns: string[]; onEdit?: (x: any) => void; t: any }) {
  const display = (v: unknown) => (typeof v === "boolean" ? (v ? t("yes") : t("no")) : typeof v === "string" ? t(`enum.${v}`, { defaultValue: v }) : (v ?? "—"));
  return (
    <table className="w-full text-right text-sm">
      <thead className="bg-slate-800 text-white">
        <tr>
          {columns.map((c) => (
            <th key={c} className="px-4 py-3">
              {t(`columns.${c}`)}
            </th>
          ))}
          {onEdit && <th className="px-4 py-3">{t("columns.actions")}</th>}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50">
            {columns.map((c) => (
              <td key={c} className="px-4 py-3">
                {display(r[c])}
              </td>
            ))}
            {onEdit && (
              <td className="px-4 py-3">
                <button onClick={() => onEdit(r)} className="text-indigo-700 hover:underline">
                  {t("edit")}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReferenceForm({ tab, editing, departments, onCancel, onSaved, onError, t }: { tab: Tab; editing: any; departments: ManufacturingDepartment[]; onCancel: () => void; onSaved: () => void; onError: (x: string) => void; t: any }) {
  const [data, setData] = useState<any>(() =>
    editing
      ? {
          ...editing,
          isActive: editing.is_active,
          isPlanned: editing.is_planned,
          departmentId: editing.department_id,
          machineType: editing.machine_type,
          widthCm: editing.width_cm,
          fixedLocation: editing.fixed_location,
          manufacturer: editing.manufacturer,
          model: editing.model,
          serialNumber: editing.serial_number,
          manufactureYear: editing.manufacture_year,
          powerKw: editing.power_kw,
          ratedSpeed: editing.rated_speed,
          ratedSpeedUnit: editing.rated_speed_unit,
          technicalSpecs: editing.technical_specs,
          assetValue: editing.asset_value,
          assetCurrencyCode: editing.asset_currency_code,
          ownershipType: editing.ownership_type,
          ownerName: editing.owner_name,
          inspectionType: editing.inspection_type,
          defaultSeverity: editing.default_severity,
        }
      : {
          code: "",
          name: "",
          isActive: true,
          isPlanned: false,
          machineType: "LOOM",
          ownershipType: "COMPANY",
          stage: "ALL",
          inspectionType: "ALL",
          ratedSpeedUnit: null,
          technicalSpecs: {},
        },
  );
  const [saving, setSaving] = useState(false);
  const field = (key: string, label: string, type = "text") => (
    <label className="space-y-1">
      <span className="text-xs font-bold">{label}</span>
      <input
        type={type}
        value={data[key] ?? ""}
        onChange={(e) =>
          setData({
            ...data,
            [key]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value,
          })
        }
        className={input}
      />
    </label>
  );
  const specField = (key: string, label: string) => (
    <label className="space-y-1">
      <span className="text-xs font-bold">{label}</span>
      <input
        type="number"
        value={data.technicalSpecs?.[key] ?? ""}
        onChange={(e) =>
          setData({
            ...data,
            technicalSpecs: {
              ...data.technicalSpecs,
              [key]: e.target.value === "" ? "" : Number(e.target.value),
            },
          })
        }
        className={input}
      />
    </label>
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      const payload = { ...data, id: editing?.id, version: editing?.version };
      if (tab === "machines") await saveManufacturingMachine(payload);
      else if (tab === "departments") await saveManufacturingDepartment(payload);
      else if (tab === "downtime") await saveDowntimeReason(payload);
      else await saveQualityDefect(payload);
      await onSaved();
    } catch (x) {
      onError(x instanceof Error ? x.message : t("error.save"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="border-b bg-indigo-50/40 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        {field("code", t("form.code"))}
        {field("name", t("form.name"))}
        {tab === "departments" && field("description", t("form.description"))}
        {tab === "machines" && (
          <>
            <Select label={t("form.type")} value={data.machineType} values={["WARPING", "SIZING", "LOOM", "PROCESSING", "INSPECTION", "OTHER"]} onChange={(v) => setData({ ...data, machineType: v })} t={(x) => t(`machineType.${x}`)} />
            <label className="space-y-1">
              <span className="text-xs font-bold">{t("form.department")}</span>
              <select value={data.departmentId ?? ""} onChange={(e) => setData({ ...data, departmentId: e.target.value || null })} className={input}>
                <option value="">—</option>
                {departments
                  .filter((x) => x.is_active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            {field("fixedLocation", t("form.location"))}
            {field("manufacturer", t("form.manufacturer"))}
            {field("model", t("form.model"))}
            {field("serialNumber", t("form.serialNumber"))}
            {field("manufactureYear", t("form.manufactureYear"), "number")}
            {field("widthCm", t("form.width"), "number")}
            {field("powerKw", t("form.powerKw"), "number")}
            {field("ratedSpeed", t("form.ratedSpeed"), "number")}
            <Select label={t("form.ratedSpeedUnit")} value={data.ratedSpeedUnit ?? ""} values={["", "RPM", "PICKS_PER_MINUTE", "METERS_PER_MINUTE", "OTHER"]} onChange={(v) => setData({ ...data, ratedSpeedUnit: v || null })} t={(x) => t(`speedUnit.${x}`)} />
            {specField("shedCount", "عدد الدرق")}
            {specField("healdCount", "عدد النير")}
            {specField("reedCount", "عدد المشط")}
            {specField("reedWidthCm", "عرض المشط")}
            <Select
              label="المسنن"
              value={String(data.technicalSpecs?.gearTooth ?? "")}
              values={["", ...Array.from({ length: 100 }, (_, i) => String(i + 1))]}
              onChange={(v) =>
                setData({
                  ...data,
                  technicalSpecs: {
                    ...data.technicalSpecs,
                    gearTooth: v ? Number(v) : "",
                  },
                })
              }
            />
            <label className="space-y-1">
              <span className="text-xs font-bold">صورة نوع اللقية</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className={input}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 1024 * 1024) {
                    onError("حجم الصورة يجب ألا يتجاوز 1 ميغابايت");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    setData((old: any) => ({
                      ...old,
                      technicalSpecs: {
                        ...old.technicalSpecs,
                        sheddingTypeImage: String(reader.result),
                      },
                    }));
                  reader.readAsDataURL(file);
                }}
              />
              {editing?.has_shedding_type_image && <span className="text-xs text-emerald-700">توجد صورة محفوظة؛ اختيار صورة جديدة يستبدلها.</span>}
            </label>
            <Select label={t("form.ownership")} value={data.ownershipType} values={["COMPANY", "CUSTODY"]} onChange={(v) => setData({ ...data, ownershipType: v })} t={(x) => t(`ownership.${x}`)} />
            {data.ownershipType === "CUSTODY" && field("ownerName", t("form.owner"))}
            {field("assetValue", t("form.assetValue"), "number")}
            {field("assetCurrencyCode", t("form.currency"))}
            {field("notes", t("form.notes"))}
          </>
        )}
        {tab === "downtime" && (
          <>
            <Select label={t("form.stage")} value={data.stage} values={["ALL", "WARPING", "SIZING", "WEAVING", "PROCESSING", "INSPECTION"]} onChange={(v) => setData({ ...data, stage: v })} />
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" checked={data.isPlanned} onChange={(e) => setData({ ...data, isPlanned: e.target.checked })} />
              {t("form.planned")}
            </label>
          </>
        )}
        {tab === "defects" && (
          <>
            <Select label={t("form.inspectionType")} value={data.inspectionType} values={["ALL", "WARP_BEAM", "SIZED_BEAM", "RAW_FABRIC", "FINISHED_FABRIC"]} onChange={(v) => setData({ ...data, inspectionType: v })} />
            <Select label={t("form.severity")} value={data.defaultSeverity ?? ""} values={["", "MINOR", "MAJOR", "CRITICAL"]} onChange={(v) => setData({ ...data, defaultSeverity: v || null })} />
            {field("description", t("form.description"))}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">
          {t("cancel")}
        </button>
        <button disabled={saving} className={primary}>
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}

function Select({ label, value, values, onChange, t = (x: string) => x }: { label: string; value: string; values: string[]; onChange: (x: string) => void; t?: (x: string) => string }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-bold">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        {values.map((x) => (
          <option key={x || "empty"} value={x}>
            {x ? t(x) : "—"}
          </option>
        ))}
      </select>
    </label>
  );
}

function MachinePanel({ machine, history, canStatus, canMaintenance, onClose, onChanged, onError, t }: { machine: ManufacturingMachine; history: any; canStatus: boolean; canMaintenance: boolean; onClose: () => void; onChanged: () => void; onError: (x: string) => void; t: any }) {
  const [status, setStatus] = useState<MachineStatus>(machine.operational_status),
    [reason, setReason] = useState(""),
    [description, setDescription] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("error.save"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex justify-between border-b p-4">
          <div>
            <h2 className="font-bold">
              {machine.code} — {machine.name}
            </h2>
            <p className="text-sm text-slate-500">{t("history")}</p>
          </div>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="space-y-5 p-4">
          <div className="rounded-lg border p-3">
            <h3 className="mb-3 font-bold">{t("technicalSpecifications")}</h3>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 md:grid-cols-3">
              {[
                ["manufacturer", machine.manufacturer],
                ["model", machine.model],
                ["serialNumber", machine.serial_number],
                ["manufactureYear", machine.manufacture_year],
                ["width", machine.width_cm],
                ["powerKw", machine.power_kw],
                ["ratedSpeed", machine.rated_speed ? `${machine.rated_speed} ${machine.rated_speed_unit ? t(`speedUnit.${machine.rated_speed_unit}`) : ""}` : null],
              ].map(([key, value]) => (
                <div key={String(key)}>
                  <dt className="text-xs text-slate-500">{t(`form.${key}`)}</dt>
                  <dd className="font-medium">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
          {canStatus && (
            <div className="rounded-lg border p-3">
              <h3 className="mb-3 font-bold">{t("changeStatus")}</h3>
              <div className="grid gap-2 md:grid-cols-3">
                <select value={status} onChange={(e) => setStatus(e.target.value as MachineStatus)} className={input}>
                  {["ACTIVE", "STOPPED", "MAINTENANCE", "OUT_OF_SERVICE"].map((x) => (
                    <option key={x} value={x}>
                      {t(`machineStatus.${x}`)}
                    </option>
                  ))}
                </select>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("form.reason")} className={input} />
                <button disabled={busy || !reason.trim() || status === machine.operational_status} onClick={() => void run(() => changeManufacturingMachineStatus(machine.id, status, reason, machine.version))} className={primary}>
                  {t("apply")}
                </button>
              </div>
            </div>
          )}
          {canMaintenance && (
            <div className="rounded-lg border p-3">
              <h3 className="mb-3 font-bold">{t("addBreakdown")}</h3>
              <div className="flex gap-2">
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("form.description")} className={input} />
                <button
                  disabled={busy || !description.trim()}
                  onClick={() =>
                    void run(() =>
                      createManufacturingMaintenance(machine.id, {
                        eventType: "BREAKDOWN",
                        status: "OPEN",
                        occurredAt: new Date().toISOString(),
                        description,
                      }),
                    )
                  }
                  className={primary}
                >
                  {t("save")}
                </button>
              </div>
            </div>
          )}
          <History title={t("statusHistory")} rows={history?.statusEvents} render={(x: any) => `${t(`machineStatus.${x.old_status}`)} ← ${t(`machineStatus.${x.new_status}`)} — ${x.reason}`} t={t} />
          <History title={t("maintenanceHistory")} rows={history?.maintenanceEvents} render={(x: any) => `${x.description} — ${x.status}`} t={t} />
        </div>
      </div>
    </div>
  );
}
function History({ title, rows, render, t }: { title: string; rows: any[] | undefined; render: (x: any) => string; t: any }) {
  return (
    <div>
      <h3 className="mb-2 font-bold">{title}</h3>
      {!rows ? (
        <p>{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t("noData")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((x) => (
            <div key={x.id} className="rounded-lg bg-slate-50 p-2 text-sm">
              {render(x)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
