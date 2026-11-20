import type { CustomerOrderMetadata } from '../../types';
import type { CustomerOrder, CustomerOrderStatus, OrderTemplate } from '../../types';
import { apiFetch } from './client';

export type CustomerOrderPayload = CustomerOrderMetadata & {
  orderNumber?: string;
  date: string;
  customerId: string;
  currency: string;
  warehouse?: string;
  shippingMethod?: string;
  notes?: string;
  items: CustomerOrder['items'];
  status: CustomerOrderStatus;
  expectedDate?: string;
  templateId?: string;
  advancePayment?: number;
  expectedUpdatedAt?: string;
  changeReason?:string;
};

function sanitizeOrderPayload(payload: CustomerOrderPayload): CustomerOrderPayload {
  return {
    ...payload,
    orderNumber: payload.orderNumber?.trim() || undefined,
    warehouse: payload.warehouse?.trim() || undefined,
    shippingMethod: payload.shippingMethod?.trim() || undefined,
    notes: payload.notes?.trim() || undefined,
    expectedDate: payload.expectedDate?.trim() || undefined,
    templateId: payload.templateId?.trim() || undefined,
    advancePayment:
      payload.advancePayment != null && Number.isFinite(payload.advancePayment)
        ? payload.advancePayment
        : undefined,
    items: payload.items.map((line) => ({
      ...line,
      materialName: line.materialName ?? '',
      dsamNumber: line.dsamNumber ?? '',
      rollNo: line.rollNo ?? '',
      colorCode: line.colorCode ?? '',
      colorName: line.colorName ?? '',
      note: line.note?.trim() || undefined,
      imageUrl:
        line.imageUrl && String(line.imageUrl).trim().startsWith('data:image/')
          ? String(line.imageUrl).trim()
          : line.imageUrl?.trim() || undefined,
      referenceBarcode: line.referenceBarcode?.trim() || undefined,
    })),
  };
}

export type CustomerOrdersListResult = {
  data: CustomerOrder[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listCustomerOrders(params: { search?: string; status?: CustomerOrderStatus; receivedOfficeId?: string; takenByEmployeeId?: string; followUpEmployeeId?: string; followUpUserId?: string; sampleStatus?: string; expectedFrom?: string; expectedTo?: string; material?: string; color?: string; sort?: string; page?: number } = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  for (const [key,value] of Object.entries(params)) if (value) q.set(key,String(value));
  q.set('pageSize', '200');
  const res = await apiFetch<CustomerOrdersListResult & { ok: boolean }>(`/api/customer-orders?${q}`);
  return res;
}

export type CustomerOrderSaveResult = {
  order: CustomerOrder;
  cartelaDraftsCreated: number;
};

export async function createCustomerOrderApi(payload: CustomerOrderPayload): Promise<CustomerOrderSaveResult> {
  const res = await apiFetch<{ ok: boolean; data: CustomerOrder; cartelaDraftsCreated?: number }>(
    '/api/customer-orders',
    {
      method: 'POST',
      body: JSON.stringify(sanitizeOrderPayload(payload)),
    },
  );
  return { order: res.data, cartelaDraftsCreated: res.cartelaDraftsCreated ?? 0 };
}

export async function updateCustomerOrderApi(
  id: string,
  payload: CustomerOrderPayload,
): Promise<CustomerOrderSaveResult> {
  const res = await apiFetch<{ ok: boolean; data: CustomerOrder; cartelaDraftsCreated?: number }>(
    `/api/customer-orders/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(sanitizeOrderPayload(payload)),
    },
  );
  return { order: res.data, cartelaDraftsCreated: res.cartelaDraftsCreated ?? 0 };
}

export async function updateCustomerOrderStatusApi(id: string, status: CustomerOrderStatus,reason?:string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/customer-orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status,reason }),
  });
}

export const getCustomerOrderApi=(id:string)=>apiFetch<{data:CustomerOrder}>(`/api/customer-orders/${encodeURIComponent(id)}`).then(result=>result.data);

export async function deleteCustomerOrderApi(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/customer-orders/${id}`, { method: 'DELETE' });
}

export async function listOrderTemplatesApi(): Promise<OrderTemplate[]> {
  const res = await apiFetch<{ ok: boolean; data: OrderTemplate[] }>('/api/customer-orders/templates');
  return res.data;
}

export async function createOrderTemplateApi(payload: Omit<OrderTemplate, 'id' | 'createdAt'>): Promise<OrderTemplate> {
  const res = await apiFetch<{ ok: boolean; data: OrderTemplate }>('/api/customer-orders/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function deleteOrderTemplateApi(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/customer-orders/templates/${id}`, { method: 'DELETE' });
}

export type CustomerOrderImportLine = {
  orderLineId: string;
  materialName: string;
  dsamNumber: string;
  rollNo: string;
  colorCode: string;
  colorName: string;
  metersPerRoll: number;
  rollCount: number;
  orderedMeters: number;
  fulfilledMeters: number;
  remainingMeters: number;
  price: number;
  referenceBarcode?: string;
  widthCm?: number;
  gsm?: number;
  weight?: number;
  note?: string;
};

export type CustomerOrderImportPreview = {
  orderId: string;
  orderNumber: string;
  customerId: string;
  currency: string;
  warehouse?: string;
  status: CustomerOrderStatus;
  lines: CustomerOrderImportLine[];
};

export async function fetchCustomerOrderImportPreview(orderNo: string): Promise<CustomerOrderImportPreview> {
  const encoded = encodeURIComponent(orderNo.trim());
  const res = await apiFetch<{ ok: boolean; data: CustomerOrderImportPreview }>(
    `/api/customer-orders/import-preview/${encoded}`,
  );
  return res.data;
}

export type OrderMetadataOption = { id: string; name: string; isActive: boolean };
export type OrderMetadataOptions = { offices: OrderMetadataOption[]; employees: OrderMetadataOption[]; users: OrderMetadataOption[]; takers?: string[] };
export async function listOrderMetadataOptions(): Promise<OrderMetadataOptions> {
 const res = await apiFetch<{ok:boolean;data:OrderMetadataOptions}>('/api/customer-orders/metadata-options');
 return res.data;
}

export async function createOrderOffice(code: string, name: string): Promise<OrderMetadataOption> {
 const res = await apiFetch<{ok:boolean;data:OrderMetadataOption}>('/api/customer-orders/offices',{method:'POST',body:JSON.stringify({code,name})});
 return res.data;
}
