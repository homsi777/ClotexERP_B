import {YarnShortagePanel} from '../../components/inventory/YarnShortagePanel';
import {usePermissions} from '../../hooks/usePermissions';
import {canYarn} from '../../lib/inventory/yarnPermissions';
import {YarnPropertiesEditor} from '../../components/inventory/YarnPropertiesEditor';
import {YarnLocationSelect} from '../../components/inventory/YarnLocationSelect';
import {listFabricColors,type ApiFabricColor} from '../../lib/api/fabricColorsApi';
import type {YarnProperties} from '../../lib/api/yarnLotsApi';
import React, { useEffect, useRef,useState } from 'react';
import {apiFetch} from '../../lib/api/client';
import type {YarnLotCreatePayload} from '../../lib/api/yarnLotsApi';
import {YarnOperationsPanel} from '../../components/inventory/YarnOperationsPanel';
import {YarnProfileLibrary} from '../../components/inventory/YarnProfileLibrary';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, Plus, Scale, ShoppingCart } from 'lucide-react';
import { createFabricItem, listFabricItems, type ApiFabricItem } from '../../lib/api/fabricItemsApi';
import { createYarnLot, listYarnLots, postYarnStockOperation, listYarnMovements, type YarnLotDto } from '../../lib/api/yarnLotsApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { createSalesInvoice } from '../../lib/api/salesInvoicesApi';
import { useToast } from '../../components/NonBlockingToast';

/**
 * إدارة الخيط/الغزل — صنف منفصل تماماً عن توب القماش، يُقاس بالوزن (كج) لا
 * بالطول. شاشة مستقلة عمداً بدل دمجها بـ CreateItem.tsx/Inventory.tsx —
 * تلك الشاشات متشابكة جداً بمنطق خاص بالقماش (عرض/GSM/متغيرات لون)، ودمج
 * منطق الوزن فيها كان سيزيد خطر كسر تدفق القماش الحالي بلا داعٍ.
 */
export function YarnManagement() {
  const { t } = useTranslation('yarnManagement');
  const { showToast } = useToast();
  const {user}=usePermissions();
  const [colors,setColors]=useState<ApiFabricColor[]>([]),[properties,setProperties]=useState<YarnProperties>({}),[packageBarcodes,setPackageBarcodes]=useState(false);
  useEffect(()=>{void listFabricColors({pageSize:500,status:'active'}).then(r=>setColors(r.data)).catch(e=>showToast({type:'error',message:String(e)}));},[]);
  const [items, setItems] = useState<ApiFabricItem[]>([]);
  const [lots, setLots] = useState<YarnLotDto[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [filters, setFilters] = useState({ search: '', ownerType: '', materialKind:'' as ''|'YARN'|'CONSUMABLE', onlyAvailable: false, page: 1 });
  const [total, setTotal] = useState(0);
  const [receipt, setReceipt] = useState({ ownerType: 'COMPANY', ownerCustomerId: '', fiber: '', count: '', packages: '', perPackage: '' });
  const [weightMode,setWeightMode]=useState<'NET'|'GROSS'|'PACKAGES'>('NET'),[gross,setGross]=useState(''),[tare,setTare]=useState('');
  const [pendingReceipts,setPendingReceipts]=useState<YarnLotCreatePayload[]>([]),[batchSaving,setBatchSaving]=useState(false);
  const batchRequest=useRef({key:crypto.randomUUID(),signature:''});
  const [operation, setOperation] = useState({ lotId: '', type: 'ADJUST', weight: '', warehouseId: '', locationId:'', reason: '', approved: false });
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listYarnMovements>>['data']>([]);
  const runOperation = async () => {
    const lot = lots.find(l => l.id === operation.lotId);
    if (!lot || !operation.weight.trim()) return;
    setBusy(true);
    try {
      if (operation.type === 'ADJUST') {
        if (!operation.approved) throw new Error(t('approvalRequired'));
        await postYarnStockOperation(lot.id, { type: 'ADJUST', targetWeightKg: Number(operation.weight), expectedWeightKg: Number(lot.weight_kg), reason: operation.reason, approved: true });
      } else await postYarnStockOperation(lot.id, { type: 'TRANSFER', weightKg: Number(operation.weight), warehouseId: operation.warehouseId, locationId:operation.locationId||null, reason: operation.reason });
      setHistory([]); setOperation({ ...operation, lotId: '', weight: '', reason: '', approved: false }); await load();
    } catch (e) { showToast({ type: 'error', message: e instanceof Error ? e.message : t('toast.loadFailed') }); }
    finally { setBusy(false); }
  };
  const [loading, setLoading] = useState(true);

  const [sellForm, setSellForm] = useState({ lotId: '', customerId: '', weightKg: '', unitPrice: '' });
  const [sellSaving, setSellSaving] = useState(false);

  const [itemForm, setItemForm] = useState({ internalCode: '', name: '', supplierCode: '', notes: '' });
  const [itemSaving, setItemSaving] = useState(false);

  const [lotForm, setLotForm] = useState({
    itemId: '', supplierId: '', warehouseId: '', weightKg: '', unitCost: '', batchNo: '', notes: '', colorId:'',locationId:'',lotNo:'',barcode:'',
  });
  const [lotSaving, setLotSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [itemsRes, lotsRes, suppliersRes, warehousesRes, customersRes] = await Promise.all([
        listFabricItems({ unit: 'kg', pageSize: 200 }),
        listYarnLots({ materialKind:filters.materialKind||undefined, pageSize: 100, search: filters.search, ownerType: filters.ownerType as 'COMPANY' | 'CUSTOMER' || undefined, onlyAvailable: filters.onlyAvailable, page: filters.page }),
        listSuppliers({ pageSize: 200 }),
        listWarehouses(),
        listCustomers({ pageSize: 200 }),
      ]);
      setItems(itemsRes.data);
      setLots(lotsRes.data); setTotal(lotsRes.total);
      setSuppliers(suppliersRes.data);
      setWarehouses(warehousesRes);
      setCustomers(customersRes.data);
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handleCreateItem = async () => {
    if (!itemForm.internalCode.trim() || !itemForm.name.trim()) {
      showToast({ type: 'error', message: t('toast.itemFieldsRequired') });
      return;
    }
    setItemSaving(true);
    try {
      await createFabricItem({
        internal_code: itemForm.internalCode.trim(),
        name: itemForm.name.trim(),
        supplier_code: itemForm.supplierCode.trim() || undefined,
        notes: itemForm.notes.trim() || undefined,
        unit: 'kg',
        fabric_type: 'خيط',
      });
      setItemForm({ internalCode: '', name: '', supplierCode: '', notes: '' });
      showToast({ type: 'success', message: t('toast.itemCreated') });
      await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.itemCreateFailed') });
    } finally {
      setItemSaving(false);
    }
  };

  const handleCreateLot = async (stageOnly=false) => {
    if(weightMode==='GROSS'&&(!gross.trim()||!tare.trim())){showToast({type:'error',message:'أدخل القائم والفوارغ، بما فيها صفر فوارغ عند عدم وجودها'});return;}
    const weight = weightMode==='GROSS'?Number(gross)-Number(tare):weightMode==='PACKAGES'?Number(receipt.packages)*Number(receipt.perPackage):Number(lotForm.weightKg);
    if (!lotForm.itemId || !lotForm.warehouseId || !Number.isFinite(weight) || weight <= 0) {
      showToast({ type: 'error', message: t('toast.lotFieldsRequired') });
      return;
    }
    setLotSaving(true);
    try {
      const payload:YarnLotCreatePayload={
        ownerType: receipt.ownerType as 'COMPANY' | 'CUSTOMER',
        ownerCustomerId: receipt.ownerCustomerId || null,
        yarnProperties: Object.values(properties).some(v=>v!==undefined && (!Array.isArray(v)||v.length>0))?properties:undefined,
        colorId:lotForm.colorId||null,locationId:lotForm.locationId||null,lotNo:lotForm.lotNo||undefined,barcode:lotForm.barcode||undefined,
        packageBarcodes:weightMode==='PACKAGES'&&packageBarcodes,
        receiptPackages: weightMode==='PACKAGES' ? { count: Number(receipt.packages), weightPerPackageKg: Number(receipt.perPackage) } : null,
        ...(weightMode==='GROSS'?{grossWeightKg:Number(gross),tareWeightKg:Number(tare)}:{}),
        itemId: lotForm.itemId,
        supplierId: lotForm.supplierId || null,
        warehouseId: lotForm.warehouseId,
        weightKg: weight,
        unitCost: lotForm.unitCost ? Number(lotForm.unitCost) : null,
        batchNo: lotForm.batchNo.trim() || null,
        notes: lotForm.notes.trim() || null,
      };
      if(stageOnly)setPendingReceipts(rows=>[...rows,payload]);else await createYarnLot(payload);
      setLotForm({ itemId: '', supplierId: '', warehouseId: '', weightKg: '', unitCost: '', batchNo: '', notes: '',colorId:'',locationId:'',lotNo:'',barcode:'' });
      setProperties({});setPackageBarcodes(false);setReceipt({...receipt,packages:'',perPackage:''});setGross('');setTare('');
      showToast({ type: 'success', message: stageOnly?'أضيف السطر إلى القائمة؛ اضغط حفظ جميع السطور لترحيله':t('toast.lotReceived') });
      if(!stageOnly)await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.lotReceiveFailed') });
    } finally {
      setLotSaving(false);
    }
  };
  const saveReceiptBatch=async()=>{setBatchSaving(true);try{const signature=JSON.stringify(pendingReceipts);if(batchRequest.current.signature!==signature)batchRequest.current={signature,key:crypto.randomUUID()};await apiFetch('/api/inventory/yarn-lots/receipts/batch',{method:'POST',body:JSON.stringify({batchKey:batchRequest.current.key,rows:pendingReceipts})});setPendingReceipts([]);batchRequest.current={key:crypto.randomUUID(),signature:''};await load();}catch(e){showToast({type:'error',message:e instanceof Error?e.message:'تعذر حفظ دفعة الخيط'});}finally{setBatchSaving(false);}};

  const handleSellLot = async () => {
    const weight = Number(sellForm.weightKg);
    const price = Number(sellForm.unitPrice);
    if (!sellForm.lotId || !sellForm.customerId || !weight || weight <= 0 || !price || price <= 0) {
      showToast({ type: 'error', message: t('toast.sellFieldsRequired') });
      return;
    }
    const lot = lots.find((l) => l.id === sellForm.lotId);
    if (!lot || lot.owner_type !== 'COMPANY') return;
    if (weight > Number(lot.weight_kg) + 1e-6) {
      showToast({ type: 'error', message: t('toast.weightExceedsAvailable', { weight: lot.weight_kg }) });
      return;
    }
    setSellSaving(true);
    try {
      const lineTotal = Math.round(weight * price * 100) / 100;
      await createSalesInvoice({
        invoiceNo: 'AUTO',
        invoiceDate: new Date().toISOString().slice(0, 10),
        customerId: sellForm.customerId,
        currencyCode: 'USD',
        exchangeRateToUsd: 1,
        subtotal: lineTotal,
        discountTotal: 0,
        taxTotal: 0,
        totalAmount: lineTotal,
        paidAmount: 0,
        remainingAmount: lineTotal,
        confirm: true,
        lines: [
          {
            yarnLotId: lot.id,
            fabricItemId: lot.item_id,
            description: lot.item_name || 'خيط',
            quantity: weight,
            unit: 'kg',
            unitPrice: price,
            lineTotal,
          },
        ],
      });
      setSellForm({ lotId: '', customerId: '', weightKg: '', unitPrice: '' });
      showToast({ type: 'success', message: t('toast.soldSuccess') });
      await load();
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : t('toast.sellFailed') });
    } finally {
      setSellSaving(false);
    }
  };

  const inputCls = 'w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <YarnOperationsPanel lots={lots} suppliers={suppliers} warehouses={warehouses} onChanged={load}/>
      <YarnProfileLibrary items={items}/><YarnShortagePanel items={items} lots={lots}/>
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-6 h-6 text-indigo-600" /> {t('pageTitle')}
        </h2>
        <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Package className="w-5 h-5 text-indigo-600" /> {t('newItemCardTitle')}
          </div>
          <input className={inputCls} placeholder={t('internalCodePlaceholder')} value={itemForm.internalCode}
            onChange={(e) => setItemForm({ ...itemForm, internalCode: e.target.value })} />
          <input className={inputCls} placeholder={t('itemNamePlaceholder')} value={itemForm.name}
            onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
          <input className={inputCls} placeholder={t('supplierCodePlaceholder')} value={itemForm.supplierCode}
            onChange={(e) => setItemForm({ ...itemForm, supplierCode: e.target.value })} />
          <textarea className={inputCls} placeholder={t('notesPlaceholder')} value={itemForm.notes}
            onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} />
          <button type="button" onClick={() => void handleCreateItem()} disabled={itemSaving}
            className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {itemSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('createItem')}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Scale className="w-5 h-5 text-indigo-600" /> {t('receiveLotCardTitle')}
          </div>
          <select className={inputCls} value={lotForm.itemId} onChange={(e) => setLotForm({ ...lotForm, itemId: e.target.value })}>
            <option value="">{t('chooseItemOption')}</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.internal_code})</option>)}
          </select>
          <select className={inputCls} value={lotForm.supplierId} onChange={(e) => setLotForm({ ...lotForm, supplierId: e.target.value })}>
            <option value="">{t('supplierOptionalOption')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={inputCls} value={lotForm.warehouseId} onChange={(e) => setLotForm({ ...lotForm, warehouseId: e.target.value,locationId:'' })}>
            <option value="">{t('chooseWarehouseOption')}</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select aria-label={t('owner')} className={inputCls} value={receipt.ownerType} onChange={e => setReceipt({ ...receipt, ownerType: e.target.value, ownerCustomerId: '' })}>
            <option value="COMPANY">{t('companyOwner')}</option><option value="CUSTOMER">{t('customerOwner')}</option>
          </select>
          {receipt.ownerType === 'CUSTOMER' && <select className={inputCls} aria-label={t('owner')} value={receipt.ownerCustomerId} onChange={e => setReceipt({ ...receipt, ownerCustomerId: e.target.value })}><option value="">{t('chooseCustomerOption')}</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          <select aria-label="لون الخيط وكوده" className={inputCls} value={lotForm.colorId} onChange={e=>setLotForm({...lotForm,colorId:e.target.value})}><option value="">اللون (اختياري)</option>{colors.map(c=><option key={c.id} value={c.id}>{c.name_ar} — {c.color_code}</option>)}</select>
          <YarnLocationSelect warehouseId={lotForm.warehouseId} value={lotForm.locationId} onChange={locationId=>setLotForm({...lotForm,locationId})}/>
          <input aria-label="رقم اللوط" placeholder="رقم اللوط" maxLength={100} className={inputCls} value={lotForm.lotNo} onChange={e=>setLotForm({...lotForm,lotNo:e.target.value})}/>
          <input aria-label="باركود يدوي سبعة أرقام" placeholder="باركود يدوي (7 أرقام) أو تلقائي" inputMode="numeric" maxLength={7} pattern="[0-9]{7}" className={inputCls} value={lotForm.barcode} onChange={e=>setLotForm({...lotForm,barcode:e.target.value})}/>
          <YarnPropertiesEditor value={properties} onChange={setProperties}/>
          {weightMode==='PACKAGES'&&<label><input type="checkbox" checked={packageBarcodes} onChange={e=>setPackageBarcodes(e.target.checked)}/> إصدار باركود لكل طرد (معرف تابع؛ الرصيد للوط فقط)</label>}
          <input type="number" className={inputCls} placeholder={t('packages')} value={receipt.packages} onChange={e => setReceipt({ ...receipt, packages: e.target.value })} />
          <input type="number" step="0.001" className={inputCls} placeholder={t('packageWeight')} value={receipt.perPackage} onChange={e => { setReceipt({ ...receipt, perPackage: e.target.value }); if (receipt.packages) setLotForm({ ...lotForm, weightKg: String(Number(receipt.packages) * Number(e.target.value)) }); }} />
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="طريقة وزن الخيط" className={`${inputCls} col-span-2`} value={weightMode} onChange={e=>setWeightMode(e.target.value as typeof weightMode)}><option value="NET">صافي مباشر</option><option value="GROSS">قائم ناقص الفوارغ</option><option value="PACKAGES">عدد الطرود × وزن الطرد</option></select>
            {weightMode==='GROSS'&&<><input aria-label="الوزن القائم للخيط" type="number" min="0" step="0.001" className={inputCls} value={gross} onChange={e=>setGross(e.target.value)} placeholder="القائم كغ"/><input aria-label="وزن فوارغ الخيط" type="number" min="0" step="0.001" className={inputCls} value={tare} onChange={e=>setTare(e.target.value)} placeholder="الفوارغ كغ"/><p className="col-span-2 text-sm">الصافي: {(Number(gross)-Number(tare)).toFixed(3)} كغ</p></>}
            <input type="number" readOnly={weightMode!=='NET'} step="0.001" className={inputCls} placeholder={t('weightKgPlaceholder')} value={weightMode==='GROSS'?String(Number(gross)-Number(tare)):weightMode==='PACKAGES'?String(Number(receipt.packages)*Number(receipt.perPackage)):lotForm.weightKg}
              onChange={(e) => setLotForm({ ...lotForm, weightKg: e.target.value })} />
            <input type="number" step="0.0001" className={inputCls} placeholder={t('costPerKgPlaceholder')} value={lotForm.unitCost}
              onChange={(e) => setLotForm({ ...lotForm, unitCost: e.target.value })} />
          </div>
          <input className={inputCls} placeholder={t('batchNoPlaceholder')} value={lotForm.batchNo}
            onChange={(e) => setLotForm({ ...lotForm, batchNo: e.target.value })} />
          <button type="button" onClick={() => void handleCreateLot()} disabled={lotSaving||!canYarn(user,'receiving')}
            className="w-full bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {lotSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('receiveLot')}
          </button>
          <button type="button" disabled={lotSaving||batchSaving||pendingReceipts.length>=100||!canYarn(user,'receiving')} onClick={()=>void handleCreateLot(true)} className="w-full rounded-lg border p-2 text-sm">إضافة إلى قائمة الاستلام المتعدد</button>
          {!!pendingReceipts.length&&<div className="space-y-2 rounded-lg border p-2"><strong>قائمة الاستلام ({pendingReceipts.length})</strong>{pendingReceipts.map((row,index)=><div key={index} className="flex items-center justify-between gap-2 text-xs"><span>{items.find(item=>item.id===row.itemId)?.name} — {row.weightKg} كغ — {warehouses.find(w=>w.id===row.warehouseId)?.name}</span><button disabled={batchSaving} onClick={()=>setPendingReceipts(rows=>rows.filter((_,i)=>i!==index))}>إزالة</button></div>)}<button disabled={batchSaving||!canYarn(user,'receiving')} className="rounded bg-indigo-600 p-2 text-white" onClick={()=>void saveReceiptBatch()}>حفظ جميع سطور الاستلام معاً</button></div>}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <ShoppingCart className="w-5 h-5 text-rose-600" /> {t('sellLotCardTitle')}
          </div>
          <select className={inputCls} value={sellForm.lotId} onChange={(e) => setSellForm({ ...sellForm, lotId: e.target.value })}>
            <option value="">{t('chooseLotOption')}</option>
            {lots.filter((l) => l.status === 'AVAILABLE' && l.owner_type === 'COMPANY' && Number(l.weight_kg) > 0).map((l) => (
              <option key={l.id} value={l.id}>{t('lotOptionAvailable', { itemName: l.item_name, barcode: l.barcode, weight: Number(l.weight_kg).toFixed(3) })}</option>
            ))}
          </select>
          <select className={inputCls} value={sellForm.customerId} onChange={(e) => setSellForm({ ...sellForm, customerId: e.target.value })}>
            <option value="">{t('chooseCustomerOption')}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.001" className={inputCls} placeholder={t('soldWeightPlaceholder')} value={sellForm.weightKg}
              onChange={(e) => setSellForm({ ...sellForm, weightKg: e.target.value })} />
            <input type="number" step="0.0001" className={inputCls} placeholder={t('sellPricePerKgPlaceholder')} value={sellForm.unitPrice}
              onChange={(e) => setSellForm({ ...sellForm, unitPrice: e.target.value })} />
          </div>
          <button type="button" onClick={() => void handleSellLot()} disabled={sellSaving}
            className="w-full bg-rose-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {sellSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            {t('sellAndConfirm')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <input className={inputCls} placeholder={t('search')} value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value, page: 1 })} />
          <select aria-label={t('owner')} value={filters.ownerType} onChange={e => setFilters({ ...filters, ownerType: e.target.value, page: 1 })}><option value="">{t('allOwners')}</option><option value="COMPANY">{t('companyOwner')}</option><option value="CUSTOMER">{t('customerOwner')}</option></select>
          <label><input type="checkbox" checked={filters.onlyAvailable} onChange={e => setFilters({ ...filters, onlyAvailable: e.target.checked, page: 1 })} />{t('availableOnly')}</label>
          <button disabled={filters.page === 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>?</button><span>{filters.page} / {Math.max(1, Math.ceil(total / 100))}</span><button disabled={filters.page * 100 >= total} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>?</button>
        </div>
        <select aria-label="تصفية نوع المادة الوزنية" value={filters.materialKind} onChange={e=>setFilters({...filters,materialKind:e.target.value as typeof filters.materialKind,page:1})}><option value="">جميع مواد الكغ</option><option value="YARN">الغزول والقديم غير المصنف</option><option value="CONSUMABLE">المستهلكات والقديم غير المصنف</option></select><h3 className="font-bold">{t('stockOperation')}</h3>
        <select className={inputCls} value={operation.lotId} onChange={e => { setOperation({ ...operation, lotId: e.target.value }); setHistory([]); }}><option value="">{t('chooseLotOption')}</option>{lots.map(l => <option key={l.id} value={l.id}>{l.barcode} ? {l.owner_type} ? {l.weight_kg}</option>)}</select>
        <select className={inputCls} value={operation.type} onChange={e => setOperation({ ...operation, type: e.target.value })}><option value="ADJUST">{t('adjust')}</option><option value="TRANSFER">{t('transfer')}</option></select>
        <input type="number" step="0.001" className={inputCls} placeholder={t(operation.type === 'ADJUST' ? 'targetWeight' : 'soldWeightPlaceholder')} value={operation.weight} onChange={e => setOperation({ ...operation, weight: e.target.value })} />
        {operation.type === 'TRANSFER' && <select className={inputCls} value={operation.warehouseId} onChange={e => setOperation({ ...operation, warehouseId: e.target.value,locationId:'' })}><option value="">{t('chooseWarehouseOption')}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
        {operation.type==='TRANSFER'&&<YarnLocationSelect warehouseId={operation.warehouseId} value={operation.locationId} onChange={locationId=>setOperation({...operation,locationId})}/>}
        <input className={inputCls} placeholder={t('reason')} value={operation.reason} onChange={e => setOperation({ ...operation, reason: e.target.value })} />
        {operation.type === 'ADJUST' && <label><input type="checkbox" checked={operation.approved} onChange={e => setOperation({ ...operation, approved: e.target.checked })} />{t('approve')}</label>}
        <button disabled={busy || !operation.lotId || !canYarn(user,operation.type==='TRANSFER'?'transfer':'settlement')} className="bg-indigo-600 text-white rounded p-2" onClick={() => void runOperation()}>{t('execute')}</button>
        <button disabled={!operation.lotId || busy} className="border rounded p-2 mx-2" onClick={async () => { try { setHistory((await listYarnMovements(operation.lotId)).data); } catch (e) { showToast({ type: 'error', message: String(e) }); } }}>{t('history')}</button>
        {history.map(m => <div key={m.id} className="border-b p-2">{m.created_at} ? {m.movement_type} ? {m.weight_delta_kg} kg ? {m.notes} ? {m.created_by_user_id}</div>)}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 font-bold text-slate-800">{t('currentLotsTitle')}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100">
              <tr>
                <th className="px-4 py-3">{t('colBarcode')}</th>
                <th className="px-4 py-3">{t('colItem')}</th>
                <th className="px-4 py-3">{t('colWarehouse')}</th>
                <th className="px-4 py-3">{t('colRemainingWeight')}</th>
                <th className="px-4 py-3">{t('colCostPerKg')}</th>
                <th className="px-4 py-3">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" /> {t('loading')}
                </td></tr>
              ) : lots.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{t('noLotsYet')}</td></tr>
              ) : lots.map((lot) => (
                <tr key={lot.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-indigo-600">{lot.barcode}</td>
                  <td className="px-4 py-3">{lot.item_name || '—'}<div>{lot.lot_no} — {lot.color_name_ar} {lot.color_code} — {lot.weight_material_kind==='CONSUMABLE'?'مستهلك كغ':lot.weight_material_kind==='YARN'?'خيط كغ':'قديم غير مصنف كغ'}</div></td>
                  <td className="px-4 py-3">{lot.warehouse_name || '—'} — {lot.location_code} {lot.location_name}</td>
                  <td className="px-4 py-3 font-bold">{Number(lot.weight_kg).toFixed(3)}</td>
                  <td className="px-4 py-3">{lot.unit_cost ?? '—'} {lot.currency_code}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded text-xs font-bold bg-slate-100 text-slate-800">{lot.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
