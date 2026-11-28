import { ExternalOrderLinePicker } from '../../components/purchases/ExternalOrderLinePicker';
import { ExternalBulkOrderLink, type BulkLinkRef } from '../../components/purchases/ExternalBulkOrderLink';
import type { ExternalLineReference } from '../../lib/api/externalJobsApi';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Droplet, Layers, Loader2, Scissors, Search, Settings, X } from 'lucide-react';
import {
  createProcessingExternalJob,
  listPreparationTypes,
  type PreparationType,
  type FabricStage,
} from '../../lib/api/externalJobsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listFabricRolls, type FabricRollDto } from '../../lib/api/fabricRollsApi';
import { useToast } from '../../components/NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';
import { PreparationTypesModal } from '../../components/purchases/PreparationTypesModal';
import { BulkBarcodeModal } from '../../components/inventory/BulkBarcodeModal';
import { ROLL_STATUS_REASON, type BulkRules } from '../../lib/bulkBarcode';

type SelectedRoll = FabricRollDto;

export const ExternalJobProcessingNew = () => {
  const { t: lifecycleT, i18n: lifecycleI18n } = useTranslation('externalJobs');
  const { t } = useTranslation('externalJobs');
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const manufacturing=query.get('from')==='manufacturing';
  const back=manufacturing?'/manufacturing?section=external':'/purchases/external-jobs';
  const [previousJobId, setPreviousJobId] = useState(query.get('previousJobId') || '');
  const { showToast } = useToast();

  const [fabricStage, setFabricStage] = useState<FabricStage | null>(null);

  const [prepTypes, setPrepTypes] = useState<PreparationType[]>([]);
  const [preparationTypeId, setPreparationTypeId] = useState('');
  const [prepManageOpen, setPrepManageOpen] = useState(false);

  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');

  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');

  const [processDescription, setProcessDescription] = useState('');
  const [notes, setNotes] = useState('');

  const [rollQuery, setRollQuery] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rollResults, setRollResults] = useState<FabricRollDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRolls, setSelectedRolls] = useState<SelectedRoll[]>([]);
  const [saving, setSaving] = useState(false);
  const [references, setReferences] = useState<Record<string, ExternalLineReference>>({});
  const [traceabilityOnly, setTraceabilityOnly] = useState(false);
  /** الربط الجماعي: أتواب محددة بالمربعات، وتسميات الأوردر المطبّقة للعرض. */
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [linkLabels, setLinkLabels] = useState<Record<string, string>>({});
  /** الورقة العامة: العرض ووزن المتر المربع خام/محضّر (اختياري). */
  const [rawWidth, setRawWidth] = useState('');
  const [finishedWidth, setFinishedWidth] = useState('');
  const [rawGsm, setRawGsm] = useState('');
  const [finishedGsm, setFinishedGsm] = useState('');

  const loadPrepTypes = async () => {
    try {
      const res = await listPreparationTypes();
      setPrepTypes(res.data);
    } catch {
      setPrepTypes([]);
    }
  };

  useEffect(() => {
    void loadPrepTypes();
    // عام لكل الموردين — ليس محصوراً بمن عُلِّم "جهة تجهيز" فقط؛ الفحص الدقيق
    // (هل هذا المورد جهة تجهيز فعلاً) يبقى عند الحفظ على الخادم كما هو.
    listSuppliers({ status: 'active', pageSize: 500 }).then((r) => setSuppliers(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    listWarehouses({ status: 'active' }).then((rows) => setWarehouses(rows)).catch(() => setWarehouses([]));
  }, []);

  // عام لكل المستودعات — لم يعد مقصوراً على المستودعات المصنَّفة بنفس مرحلة
  // الخامة المختارة؛ المطابقة الدقيقة تبقى تُفحَص عند الحفظ على الخادم.
  const matchingWarehouses = warehouses;

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLocaleLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLocaleLowerCase().includes(q));
  }, [suppliers, supplierSearch]);

  useEffect(() => {
    const q = rollQuery.trim();
    if (!q || !sourceWarehouseId) {
      setRollResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      listFabricRolls({ search: q, warehouseId: sourceWarehouseId, status: previousJobId ? undefined : 'AVAILABLE', pageSize: 25 })
        .then((res) => { if (!cancelled) setRollResults(res.data.filter(r => r.status === 'AVAILABLE' || (!!previousJobId && r.status === 'DAMAGED'))); })
        .catch(() => { if (!cancelled) setRollResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [rollQuery, sourceWarehouseId, previousJobId]);

  const addRoll = (roll: FabricRollDto) => {
    if (selectedRolls.some((r) => r.id === roll.id)) {
      showToast({ type: 'error', message: t('processingNew.rollAlreadyAdded', { barcode: roll.barcode }) });
      return;
    }
    if (roll.warehouse_id !== sourceWarehouseId) {
      showToast({ type: 'error', message: t('processingNew.rollWrongWarehouse', { barcode: roll.barcode }) });
      return;
    }
    if (roll.status !== 'AVAILABLE' && !(previousJobId && roll.status === 'DAMAGED')) {
      showToast({ type: 'error', message: t('processingNew.rollNotAvailable', { barcode: roll.barcode, status: roll.status }) });
      return;
    }
    if (Number.parseFloat(roll.length_m || '0') <= 0) {
      showToast({ type: 'error', message: t('processingNew.rollZeroLength', { barcode: roll.barcode }) });
      return;
    }
    setSelectedRolls((prev) => [...prev, roll]);
    setRollQuery('');
    setRollResults([]);
  };

  /** قواعد الإدخال الجماعي = نفس شروط addRoll الفردية (المستودع، الحالة، الطول) + منع توب الوزن (كما يرفضه الخادم). */
  const bulkRules: BulkRules = {
    reject: (roll) => {
      if (roll.warehouse_id !== sourceWarehouseId) return `من مستودع مختلف (${roll.warehouse_name ?? ''}) عن مستودع الإرسال`;
      if (roll.entry_basis === 'WEIGHT') return 'توب مُدخل بالكيلو — المصنعية الخارجية تعمل بالأمتار';
      if (roll.status !== 'AVAILABLE' && !(previousJobId && roll.status === 'DAMAGED')) return ROLL_STATUS_REASON[String(roll.status)] ?? `غير متاح (${roll.status})`;
      if (Number.parseFloat(roll.length_m || '0') <= 0) return 'طول التوب صفر';
      return null;
    },
    alreadyInDocument: (roll) => selectedRolls.some((r) => r.id === roll.id),
  };

  /** يضيف الأتواب الصالحة كسجلات مستقلة (بلا دمج) — لا يُنشئ إرسالاً ولا يغيّر المخزون قبل الحفظ والتأكيد. */
  const addBulkRolls = (rolls: FabricRollDto[]) => {
    setSelectedRolls((prev) => {
      const have = new Set(prev.map((r) => r.id));
      return [...prev, ...rolls.filter((r) => !have.has(r.id))];
    });
    showToast({ type: 'success', message: `أُضيف ${rolls.length} توب إلى الإرسال (مسودة — راجعها قبل الحفظ).` });
  };

  const removeRoll = (rollId: string) => {
    setSelectedRolls((prev) => prev.filter((r) => r.id !== rollId));
    setCheckedIds((prev) => { const next = new Set(prev); next.delete(rollId); return next; });
  };

  const applyBulkLink = (ids: string[], ref: BulkLinkRef, label: string) => {
    setReferences((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (ref === null) delete next[id];
        else next[id] = { rollId: id, customerOrderId: ref.customerOrderId, customerOrderLineId: ref.customerOrderLineId };
      }
      return next;
    });
    setLinkLabels((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (label) next[id] = label;
        else delete next[id];
      }
      return next;
    });
  };

  const linkText = (rollId: string) => {
    const ref = references[rollId];
    if (!ref) return t('traceability.inherit');
    if (ref.customerOrderId === null) return t('traceability.stock');
    return linkLabels[rollId] ?? t('traceability.linked');
  };

  const handleScanKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = rollQuery.trim();
    if (!value || !sourceWarehouseId) return;
    const exact = rollResults.find((r) => r.barcode.trim().toLowerCase() === value.toLowerCase());
    if (exact) {
      addRoll(exact);
      return;
    }
    try {
      const res = await listFabricRolls({ barcode: value, warehouseId: sourceWarehouseId, pageSize: 1 });
      if (res.data[0]) addRoll(res.data[0]);
      else showToast({ type: 'error', message: t('processingNew.rollNotFound', { barcode: value }) });
    } catch (err) {
      showToast({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('processingNew.rollNotFound', { barcode: value }) });
    }
  };

  const totals = useMemo(() => {
    const totalM = selectedRolls.reduce((sum, r) => sum + (Number.parseFloat(r.length_m || '0') || 0), 0);
    const totalKg = selectedRolls.reduce(
      (sum, r) => sum + (Number.parseFloat(r.actual_weight_kg ?? r.calculated_weight_kg ?? '0') || 0),
      0,
    );
    return { totalM, totalKg };
  }, [selectedRolls]);

  const canSave = Boolean(fabricStage && preparationTypeId && supplierId && sourceWarehouseId && selectedRolls.length > 0);

  const handleSave = async () => {
    if (!canSave || !fabricStage) return;
    const sheetNum = (v: string) => (v.trim() === '' ? null : Number(v));
    const sheet = { rawWidthCm: sheetNum(rawWidth), finishedWidthCm: sheetNum(finishedWidth), rawGsm: sheetNum(rawGsm), finishedGsm: sheetNum(finishedGsm) };
    if (Object.values(sheet).some((v) => v !== null && (!Number.isFinite(v) || v < 0))) {
      showToast({ type: 'error', message: t('processingNew.sheetInvalid') });
      return;
    }
    setSaving(true);
    try {
      const res = await createProcessingExternalJob({
        previousJobId: previousJobId.trim() || null,
        supplierId,
        fabricStage,
        preparationTypeId,
        sourceWarehouseId,
        processDescription: processDescription.trim() || null,
        notes: notes.trim() || null,
        rollIds: selectedRolls.map((r) => r.id),
        lineReferences: selectedRolls.flatMap(r => references[r.id] ? [references[r.id]] : []),
        traceabilityOnly,
        ...sheet,
      });
      showToast({ type: 'success', message: t('processingNew.createdSuccess', { jobNo: res.data.jobNo }) });
      navigate(`/purchases/external-jobs/${res.data.id}${manufacturing?'?from=manufacturing':''}`);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('processingNew.createFailed') });
    } finally {
      setSaving(false);
    }
  };

  const selectedPrepType = prepTypes.find((p) => p.id === preparationTypeId);
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const selectedWarehouse = warehouses.find((w) => w.id === sourceWarehouseId);

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir={lifecycleI18n.dir()}>
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(back)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Scissors className="w-6 h-6 text-emerald-600" /> {t('processingNew.title')}
          </h2>
          <p className="text-slate-500 mt-1 text-sm">{t('processingNew.subtitle')}</p>
        </div>
      </div>

      <label className="block border rounded p-3">{lifecycleT('lifecycle.linkPrevious')}<input className="block w-full border rounded p-2" value={previousJobId} onChange={e => setPreviousJobId(e.target.value)} placeholder={lifecycleT('lifecycle.previousId')} />
      </label>

      {/* Step 1: stage */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="font-bold text-slate-800 mb-3">{t('processingNew.stageStepTitle')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setFabricStage('RAW')}
            className={`flex flex-col items-center gap-2 p-6 rounded-xl border-2 transition ${
              fabricStage === 'RAW' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-300'
            }`}
          >
            <Layers className={`w-8 h-8 ${fabricStage === 'RAW' ? 'text-amber-600' : 'text-slate-400'}`} />
            <span className="font-bold text-slate-800">{t('processingNew.stageRaw')}</span>
          </button>
          <button
            type="button"
            onClick={() => setFabricStage('FINISHED')}
            className={`flex flex-col items-center gap-2 p-6 rounded-xl border-2 transition ${
              fabricStage === 'FINISHED' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300'
            }`}
          >
            <Droplet className={`w-8 h-8 ${fabricStage === 'FINISHED' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className="font-bold text-slate-800">{t('processingNew.stageFinished')}</span>
          </button>
        </div>
      </div>

      {fabricStage && (
        <>
          {/* Step 2: selectors */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <h3 className="font-bold text-slate-800">{t('processingNew.detailsStepTitle')}</h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">{t('processingNew.preparationTypeLabel')}</label>
                  <button type="button" onClick={() => setPrepManageOpen(true)} className="text-slate-400 hover:text-emerald-600" title={t('processingNew.managePrepTypes')}>
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
                <select
                  value={preparationTypeId}
                  onChange={(e) => setPreparationTypeId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('processingNew.choosePrepType')}</option>
                  {prepTypes.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">{t('processingNew.partyLabel')}</label>
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder={t('processingNew.partySearchPlaceholder')}
                  className="w-full p-2 mb-1 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('processingNew.chooseParty')}</option>
                  {filteredSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="text-xs text-amber-700">{t('processingNew.noSuppliersAtAll')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">{t('processingNew.sourceWarehouseLabel')}</label>
                <select
                  value={sourceWarehouseId}
                  onChange={(e) => setSourceWarehouseId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t('processingNew.chooseWarehouse')}</option>
                  {matchingWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                {matchingWarehouses.length === 0 && (
                  <p className="text-xs text-amber-700">{t('processingNew.noWarehousesAtAll')}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('processingNew.processDescriptionLabel')}</label>
              <textarea
                value={processDescription}
                onChange={(e) => setProcessDescription(e.target.value)}
                rows={2}
                placeholder={t('processingNew.processDescriptionPlaceholder')}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('processingNew.notesLabel')}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-bold text-slate-700">{t('processingNew.sheetTitle')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  ['rawWidthLabel', rawWidth, setRawWidth],
                  ['finishedWidthLabel', finishedWidth, setFinishedWidth],
                  ['rawGsmLabel', rawGsm, setRawGsm],
                  ['finishedGsmLabel', finishedGsm, setFinishedGsm],
                ] as const).map(([key, value, set]) => (
                  <label key={key} className="block text-xs font-bold text-slate-600">
                    {t(`processingNew.${key}`)}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      dir="ltr"
                    />
                  </label>
                ))}
              </div>
            </fieldset>

            {(selectedPrepType || selectedSupplier || selectedWarehouse) && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 grid sm:grid-cols-2 gap-1.5 text-sm">
                {selectedSupplier && <div><span className="text-slate-500">{t('processingNew.summaryParty')}: </span><strong>{selectedSupplier.name}</strong></div>}
                {selectedPrepType && <div><span className="text-slate-500">{t('processingNew.summaryPrepType')}: </span><strong>{selectedPrepType.name}</strong></div>}
                <div><span className="text-slate-500">{t('processingNew.summaryOrderNo')}: </span><strong>{t('processingNew.assignedOnSave')}</strong></div>
                <div><span className="text-slate-500">{t('processingNew.summaryDispatchNo')}: </span><strong>{t('processingNew.assignedOnSave')}</strong></div>
              </div>
            )}
          </div>

          {/* Roll selection */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
            <h3 className="font-bold text-slate-800">{t('processingNew.rollsLabel')}</h3>
            <label className="block rounded border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={traceabilityOnly} onChange={e => setTraceabilityOnly(e.target.checked)} /> {t('traceability.mixedCostMode')}</label>
            <p className="text-sm text-amber-800">{t('traceability.costNotice')}</p>
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={rollQuery}
                onChange={(e) => setRollQuery(e.target.value)}
                onKeyDown={(e) => void handleScanKeyDown(e)}
                disabled={!sourceWarehouseId}
                placeholder={sourceWarehouseId ? t('processingNew.rollScanPlaceholder') : t('processingNew.chooseWarehouseFirst')}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                dir="ltr"
              />
            </div>
            <button
              type="button"
              disabled={!sourceWarehouseId}
              onClick={() => setBulkOpen(true)}
              className="rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              إدخال باركودات بالجملة
            </button>
            <BulkBarcodeModal
              open={bulkOpen}
              onClose={() => setBulkOpen(false)}
              title="إدخال باركودات بالجملة — إرسال للمصنعية الخارجية"
              rules={bulkRules}
              onAdd={addBulkRolls}
              precondition={{ ok: Boolean(sourceWarehouseId), message: 'اختر مستودع الإرسال أولاً.' }}
            />
            {searching && <p className="text-xs text-slate-400">{t('processingNew.searching')}</p>}
            {rollResults.length > 0 && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {rollResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addRoll(r)}
                    className="w-full text-right px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between gap-2"
                  >
                    <span className="font-mono text-xs text-slate-500" dir="ltr">{r.barcode}</span>
                    <span className="font-medium text-slate-800">{r.item_name}</span>
                    <span className="text-xs text-slate-500">{r.color_name_ar}</span>
                    <span className="text-xs text-slate-500">{r.length_m} {t('meterAbbr')}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedRolls.length > 0 && <ExternalBulkOrderLink rolls={selectedRolls} checkedIds={checkedIds} onApply={applyBulkLink} />}
            {selectedRolls.length > 0 ? (
              <div className="overflow-x-auto border border-emerald-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-emerald-50 text-emerald-700">
                    <tr>
                      <th className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={t('traceability.checkAll')}
                          checked={selectedRolls.length > 0 && selectedRolls.every((r) => checkedIds.has(r.id))}
                          onChange={(e) => setCheckedIds(e.target.checked ? new Set(selectedRolls.map((r) => r.id)) : new Set())}
                        />
                      </th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colBarcode')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colItem')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colColor')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colLength')}</th>
                      <th className="px-3 py-2 text-right">{t('processingNew.colWeight')}</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedRolls.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={r.barcode}
                            checked={checkedIds.has(r.id)}
                            onChange={(e) => setCheckedIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next; })}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600" dir="ltr">{r.barcode}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{r.item_name}
                          <p className="mt-1 text-xs font-normal text-indigo-700">{linkText(r.id)}</p>
                          <details className="text-xs font-normal">
                            <summary className="cursor-pointer text-slate-500">{t('traceability.changeOne')}</summary>
                            <ExternalOrderLinePicker rollId={r.id} value={references[r.id]} onChange={value => { setReferences(prev => ({...prev,[r.id]:value})); setLinkLabels(prev => { const next = {...prev}; delete next[r.id]; return next; }); }} />
                          </details>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.color_name_ar} {r.color_code ? `(${r.color_code})` : ''}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.length_m}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.actual_weight_kg ?? r.calculated_weight_kg ?? '—'}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeRoll(r.id)} className="text-rose-500 hover:text-rose-700">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold">
                    <tr>
                      <td colSpan={4} className="px-3 py-2">{t('processingNew.totalsLabel', { count: selectedRolls.length })}</td>
                      <td className="px-3 py-2 font-mono">{totals.totalM.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">{totals.totalKg.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-400">{t('processingNew.noRollsSelected')}</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => void handleSave()}
              disabled={!canSave || saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {t('processingNew.save')}
            </button>
          </div>
        </>
      )}

      {prepManageOpen && (
        <PreparationTypesModal
          types={prepTypes}
          onClose={() => setPrepManageOpen(false)}
          onChanged={() => void loadPrepTypes()}
        />
      )}
    </div>
  );
};
