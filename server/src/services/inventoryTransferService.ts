import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TransferInput } from './inventoryTransferValidation.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';

export class TransferError extends Error {
  constructor(message: string, public code = 'VALIDATION', public statusCode = 400) { super(message); }
}

export async function transferTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Preserve the original failure if the connection also fails during rollback.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function validateTransferWarehouses(client: PoolClient, companyId: string, d: TransferInput, allowSameWarehouse = false) {
  if (!allowSameWarehouse && d.fromWarehouseId === d.toWarehouseId) throw new TransferError('لا يمكن النقل إلى مستودع المصدر نفسه');
  const wh = await client.query(
    `SELECT id, is_active FROM warehouses WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,
    [companyId, [d.fromWarehouseId, d.toWarehouseId]],
  );
  if (wh.rows.length !== new Set([d.fromWarehouseId, d.toWarehouseId]).size || wh.rows.some((r) => !r.is_active)) throw new TransferError('مستودع المصدر أو الوجهة غير موجود أو غير نشط');
  const locations = [
    { id: d.fromLocationId, warehouse: d.fromWarehouseId },
    { id: d.toLocationId, warehouse: d.toWarehouseId },
  ].filter((l) => l.id).sort((a, b) => a.id!.localeCompare(b.id!));
  for (const loc of locations) {
    const row = await client.query(
      'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3 AND is_active=true FOR SHARE',
      [loc.id, loc.warehouse, companyId],
    );
    if (!row.rows.length) throw new TransferError('موقع التخزين لا يتبع المستودع المحدد');
  }
}

export async function lockTransferRolls(client: PoolClient, companyId: string, d: TransferInput) {
  const ids = d.lines.map((l) => l.fabricRollId);
  if (!ids.length || new Set(ids).size !== ids.length || d.lines.some((l) => l.quantity !== 1)) throw new TransferError('اختيار الرولات مكرر أو الكمية غير صالحة');
  const result = await client.query(
    `SELECT id, barcode, warehouse_id, location_id, status, length_m FROM fabric_rolls
     WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [companyId, ids],
  );
  if (result.rows.length !== ids.length) throw new TransferError('إحدى الرولات غير موجودة أو لا تتبع الشركة');
  for (const r of result.rows) {
    if (r.warehouse_id !== d.fromWarehouseId) throw new TransferError(`الرولة ${r.barcode} لم تعد في مستودع المصدر`, 'STOCK_CHANGED', 409);
    if (d.fromLocationId && r.location_id !== d.fromLocationId) throw new TransferError(`الرولة ${r.barcode} لا تطابق موقع المصدر`, 'STOCK_CHANGED', 409);
    if (r.status !== 'AVAILABLE' || !Number.isFinite(Number(r.length_m)) || Number(r.length_m) <= 0) throw new TransferError(`الرولة ${r.barcode} غير متاحة أو ليس لها رصيد موجب`, 'STOCK_CHANGED', 409);
  }
  return result.rows;
}

async function lockDocument(client: PoolClient, companyId: string, id: string) {
  const result = await client.query('SELECT * FROM inventory_transfers WHERE id=$1 AND company_id=$2 FOR UPDATE', [id, companyId]);
  if (!result.rows.length) throw new TransferError('المناقلة غير موجودة', 'NOT_FOUND', 404);
  return result.rows[0];
}

export function transferRequestHash(d: TransferInput): string {
  return createHash('sha256').update(JSON.stringify({
    from: d.fromWarehouseId, to: d.toWarehouseId,
    fromLocation: d.fromLocationId ?? null, toLocation: d.toLocationId ?? null,
    date: d.transferDate ?? null, notes: d.notes ?? null,
    lines: [...d.lines].sort((a, b) => a.fabricRollId.localeCompare(b.fabricRollId)).map((l) => ({
      id: l.fabricRollId, quantity: l.quantity, barcode: l.barcode ?? null, notes: l.notes ?? null,
    })),
  })).digest('hex');
}

async function insertLines(client: PoolClient, companyId: string, id: string, d: TransferInput) {
  await client.query(
    `INSERT INTO inventory_transfer_lines (company_id,transfer_id,fabric_roll_id,barcode,quantity,notes)
     SELECT $1,$2,x."fabricRollId",x.barcode,1,x.notes
     FROM jsonb_to_recordset($3::jsonb) AS x("fabricRollId" uuid,barcode text,notes text)`,
    [companyId, id, JSON.stringify(d.lines)],
  );
}

export async function saveTransfer(client: PoolClient, companyId: string, userId: string, d: TransferInput, id?: string) {
  if (!id && !d.clientRequestId) throw new TransferError('معرّف الطلب مطلوب لمنع تكرار المناقلة');
  const hash = transferRequestHash(d);
  if (!id) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [companyId, d.clientRequestId]);
    const previous = await client.query('SELECT * FROM inventory_transfers WHERE company_id=$1 AND client_request_id=$2', [companyId, d.clientRequestId]);
    if (previous.rows.length) {
      if (previous.rows[0].request_hash !== hash) throw new TransferError('استُخدم معرّف الطلب مع بيانات مختلفة؛ راجع المناقلة السابقة', 'REQUEST_CONFLICT', 409);
      return previous.rows[0];
    }
  } else {
    const current = await lockDocument(client, companyId, id);
    if (current.status !== 'DRAFT') throw new TransferError('لا يمكن تعديل مناقلة مؤكدة أو ملغاة', 'INVALID_STATE', 409);
  }
  await validateTransferWarehouses(client, companyId, d);
  await lockTransferRolls(client, companyId, d);
  const date = d.transferDate ?? new Date().toISOString().slice(0, 10);
  let row;
  if (id) {
    const result = await client.query(
      `UPDATE inventory_transfers SET from_warehouse_id=$3,to_warehouse_id=$4,from_location_id=$5,to_location_id=$6,
       transfer_date=$7::date,notes=$8,updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *`,
      [id, companyId, d.fromWarehouseId, d.toWarehouseId, d.fromLocationId ?? null, d.toLocationId ?? null, date, d.notes ?? null],
    );
    row = result.rows[0];
    await client.query('DELETE FROM inventory_transfer_lines WHERE transfer_id=$1 AND company_id=$2', [id, companyId]);
  } else {
    const result = await client.query(
      `INSERT INTO inventory_transfers (company_id,transfer_no,from_warehouse_id,to_warehouse_id,from_location_id,to_location_id,
       transfer_date,notes,created_by_user_id,client_request_id,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11) RETURNING *`,
      [companyId, generateDocumentNo('TRF'), d.fromWarehouseId, d.toWarehouseId, d.fromLocationId ?? null, d.toLocationId ?? null,
        date, d.notes ?? null, userId, d.clientRequestId, hash],
    );
    row = result.rows[0];
  }
  await insertLines(client, companyId, row.id, d);
  return row;
}

export async function confirmTransfer(client: PoolClient, companyId: string, userId: string, id: string, expectedUpdatedAt?: string) {
  const head = await lockDocument(client, companyId, id);
  if (head.status === 'CONFIRMED') return head;
  if (head.status !== 'DRAFT') throw new TransferError('المناقلة ملغاة ولا يمكن تأكيدها', 'INVALID_STATE', 409);
  if (expectedUpdatedAt && new Date(head.updated_at).toISOString() !== new Date(expectedUpdatedAt).toISOString()) throw new TransferError('تغيّرت المسودة بعد مراجعتها؛ افتح المراجعة مجدداً', 'DOCUMENT_CHANGED', 409);
  const lines = await client.query('SELECT fabric_roll_id,quantity FROM inventory_transfer_lines WHERE transfer_id=$1 AND company_id=$2', [id, companyId]);
  const d: TransferInput = {
    fromWarehouseId: head.from_warehouse_id, toWarehouseId: head.to_warehouse_id,
    fromLocationId: head.from_location_id, toLocationId: head.to_location_id,
    lines: lines.rows.map((l) => ({ fabricRollId: l.fabric_roll_id, quantity: Number(l.quantity) })),
  };
  await validateTransferWarehouses(client, companyId, d);
  const rolls = await lockTransferRolls(client, companyId, d);
  for (const roll of rolls) {
    await client.query(
      `UPDATE fabric_rolls SET warehouse_id=$3,location_id=$4,updated_at=now() WHERE id=$1 AND company_id=$2`,
      [roll.id, companyId, d.toWarehouseId, d.toLocationId ?? null],
    );
    // Warehouse changes do not change global quantity, cost, weight, or availability.
    // No length/weight deltas: reports treat non-zero deltas as changes to total stock.
    await client.query(
      `INSERT INTO inventory_movements (company_id,roll_id,movement_type,from_warehouse_id,to_warehouse_id,
       from_location_id,to_location_id,old_status,new_status,reference_type,reference_id,reference_no,notes,created_by_user_id)
       SELECT $1,$2,m,$3,$4,$5,$6,'AVAILABLE','AVAILABLE','INVENTORY_TRANSFER',$7,$8,$9,$10
       FROM unnest(ARRAY['TRANSFER_OUT','TRANSFER_IN']::text[]) AS movement(m)`,
      [companyId, roll.id, d.fromWarehouseId, d.toWarehouseId, roll.location_id, d.toLocationId ?? null,
        id, head.transfer_no, 'مناقلة بين المستودعات', userId],
    );
  }
  const result = await client.query("UPDATE inventory_transfers SET status='CONFIRMED',confirmed_at=now(),updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *", [id, companyId]);
  return result.rows[0];
}

export async function cancelTransfer(client: PoolClient, companyId: string, id: string) {
  const head = await lockDocument(client, companyId, id);
  if (head.status === 'CANCELLED') return head;
  if (head.status !== 'DRAFT') throw new TransferError('لا يمكن إلغاء مناقلة مؤكدة', 'INVALID_STATE', 409);
  const result = await client.query("UPDATE inventory_transfers SET status='CANCELLED',cancelled_at=now(),updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *", [id, companyId]);
  return result.rows[0];
}
