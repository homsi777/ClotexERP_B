import type { PoolClient } from 'pg';

const EPS = 1e-3;

function metersFromQuantity(quantity: number, unit: string): number {
  return unit === 'yard' ? Math.round(quantity * 0.9144 * 1000) / 1000 : quantity;
}

export async function getOrderLineFulfilledMeters(
  client: PoolClient,
  companyId: string,
  orderLineId: string,
): Promise<number> {
  const row = await client.query<{ fulfilled: string }>(
    `SELECT COALESCE(SUM(
       CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144
         WHEN sil.unit='kg' AND sil.commodity_type='FABRIC' THEN COALESCE(fr.length_m,0)
         WHEN sil.unit='kg' THEN 0 ELSE sil.quantity END
     ), 0)::float AS fulfilled
     FROM sales_invoice_lines sil
     INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
     LEFT JOIN fabric_rolls fr ON fr.id=sil.fabric_roll_id AND fr.company_id=sil.company_id
     WHERE sil.company_id = $1
       AND sil.customer_order_line_id = $2::uuid
       AND si.document_status = 'CONFIRMED'`,
    [companyId, orderLineId],
  );
  return Number(row.rows[0]?.fulfilled ?? 0);
}

export async function getOrderLineOrderedMeters(
  client: PoolClient,
  companyId: string,
  orderLineId: string,
): Promise<number> {
  const row = await client.query<{ length: string; unit_type: string }>(
    `SELECT length, unit_type FROM customer_order_lines WHERE id = $1 AND company_id = $2`,
    [orderLineId, companyId],
  );
  if (!row.rows.length) return 0;
  const ln = row.rows[0];
  return metersFromQuantity(Number(ln.length), ln.unit_type || 'meter');
}

export async function syncCustomerOrderStatusFromFulfillment(
  client: PoolClient,
  companyId: string,
  orderId: string,
  userId: string | null,
): Promise<void> {
  const order = await client.query<{ status: string }>(
    `SELECT status FROM customer_orders WHERE id = $1 AND company_id = $2`,
    [orderId, companyId],
  );
  if (!order.rows.length) return;
  const currentStatus = order.rows[0].status;
  if (currentStatus === 'cancelled' || currentStatus === 'draft' || currentStatus === 'completed') return;

  const lines = await client.query<{ id: string; length: string; unit_type: string }>(
    `SELECT id, length, unit_type FROM customer_order_lines WHERE order_id = $1 AND company_id = $2 ORDER BY line_no`,
    [orderId, companyId],
  );
  if (!lines.rows.length) return;

  let anyFulfilled = false;
  let allFulfilled = true;

  for (const ln of lines.rows) {
    const ordered = metersFromQuantity(Number(ln.length), ln.unit_type || 'meter');
    const fulfilled = await getOrderLineFulfilledMeters(client, companyId, ln.id);
    if (fulfilled > EPS) anyFulfilled = true;
    if (ordered - fulfilled > EPS) allFulfilled = false;
  }

  let nextStatus = currentStatus;
  if (allFulfilled) {
    nextStatus = 'ready_pickup';
  } else if (anyFulfilled) {
    nextStatus = 'partial_ready';
  } else if (currentStatus === 'partial_ready' || currentStatus === 'ready_pickup' || currentStatus === 'completed') {
    nextStatus = 'pending_supply';
  }

  if (nextStatus !== currentStatus) {
    await client.query(
      `UPDATE customer_orders
       SET status = $3, updated_by_user_id = $4, updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [orderId, companyId, nextStatus, userId],
    );
  }
}

export async function syncCustomerOrderFulfillmentForInvoice(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  userId: string | null,
): Promise<void> {
  const row = await client.query<{ customer_order_id: string | null }>(
    `SELECT customer_order_id FROM sales_invoices WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId],
  );
  const orderId = row.rows[0]?.customer_order_id;
  if (!orderId) return;
  await syncCustomerOrderStatusFromFulfillment(client, companyId, orderId, userId);
}

export async function assertSalesInvoiceCustomerMatchesOrder(
  client: PoolClient,
  companyId: string,
  customerOrderId: string,
  customerId: string,
): Promise<void> {
  const row = await client.query<{ customer_id: string; status: string; order_no: string }>(
    `SELECT customer_id, status, order_no FROM customer_orders WHERE id = $1 AND company_id = $2`,
    [customerOrderId, companyId],
  );
  if (!row.rows.length) {
    throw Object.assign(new Error('طلبية العميل غير موجودة'), { code: 'NOT_FOUND' });
  }
  const order = row.rows[0];
  if (['cancelled', 'completed', 'draft'].includes(order.status)) {
    throw Object.assign(new Error('يجب تأكيد الطلبية وأن تكون مفتوحة قبل ربط الفاتورة'), { code: 'VALIDATION' });
  }
  if (order.customer_id !== customerId) {
    throw Object.assign(new Error('العميل في الفاتورة لا يطابق عميل الطلبية'), { code: 'VALIDATION' });
  }
}

/** Serialise confirmations for one order before checking quantities or changing stock. */
export async function assertInvoiceOrderRemaining(client: PoolClient, companyId: string, invoiceId: string): Promise<void> {
  const header = (await client.query('SELECT customer_order_id,customer_id FROM sales_invoices WHERE company_id=$1 AND id=$2',[companyId,invoiceId])).rows[0];
  const lines = (await client.query(`SELECT s.*,fr.length_m AS roll_length_m FROM sales_invoice_lines s
    LEFT JOIN fabric_rolls fr ON fr.company_id=s.company_id AND fr.id=s.fabric_roll_id
    WHERE s.company_id=$1 AND s.invoice_id=$2 ORDER BY s.line_no`,[companyId,invoiceId])).rows;
  if (!header?.customer_order_id) {
    if (lines.some(l => l.customer_order_line_id)) throw Object.assign(new Error('حدد أوردر الفاتورة قبل ربط سطوره'),{code:'VALIDATION'});
    return;
  }
  const orderId = header.customer_order_id;
  await client.query('SELECT id FROM customer_orders WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,orderId]);
  await assertSalesInvoiceCustomerMatchesOrder(client,companyId,orderId,header.customer_id);
  const ordered = (await client.query('SELECT id,length,unit_type FROM customer_order_lines WHERE company_id=$1 AND order_id=$2 ORDER BY id FOR UPDATE',[companyId,orderId])).rows;
  const byId = new Map(ordered.map(l=>[l.id,l]));
  const totals = new Map<string,number>();
  for (const line of lines) {
    if (!line.customer_order_line_id || !byId.has(line.customer_order_line_id)) throw Object.assign(new Error('سطر الفاتورة لا يتبع أوردر العميل المحدد'),{code:'VALIDATION'});
    let quantity = metersFromQuantity(Number(line.quantity),line.unit);
    if (line.unit === 'kg') {
      if (line.commodity_type !== 'FABRIC' || !(Number(line.roll_length_m)>0)) throw Object.assign(new Error('تعذر تحديد أمتار سطر الأوردر المباع بالوزن'),{code:'VALIDATION'});
      quantity = Number(line.roll_length_m);
    }
    totals.set(line.customer_order_line_id,(totals.get(line.customer_order_line_id)??0)+quantity);
  }
  for (const [id, quantity] of totals) {
    const line = byId.get(id)!;
    const orderedM = metersFromQuantity(Number(line.length),line.unit_type);
    const fulfilledM = await getOrderLineFulfilledMeters(client,companyId,id);
    if (quantity + fulfilledM > orderedM + 0.0005) throw Object.assign(new Error('كمية الفاتورة تتجاوز المتبقي من سطر الأوردر؛ عدّل الأوردر بصلاحية مناسبة أولاً'),{code:'VALIDATION'});
  }
}
