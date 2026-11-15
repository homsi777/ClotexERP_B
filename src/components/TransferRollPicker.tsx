import React, { useEffect, useMemo, useState } from 'react';
import { listFabricRolls, type FabricRollDto } from '../lib/api/fabricRollsApi';
import { groupTransferRolls, loadAllTransferRolls, mergeTransferSelection, transferColorRolls, transferTotals } from '../lib/inventory/transferSelection';

type Props = {
  warehouseId: string; locationId: string; disabled: boolean;
  selected: FabricRollDto[]; onChange: (rolls: FabricRollDto[]) => void;
  onReady: (ready: boolean) => void;
};
const number = (n: number) => n.toLocaleString('ar', { maximumFractionDigits: 3 });
const colorKey = (r: FabricRollDto) => r.color_id ?? '__no_color__';
const colorLabel = (r: FabricRollDto) => `${r.color_name_ar || r.color_name_tr || 'بدون لون'}${r.color_code ? ` (${r.color_code})` : ''}`;

export function TransferRollPicker({ warehouseId, locationId, disabled, selected, onChange, onReady }: Props) {
  const [rolls, setRolls] = useState<FabricRollDto[]>([]);
  const [mode, setMode] = useState('single');
  const [itemId, setItemId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadedScope, setLoadedScope] = useState('');
  const scope = `${warehouseId}:${locationId}:${revision}`;
  useEffect(() => {
    let cancelled = false;
    setRolls([]); setItemId(''); setError(''); setLoading(Boolean(warehouseId)); onReady(false);
    if (!warehouseId) return;
    loadAllTransferRolls(
      (page) => listFabricRolls({ warehouseId, locationId: locationId || undefined, onlyAvailable: true, page, pageSize: 500, sortBy: 'barcode', sortDir: 'asc' }),
      warehouseId, locationId, () => cancelled,
    ).then((rows) => { if (!cancelled) { setRolls(rows); setLoadedScope(scope); onReady(true); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'تعذر تحميل الرولات'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warehouseId, locationId, revision, onReady, scope]);

  const ids = useMemo(() => new Set(selected.map((r) => r.id)), [selected]);
  const items = useMemo(() => [...new Map(rolls.map((r) => [r.item_id, r])).values()], [rolls]);
  const itemRolls = useMemo(() => rolls.filter((r) => r.item_id === itemId), [rolls, itemId]);
  const colors = useMemo(() => [...new Map(itemRolls.map((r) => [colorKey(r), r])).values()], [itemRolls]);
  const visible = rolls.filter((r) => (mode === 'single' || (mode === 'multiple' && !itemId) || r.item_id === itemId)
    && `${r.barcode} ${r.item_name ?? ''} ${r.internal_code ?? ''} ${colorLabel(r)}`.toLowerCase().includes(search.toLowerCase()));
  const groups = useMemo(() => groupTransferRolls(selected), [selected]);
  const totals = transferTotals(selected);
  const blocked = disabled || loading || Boolean(error) || !warehouseId || loadedScope !== scope;
  const add = (rows: FabricRollDto[]) => onChange(mergeTransferSelection(selected, rows));
  const remove = (rows: FabricRollDto[]) => { const removeIds = new Set(rows.map((r) => r.id)); onChange(selected.filter((r) => !removeIds.has(r.id))); };
  const summary = (rows: FabricRollDto[]) => { const t = transferTotals(rows); return `${number(t.rolls)} رولة — ${number(t.meters)} م — ${number(t.kilograms)} كغ معلوم${t.unknownWeight ? ` — ${number(t.unknownWeight)} وزن غير معروف` : ''}${t.estimatedWeight ? ` — ${number(t.estimatedWeight)} وزن محسوب` : ''}`; };

  return <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="اختيار رولات المناقلة">
    <h3 className="font-bold">اختيار الخامات والرولات</h3>
    <div className="flex flex-wrap gap-2">
      {[['single', 'رولة منفردة'], ['multiple', 'خامات متعددة'], ['entire', 'خامة بالكامل'], ['color', 'حسب اللون']].map(([value, label]) =>
        <button type="button" key={value} disabled={disabled} aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded border px-3 py-2 ${mode === value ? 'bg-indigo-600 text-white' : ''}`}>{label}</button>)}
    </div>
    {loading && <p role="status">جارٍ تحميل جميع الرولات المؤهلة…</p>}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <button type="button" disabled={disabled || loading || !warehouseId} onClick={() => { onChange([]); setRevision((n) => n + 1); }} className="rounded border px-3 py-1">تحديث الرولات ومسح الاختيار</button>
    {mode !== 'single' && <div className="space-y-2">
      <label className="block">الخامة
        <select value={itemId} disabled={blocked} onChange={(e) => setItemId(e.target.value)} className="mx-2 rounded border p-2">
          <option value="">اختر الخامة</option>
          {items.map((r) => <option key={r.item_id} value={r.item_id}>{r.item_name} — {r.internal_code}</option>)}
        </select>
      </label>
      {mode === 'multiple' && <div className="flex flex-wrap gap-3">{items.map((item) => {
        const rows = rolls.filter((r) => r.item_id === item.item_id);
        return <label key={item.item_id}><input type="checkbox" disabled={blocked} checked={rows.every((r) => ids.has(r.id))} onChange={(e) => e.target.checked ? add(rows) : remove(rows)} /> {item.item_name} — {item.internal_code} ({rows.length})</label>;
      })}</div>}
      {mode === 'entire' && <button type="button" disabled={blocked || !itemId} onClick={() => add(itemRolls)} className="rounded border px-3 py-2">تحديد جميع رولات الخامة ({itemRolls.length})</button>}
      {mode === 'color' && itemId && <div className="flex flex-wrap gap-3">{colors.map((color) => {
        const rows = transferColorRolls(rolls, itemId, color.color_id);
        return <label key={colorKey(color)}><input type="checkbox" disabled={blocked} checked={rows.every((r) => ids.has(r.id))} onChange={(e) => e.target.checked ? add(rows) : remove(rows)} /> {colorLabel(color)} ({rows.length})</label>;
      })}<p className="w-full text-sm text-slate-500">اختيار خامة أخرى يحتفظ بالرولات السابقة. يمكنك استبعاد أي رولة من جدول المراجعة.</p></div>}
    </div>}
    <input aria-label="بحث في الرولات" placeholder="باركود، خامة، كود أو لون" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded border p-2" />
    <div className="flex gap-3">
      <button type="button" disabled={blocked || !visible.length} onClick={() => add(visible)} className="rounded border p-2">تحديد الكل في القائمة ({visible.length})</button>
      <button type="button" disabled={disabled} onClick={() => onChange([])} className="rounded border p-2">مسح الاختيار</button>
    </div>
    <div className="max-h-64 overflow-auto"><RollTable rows={visible} ids={ids} disabled={blocked} toggle={(r, checked) => checked ? add([r]) : remove([r])} /></div>
    <h3 className="font-bold">المراجعة النهائية حسب الخامة واللون</h3>
    <p role="status" className="font-bold">{summary(selected)}</p>
    {totals.unknownWeight > 0 && <p className="text-amber-700">إجمالي الكيلوغرامات لا يشمل الرولات مجهولة الوزن.</p>}
    {groups.map((rows) => <div key={`${rows[0].item_id}:${colorKey(rows[0])}`} className="overflow-auto rounded border p-2">
      <h4 className="font-bold">{rows[0].item_name} — {rows[0].internal_code} — {colorLabel(rows[0])}</h4>
      <p>{summary(rows)}</p>
      <RollTable rows={rows} ids={ids} disabled={disabled} toggle={(r, checked) => checked ? add([r]) : remove([r])} />
    </div>)}
    {!selected.length && <p>لم يتم تحديد رولات بعد.</p>}
  </section>;
}

function RollTable({ rows, ids, disabled, toggle }: { rows: FabricRollDto[]; ids: Set<string>; disabled: boolean; toggle: (r: FabricRollDto, checked: boolean) => void }) {
  return <table className="w-full text-right text-sm"><thead><tr>{['تحديد', 'الخامة / الكود', 'اللون', 'الباركود', 'الأمتار', 'الكيلوغرامات', 'المستودع / الموقع'].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
    {rows.map((r) => <tr key={r.id} className="border-t"><td className="p-2"><input aria-label={`تحديد الرولة ${r.barcode}`} type="checkbox" disabled={disabled} checked={ids.has(r.id)} onChange={(e) => toggle(r, e.target.checked)} /></td>
      <td className="p-2">{r.item_name} / {r.internal_code}</td><td className="p-2">{colorLabel(r)}</td><td className="p-2">{r.barcode}</td><td className="p-2">{number(Number(r.length_m))}</td>
      <td className="p-2">{r.actual_weight_kg != null ? number(Number(r.actual_weight_kg)) : r.calculated_weight_kg != null ? `${number(Number(r.calculated_weight_kg))} (محسوب)` : 'غير معروف'}</td><td className="p-2">{r.warehouse_name} / {r.location_name || 'بدون موقع'}</td></tr>)}
  </tbody></table>;
}
