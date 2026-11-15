import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TransferRollPicker } from '../../components/TransferRollPicker';
import type { FabricRollDto } from '../../lib/api/fabricRollsApi';
import { listLocations, listWarehouses, type ApiWarehouse, type ApiWarehouseLocation } from '../../lib/api/warehousesApi';
import { listInventoryTransfers, createInventoryTransfer, confirmInventoryTransfer, cancelInventoryTransfer, getInventoryTransfer, type InventoryTransferRow } from '../../lib/api/inventoryTransfersApi';
import { ApiRequestError } from '../../lib/api/client';

const statusAr: Record<string, string> = { DRAFT: 'مسودة', CONFIRMED: 'مؤكدة', CANCELLED: 'ملغاة' };
const message = (e: unknown) => e instanceof Error ? e.message : 'تعذر تنفيذ العملية';

export const Transfers = () => {
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [fromLocations, setFromLocations] = useState<ApiWarehouseLocation[]>([]);
  const [toLocations, setToLocations] = useState<ApiWarehouseLocation[]>([]);
  const [selected, setSelected] = useState<FabricRollDto[]>([]);
  const [ready, setReady] = useState(false);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<InventoryTransferRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState<{ id: string; label: string; signature: string; updatedAt: string } | null>(null);
  const saveLock = useRef(false);
  const actionLock = useRef(false);
  const listVersion = useRef(0);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const invalidateSelection = () => { setSelected([]); setReady(false); setReview(null); };

  const loadList = useCallback(async () => {
    const version = ++listVersion.current;
    setLoading(true);
    try {
      const result = await listInventoryTransfers({ search: search.trim() || undefined, pageSize: 50 });
      if (version === listVersion.current) { setRows(result.data); setTotal(result.total); }
    } catch (e) { if (version === listVersion.current) setError(message(e)); }
    finally { if (version === listVersion.current) setLoading(false); }
  }, [search]);
  useEffect(() => { void loadList(); return () => { listVersion.current++; }; }, [loadList]);
  useEffect(() => {
    let cancelled = false;
    listWarehouses({ status: 'active' }).then((data) => { if (!cancelled) setWarehouses(data); })
      .catch((e) => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setFromLocations([]);
    if (fromWarehouseId) listLocations(fromWarehouseId).then((data) => { if (!cancelled) setFromLocations(data); })
      .catch((e) => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; };
  }, [fromWarehouseId]);
  useEffect(() => {
    let cancelled = false;
    setToLocations([]);
    if (toWarehouseId) listLocations(toWarehouseId).then((data) => { if (!cancelled) setToLocations(data); })
      .catch((e) => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; };
  }, [toWarehouseId]);

  const handleSave = async () => {
    if (saveLock.current) return;
    setError(''); setNotice('');
    if (!ready || !selected.length) { setError('انتظر اكتمال التحميل واختر رولة واحدة على الأقل'); return; }
    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) { setError('اختر مستودعي مصدر ووجهة مختلفين'); return; }
    const payload = { fromWarehouseId, toWarehouseId, fromLocationId: fromLocationId || null, toLocationId: toLocationId || null,
      notes: notes.trim() || null, lines: [...selected].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ fabricRollId: r.id, quantity: 1 })) };
    const signature = JSON.stringify(payload);
    const pending = request.current?.signature === signature ? request.current : { signature, key: crypto.randomUUID() };
    request.current = pending;
    saveLock.current = true; setSaving(true);
    try {
      const result = await createInventoryTransfer({ ...payload, clientRequestId: pending.key });
      request.current = null; invalidateSelection(); setNotes(''); setRevision((n) => n + 1);
      setNotice(`حُفظت المسودة ${result.data.transfer_no}. لم يُنقل المخزون بعد؛ راجع المستند ثم أكّد المناقلة.`);
      await loadList();
    } catch (e) { setError(message(e)); }
    finally { saveLock.current = false; setSaving(false); }
  };

  const runAction = async (id: string, action: 'review' | 'confirm' | 'cancel') => {
    if (actionLock.current) return;
    actionLock.current = true; setActing(id); setError(''); setNotice('');
    try {
      if (action === 'review') {
        const result = await getInventoryTransfer(id);
        const snapshot = [...result.data.lines].sort((a, b) => a.fabric_roll_id.localeCompare(b.fabric_roll_id));
        const signature = JSON.stringify({ from: result.data.from_warehouse_id, to: result.data.to_warehouse_id,
          fromLocation: result.data.from_location_id, toLocation: result.data.to_location_id,
          lines: snapshot.map((l) => [l.fabric_roll_id, l.quantity]) });
        const detailed = snapshot.map((l) => l.roll);
        if (detailed.some((r) => r.warehouse_id !== result.data.from_warehouse_id || (result.data.from_location_id && r.location_id !== result.data.from_location_id) || r.status !== 'AVAILABLE' || Number(r.length_m) <= 0)) throw new Error('تغيّرت رولات المسودة؛ راجع المصدر وحدّث المستند قبل التأكيد');
        setFromWarehouseId(result.data.from_warehouse_id); setFromLocationId(result.data.from_location_id || '');
        setToWarehouseId(result.data.to_warehouse_id); setToLocationId(result.data.to_location_id || '');
        setSelected(detailed); setReview({ id, label: result.data.transfer_no, signature, updatedAt: result.data.updated_at });
      } else if (action === 'confirm') {
        if (review?.id !== id) throw new Error('راجع رولات المستند قبل التأكيد');
        const latest = await getInventoryTransfer(id);
        const signature = JSON.stringify({ from: latest.data.from_warehouse_id, to: latest.data.to_warehouse_id,
          fromLocation: latest.data.from_location_id, toLocation: latest.data.to_location_id,
          lines: [...latest.data.lines].sort((a, b) => a.fabric_roll_id.localeCompare(b.fabric_roll_id)).map((l) => [l.fabric_roll_id, l.quantity]) });
        if (signature !== review.signature) throw new Error('تغيّرت المسودة بعد المراجعة؛ افتح مراجعتها مجدداً');
        await confirmInventoryTransfer(id, review.updatedAt);
        invalidateSelection(); setRevision((n) => n + 1); setNotice('تمت المناقلة بنجاح دون تغيير إجمالي المخزون.');
        await loadList();
      } else {
        await cancelInventoryTransfer(id);
        if (review?.id === id) { invalidateSelection(); setRevision((n) => n + 1); }
        setNotice('أُلغيت المسودة.'); await loadList();
      }
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiRequestError && e.statusCode === 409) setNotice('حدّث الرولات وراجع السجل قبل إعادة المحاولة.');
    } finally { actionLock.current = false; setActing(null); }
  };

  const busy = saving || acting !== null;
  const inputClass = 'w-full rounded border p-2';
  return <div className="mx-auto max-w-7xl space-y-5">
    <h2 className="text-2xl font-bold">المناقلة بين المستودعات</h2>
    {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded bg-indigo-50 p-3">{notice}</p>}
    <fieldset disabled={busy || Boolean(review)} className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-2">
      <label>المستودع المصدر<select className={inputClass} value={fromWarehouseId} onChange={(e) => { invalidateSelection(); setFromWarehouseId(e.target.value); setFromLocationId(''); }}><option value="">اختر المصدر</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>موقع المصدر<select className={inputClass} value={fromLocationId} onChange={(e) => { invalidateSelection(); setFromLocationId(e.target.value); }}><option value="">كل المواقع</option>{fromLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label>المستودع الوجهة<select className={inputClass} value={toWarehouseId} onChange={(e) => { setToWarehouseId(e.target.value); setToLocationId(''); }}><option value="">اختر الوجهة</option>{warehouses.filter((w) => w.id !== fromWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>موقع الوجهة<select className={inputClass} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}><option value="">بدون موقع محدد</option>{toLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="md:col-span-2">ملاحظات<textarea className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    </fieldset>
    {review && <div className="flex flex-wrap items-center gap-3 rounded border p-3"><strong>مراجعة المسودة {review.label}</strong><button type="button" disabled={busy} onClick={() => void runAction(review.id, 'confirm')} className="rounded bg-emerald-700 px-4 py-2 text-white">تأكيد نقل جميع الرولات</button><button type="button" disabled={busy} onClick={() => { invalidateSelection(); setRevision((n) => n + 1); }}>إغلاق المراجعة</button></div>}
    <TransferRollPicker key={revision} warehouseId={fromWarehouseId} locationId={fromLocationId} disabled={busy || Boolean(review)} selected={selected} onChange={setSelected} onReady={setReady} />
    {!review && <button type="button" disabled={busy || !ready || !selected.length} onClick={() => void handleSave()} className="rounded bg-indigo-700 px-5 py-3 text-white disabled:opacity-50">{saving ? 'جارٍ الحفظ…' : 'حفظ جميع الاختيارات في مسودة مناقلة واحدة'}</button>}
    <section className="space-y-3 rounded-xl border bg-white p-4"><h3 className="font-bold">سجل المناقلات ({total})</h3>
      <input className={inputClass} aria-label="بحث المناقلات" placeholder="بحث برقم المناقلة" value={search} onChange={(e) => setSearch(e.target.value)} />
      <button type="button" onClick={() => void loadList()}>تحديث السجل</button>
      {loading && <p role="status">جارٍ تحميل السجل…</p>}
      <div className="overflow-auto"><table className="w-full text-right text-sm"><thead><tr>{['المناقلة', 'المصدر', 'الوجهة', 'الرولات', 'الحالة', 'الإجراءات'].map((h) => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>
        {rows.map((r) => <tr key={r.id} className="border-t"><td className="p-2">{r.transfer_no}</td><td>{r.from_warehouse_name}</td><td>{r.to_warehouse_name}</td><td>{r.line_count}</td><td>{statusAr[r.status]}</td><td className="flex gap-3 p-2">{r.status === 'DRAFT' && <><button disabled={busy} onClick={() => void runAction(r.id, 'review')}>مراجعة وتأكيد</button><button disabled={busy} onClick={() => void runAction(r.id, 'cancel')}>إلغاء</button></>}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
};
