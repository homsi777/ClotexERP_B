import { apiFetch } from './client';

export interface PricingQueueItem {
  kind: 'SALES' | 'PURCHASE' | 'EXTERNAL';
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  partyName: string;
}

interface Queue { total: number; items: PricingQueueItem[] }

/** مسودات بيع وشراء بحاجة إلى تسعير (للمحاسب/المدير فقط؛ غيرهما يستلم قائمة فارغة من الخادم). */
export async function fetchPricingQueue(): Promise<Queue> {
  const [s, p] = await Promise.allSettled([
    apiFetch<{ ok: boolean; data: Queue }>('/api/sales-invoices/pricing-queue'),
    apiFetch<{ ok: boolean; data: Queue }>('/api/purchase-invoices/pricing-queue'),
  ]);
  const items = [
    ...(s.status === 'fulfilled' ? s.value.data.items : []),
    ...(p.status === 'fulfilled' ? p.value.data.items : []),
  ];
  return { total: items.length, items };
}
