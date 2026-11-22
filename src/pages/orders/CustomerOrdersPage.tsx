import { DateInput } from '../../components/common/DateInput';
import { listOrderMetadataOptions, type OrderMetadataOptions } from '../../lib/api/customerOrdersApi';
import { sampleStatusLabels } from '../../lib/customerOrderMetadata';
import {OrderNotificationRouting} from '../../components/orders/OrderNotificationRouting';
import React, { useEffect, useState } from 'react';
import {useSearchParams} from 'react-router-dom';
import {getCustomerOrderApi} from '../../lib/api/customerOrdersApi';
import {
  ClipboardList,
  Eye,
  FileStack,
  LayoutGrid,
  ListOrdered,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar, tr } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import type { Customer, CustomerOrder, CustomerOrderStatus, OrderTemplate, OrderTemplateLine } from '../../types';
import { OrderDetailModal } from '../../components/orders/OrderDetailModal';
import { OrderFormModal } from '../../components/orders/OrderFormModal';
import type { OrderFormSubmitPayload } from '../../components/orders/OrderFormModal';
import { ORDER_STATUS_LABELS, statusBadgeClass } from './orderStatusUi';
import { displayCustomerOrderNumber } from '../../lib/orderDisplay';
import { deliveryCountdownClass, orderDeliveryCountdown } from '../../lib/orderDeliveryCountdown';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { TelegramSendButton } from '../../components/telegram/TelegramSendButton';
import { sendTelegramCustomerOrder } from '../../lib/telegramOrder';
import { useToast } from '../../components/NonBlockingToast';
import {
  createCustomerOrderApi,
  createOrderTemplateApi,
  deleteCustomerOrderApi,
  deleteOrderTemplateApi,
  listCustomerOrders,
  listOrderTemplatesApi,
  updateCustomerOrderApi,
  updateCustomerOrderStatusApi,
} from '../../lib/api/customerOrdersApi';

type TabId = 'registry' | 'templates';

const emptyTplLine = (): OrderTemplateLine => ({
  materialName: '',
  dsamNumber: '',
  rollNo: '',
  colorCode: '',
  colorName: '',
  length: 0,
  widthCm: 150,
  gsm: 150,
  price: 0,
  note: '',
});

const mapApiCustomer = (c: ApiCustomer): Customer => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  address: c.address,
  balance: 0,
});

export function CustomerOrdersPage() {
  const [query]=useSearchParams();
  const { t, i18n } = useTranslation('customerOrdersPage');
  const dateLocale = i18n.language === 'ar' ? ar : tr;
  const inventory = useStore((s) => s.inventory);
  const { showToast } = useToast();

  const [tab, setTab] = useState<TabId>('registry');
  const [metadataOptions,setMetadataOptions] = useState<OrderMetadataOptions>({offices:[],employees:[],users:[]});
  const [orderPage,setOrderPage] = useState(1);
  const [orderTotal,setOrderTotal] = useState(0);
  const [metadataFilters,setMetadataFilters] = useState<Record<string,string>>({});
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [orderTemplates, setOrderTemplates] = useState<OrderTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<CustomerOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<CustomerOrder | null>(null);
  useEffect(()=>{const id=query.get('order');if(!id)return;let active=true;void getCustomerOrderApi(id).then(order=>{if(active)setDetailOrder(order);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[query]);
  const [telegramBusyId, setTelegramBusyId] = useState<string | null>(null);

  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplLines, setTplLines] = useState<OrderTemplateLine[]>([emptyTplLine()]);

  const refreshData = async () => {
    setLoading(true);
    setError('');
    try {
      // كل طلب مستقل: فشل واحد لا يُخفي العملاء ولا القوالب.
      const [customerRes, templateRes, metadataRes] = await Promise.allSettled([
        listCustomers({ status: 'active', pageSize: 1000 }),
        listOrderTemplatesApi(),
        listOrderMetadataOptions(),
      ]);
      if (customerRes.status === 'fulfilled') setCustomers(customerRes.value.data.map(mapApiCustomer));
      if (metadataRes.status === 'fulfilled') setMetadataOptions(metadataRes.value);
      if (templateRes.status === 'fulfilled') setOrderTemplates(templateRes.value);
      if (customerRes.status === 'rejected' && templateRes.status === 'rejected' && metadataRes.status === 'rejected') {
        throw customerRes.reason;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customer orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
  }, []);

  useEffect(() => { setOrderPage(1); }, [search,metadataFilters]);
  useEffect(() => {
    let active=true;
    const timer=window.setTimeout(()=>{
      setLoading(true); setError('');
      listCustomerOrders({search,...metadataFilters,page:orderPage}).then(result=>{
        if(active) {setCustomerOrders(result.data);setOrderTotal(result.total);}
      }).catch(error=>{if(active)setError(error instanceof Error?error.message:'تعذر تحميل الأوردرات');})
        .finally(()=>{if(active)setLoading(false);});
    },250);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[search,metadataFilters,orderPage]);
  const filteredOrders = customerOrders;
  const filterDirectories: Record<string,{id:string;name:string}[]> = {
    receivedOfficeId:metadataOptions.offices,takenByEmployeeId:metadataOptions.employees,
    followUpEmployeeId:metadataOptions.employees,followUpUserId:metadataOptions.users,
    status:Object.entries(ORDER_STATUS_LABELS).map(([id,name])=>({id,name})),
    sampleStatus:Object.entries(sampleStatusLabels).map(([id,name])=>({id,name})),
  };

  const openNewOrder = () => {
    setEditingOrder(null);
    setOrderModalOpen(true);
  };

  const openEditOrder = (o: CustomerOrder) => {
    setEditingOrder(o);
    setOrderModalOpen(true);
  };

  const handleOrderSubmit = async (payload: OrderFormSubmitPayload, mode: 'create' | 'update') => {
    if (mode === 'create') {
      const { order: created, cartelaDraftsCreated } = await createCustomerOrderApi({
        date: payload.date,
        customerId: payload.customerId,
        currency: payload.currency,
        receivedOfficeId: payload.receivedOfficeId,
        takenByEmployeeId: payload.takenByEmployeeId,
        followUpEmployeeId: payload.followUpEmployeeId,
        followUpUserId: payload.followUpUserId,
        sampleKind: payload.sampleKind,
        sampleStatus: payload.sampleStatus,
        sampleRequestedDate: payload.sampleRequestedDate,
        sampleReceivedDate: payload.sampleReceivedDate,
        sampleApprovedDate: payload.sampleApprovedDate,
        warehouse: payload.warehouse,
        shippingMethod: payload.shippingMethod,
        notes: payload.notes,
        items: payload.items,
        status: 'draft',
        expectedDate: payload.expectedDate,
        templateId: payload.templateId,
        orderNumber: payload.orderNumber,
        advancePayment: payload.advancePayment,
      });
      if(payload.status!=='draft')await updateCustomerOrderStatusApi(created.id,'pending_supply');
      const saved=payload.status==='draft'?created:await getCustomerOrderApi(created.id);
      setCustomerOrders((rows) => [saved, ...rows]);
      return { cartelaDraftsCreated };
    }
    if (editingOrder) {
      const { order: updated, cartelaDraftsCreated } = await updateCustomerOrderApi(editingOrder.id, {
        expectedUpdatedAt: payload.expectedUpdatedAt,
        changeReason:payload.changeReason,
        date: payload.date,
        customerId: payload.customerId,
        currency: payload.currency,
        receivedOfficeId: payload.receivedOfficeId,
        takenByEmployeeId: payload.takenByEmployeeId,
        followUpEmployeeId: payload.followUpEmployeeId,
        followUpUserId: payload.followUpUserId,
        sampleKind: payload.sampleKind,
        sampleStatus: payload.sampleStatus,
        sampleRequestedDate: payload.sampleRequestedDate,
        sampleReceivedDate: payload.sampleReceivedDate,
        sampleApprovedDate: payload.sampleApprovedDate,
        warehouse: payload.warehouse,
        shippingMethod: payload.shippingMethod,
        notes: payload.notes,
        items: payload.items,
        status: editingOrder.status,
        expectedDate: payload.expectedDate,
        templateId: payload.templateId,
        advancePayment: payload.advancePayment,
        ...(payload.orderNumber ? { orderNumber: payload.orderNumber } : {}),
      });
      if(editingOrder.status==='draft'&&payload.status!=='draft')await updateCustomerOrderStatusApi(updated.id,'pending_supply');
      const saved=editingOrder.status==='draft'&&payload.status!=='draft'?await getCustomerOrderApi(updated.id):updated;
      setCustomerOrders((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
      setDetailOrder((row) => (row?.id === saved.id ? saved : row));
      return { cartelaDraftsCreated };
    }
    return { cartelaDraftsCreated: 0 };
  };

  const resetTplForm = () => {
    setTplName('');
    setTplDesc('');
    setTplLines([emptyTplLine()]);
  };

  const saveTemplate = async () => {
    const name = tplName.trim();
    if (!name) return;
    const lines = tplLines.filter((l) => l.materialName.trim() || l.dsamNumber.trim());
    if (!lines.length) return;
    const created = await createOrderTemplateApi({ name, description: tplDesc.trim() || undefined, lines });
    setOrderTemplates((rows) => [created, ...rows]);
    resetTplForm();
    setTplModalOpen(false);
  };

  const handleStatusChange = async (id: string, status: CustomerOrderStatus) => {
    const previous = customerOrders;
    setCustomerOrders((rows) => rows.map((o) => (o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o)));
    try {
      const current=customerOrders.find(order=>order.id===id);
      const needsReason=status==='cancelled'||['completed','cancelled'].includes(current?.status??'');
      const reason=needsReason?window.prompt('سبب الإلغاء أو إعادة فتح الأوردر'):undefined;
      if(needsReason&&!reason?.trim())return;
      await updateCustomerOrderStatusApi(id, status,reason?.trim());
    } catch (e) {
      setCustomerOrders(previous);
      setError(e instanceof Error ? e.message : 'Failed to update order status');
    }
  };

  const handleDeleteOrder = async (id: string) => {
    const previous = customerOrders;
    setCustomerOrders((rows) => rows.filter((o) => o.id !== id));
    try {
      await deleteCustomerOrderApi(id);
    } catch (e) {
      setCustomerOrders(previous);
      setError(e instanceof Error ? e.message : 'Failed to delete order');
    }
  };

  const handleSendTelegram = async (order: CustomerOrder) => {
    const customer = customers.find((c) => c.id === order.customerId);
    if (!customer) {
      showToast({ type: 'error', message: t('toast.customerNotFound') });
      return;
    }
    setTelegramBusyId(order.id);
    try {
      await sendTelegramCustomerOrder(order, customer);
      showToast({ type: 'success', message: t('toast.telegramSent') });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof Error ? e.message : t('toast.telegramFailed'),
      });
    } finally {
      setTelegramBusyId(null);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    const previous = orderTemplates;
    setOrderTemplates((rows) => rows.filter((t) => t.id !== id));
    try {
      await deleteOrderTemplateApi(id);
    } catch (e) {
      setOrderTemplates(previous);
      setError(e instanceof Error ? e.message : 'Failed to delete template');
    }
  };

  const updateTplLine = (index: number, patch: Partial<OrderTemplateLine>) => {
    setTplLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <OrderNotificationRouting />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-indigo-600" />
            {t('pageTitle')}
          </h2>
          <p className="text-slate-500 mt-1">
            {t('pageSubtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === 'registry' ? (
            <button
              type="button"
              onClick={openNewOrder}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium"
            >
              <Plus className="w-4 h-4" />
              {t('newOrderButton')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                resetTplForm();
                setTplModalOpen(true);
              }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium"
            >
              <FileStack className="w-4 h-4" />
              {t('newTemplateButton')}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-1">
        <button
          type="button"
          onClick={() => setTab('registry')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-bold transition ${
            tab === 'registry'
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:bg-slate-100/80'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          {t('tabs.registry')}
        </button>
        <button
          type="button"
          onClick={() => setTab('templates')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-bold transition ${
            tab === 'templates'
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:bg-slate-100/80'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          {t('tabs.templates')}
        </button>
      </div>

      {(loading || error) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {error || 'Loading customer orders...'}
        </div>
      )}

      {tab === 'registry' && <div className="flex flex-wrap gap-2" dir="rtl">
       {Object.entries({receivedOfficeId:'المكتب المستلم',takenByEmployeeId:'آخذ الطلب',followUpEmployeeId:'موظف المتابعة',followUpUserId:'مستخدم المتابعة',status:'الحالة',sampleStatus:'حالة العينة'}).map(([key,label])=><label key={key} className="text-xs">{label}<select className="block border rounded-lg p-2" value={metadataFilters[key] || ''} onChange={e=>setMetadataFilters({...metadataFilters,[key]:e.target.value})}>
        <option value="">الكل</option>{filterDirectories[key].map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
       </select></label>)}
       {Object.entries({expectedFrom:'موعد التسليم من',expectedTo:'موعد التسليم إلى',material:'الخامة',color:'اللون'}).map(([key,label])=><label key={key} className="text-xs">{label}{key.startsWith('expected') ? <DateInput className="block border rounded-lg p-2" value={metadataFilters[key] || ''} onChange={e=>setMetadataFilters({...metadataFilters,[key]:e.target.value})}/> : <input className="block border rounded-lg p-2" type="text" value={metadataFilters[key] || ''} onChange={e=>setMetadataFilters({...metadataFilters,[key]:e.target.value})}/>}</label>)}
       <label className="text-xs">الترتيب<select className="block border rounded-lg p-2" value={metadataFilters.sort || ''} onChange={e=>setMetadataFilters({...metadataFilters,sort:e.target.value})}><option value="">الأحدث</option><option value="expectedDate">موعد التسليم الأقرب</option></select></label>
       <button type="button" className="border rounded-lg px-3 text-xs" onClick={()=>{setMetadataFilters({});setSearch('');}}>مسح الفلاتر</button>
      </div>}
      {tab === 'registry' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
            <div className="relative flex-1 max-w-md min-w-[200px]">
              <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">{t('colOrderNo')}</th>
                  <th className="px-4 py-3">{t('colDate')}</th>
                  <th className="px-4 py-3">{t('colCustomer')}</th>
                  <th className="px-4 py-3">{t('colItems')}</th>
                  <th className="px-4 py-3">{t('colExpectedDelivery')}</th>
                  <th className="px-4 py-3">{t('colTotal')}</th>
                  <th className="px-4 py-3 min-w-[140px]">{t('colStatus')}</th>
                  <th className="px-4 py-3">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((o) => {
                  const customer = customers.find((c) => c.id === o.customerId);
                  const total = o.items.reduce((s, i) => s + i.length * i.price, 0);
                  return (
                    <tr
                      key={o.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetailOrder(o);
                        }
                      }}
                      className="hover:bg-indigo-50/40 cursor-pointer transition-colors"
                      onClick={() => setDetailOrder(o)}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-indigo-600">
                        {displayCustomerOrderNumber(o.orderNumber)}
                        <div className="text-xs font-normal text-slate-500">{[o.receivedOfficeName,o.takenByEmployeeName,o.followUpEmployeeName,o.followUpUserName].filter(Boolean).join(" / ")}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{format(new Date(o.date), 'PP', { locale: dateLocale })}</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{customer?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{o.items.length}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {o.expectedDate ? format(new Date(o.expectedDate), 'PP', { locale: dateLocale }) : '—'}
                          </span>
                          {(() => {
                            const countdown = orderDeliveryCountdown(o.expectedDate, o.status);
                            if (!countdown) return null;
                            return (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${deliveryCountdownClass(countdown.tone)}`}
                                title={t('deliveryCountdownTooltip')}
                              >
                                {countdown.label}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold">
                        {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        <span className="text-xs text-slate-500">{o.currency}</span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={o.status}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onChange={(e) => void handleStatusChange(o.id, e.target.value as CustomerOrderStatus)}
                          className={`text-xs font-bold rounded-lg px-2 py-1.5 border max-w-[160px] ${statusBadgeClass(o.status)}`}
                        >
                          {(Object.keys(ORDER_STATUS_LABELS) as CustomerOrderStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {ORDER_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailOrder(o);
                            }}
                            className="text-violet-700 hover:bg-violet-50 px-2 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {t('actions.view')}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditOrder(o);
                            }}
                            className="text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {t('actions.edit')}
                          </button>
                          <TelegramSendButton
                            size="compact"
                            label={t('actions.telegram')}
                            busy={telegramBusyId === o.id}
                            onClick={() => void handleSendTelegram(o)}
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(t('confirm.deleteOrder'))) void handleDeleteOrder(o.id);
                            }}
                            className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('actions.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-14 text-center text-slate-500">
                      {t('emptyOrders')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-3 text-sm border-t">
           <button type="button" disabled={loading || orderPage<=1} onClick={()=>setOrderPage(p=>p-1)} className="border rounded px-3 py-1 disabled:opacity-50">السابق</button>
           <span>{orderTotal} أوردر — الصفحة {orderPage}</span>
           <button type="button" disabled={loading || orderPage*200>=orderTotal} onClick={()=>setOrderPage(p=>p+1)} className="border rounded px-3 py-1 disabled:opacity-50">التالي</button>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">{tpl.name}</h3>
                  {tpl.description && <p className="text-sm text-slate-500 mt-1">{tpl.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('confirm.deleteTemplate'))) void handleDeleteTemplate(tpl.id);
                  }}
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                  aria-label={t('actions.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="text-xs text-slate-500 font-mono">{t('template.lineCount', { count: tpl.lines.length })}</div>
              <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                {tpl.lines.slice(0, 4).map((line, i) => (
                  <li key={i}>
                    {line.materialName || t('template.materialFallback')} — {line.dsamNumber}
                  </li>
                ))}
                {tpl.lines.length > 4 && <li className="text-slate-400">…</li>}
              </ul>
            </div>
          ))}
          {orderTemplates.length === 0 && (
            <div className="sm:col-span-2 lg:col-span-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-10 text-center text-slate-500">
              {t('emptyTemplates')}
            </div>
          )}
        </div>
      )}

      <OrderDetailModal
        open={detailOrder !== null}
        order={detailOrder}
        customer={customers.find((c) => c.id === detailOrder?.customerId)}
        onClose={() => setDetailOrder(null)}
      />

      <OrderFormModal
        open={orderModalOpen}
        onClose={() => {
          setOrderModalOpen(false);
          setEditingOrder(null);
        }}
        customers={customers}
        inventory={inventory}
        templates={orderTemplates}
        editingOrder={editingOrder}
        onSubmit={handleOrderSubmit}
      />

      {tplModalOpen && (
        <div className="fixed inset-0 z-[190] flex items-center justify-center p-4 bg-slate-900/50" dir="rtl">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">{t('templateModal.title')}</h3>
              <button
                type="button"
                onClick={() => setTplModalOpen(false)}
                className="text-slate-500 hover:text-slate-800 p-2"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-600">
              {t('templateModal.description')}
            </p>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">{t('templateModal.nameLabel')}</label>
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder={t('templateModal.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">{t('templateModal.descriptionLabel')}</label>
              <textarea
                value={tplDesc}
                onChange={(e) => setTplDesc(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-800">{t('templateModal.linesLabel')}</span>
                <button
                  type="button"
                  onClick={() => setTplLines((r) => [...r, emptyTplLine()])}
                  className="text-sm text-indigo-600 font-medium"
                >
                  {t('templateModal.addLine')}
                </button>
              </div>
              {tplLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <input
                    placeholder={t('templateModal.linePlaceholders.material')}
                    value={line.materialName}
                    onChange={(e) => updateTplLine(idx, { materialName: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm col-span-2"
                  />
                  <input
                    placeholder={t('templateModal.linePlaceholders.design')}
                    value={line.dsamNumber}
                    onChange={(e) => updateTplLine(idx, { dsamNumber: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder={t('templateModal.linePlaceholders.pricePerMeter')}
                    type="number"
                    value={line.price || ''}
                    onChange={(e) => updateTplLine(idx, { price: Number(e.target.value) || 0 })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <input
                    placeholder={t('templateModal.linePlaceholders.color')}
                    value={line.colorName}
                    onChange={(e) => updateTplLine(idx, { colorName: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder={t('templateModal.linePlaceholders.colorCode')}
                    value={line.colorCode}
                    onChange={(e) => updateTplLine(idx, { colorCode: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <input
                    placeholder={t('templateModal.linePlaceholders.length')}
                    type="number"
                    value={line.length || ''}
                    onChange={(e) => updateTplLine(idx, { length: Number(e.target.value) || 0 })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <input
                    placeholder={t('templateModal.linePlaceholders.widthCm')}
                    type="number"
                    value={line.widthCm || ''}
                    onChange={(e) => updateTplLine(idx, { widthCm: Number(e.target.value) || 0 })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <div className="flex justify-end col-span-2 sm:col-span-4">
                    <button
                      type="button"
                      onClick={() => setTplLines((r) => r.filter((_, i) => i !== idx))}
                      disabled={tplLines.length <= 1}
                      className="text-rose-600 text-xs disabled:opacity-30"
                    >
                      {t('templateModal.deleteLine')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTplModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700"
              >
                {t('templateModal.cancel')}
              </button>
              <button
                type="button"
                onClick={saveTemplate}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
              >
                {t('templateModal.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
