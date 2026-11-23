import type { Pool, PoolClient } from 'pg';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/** null = بلا تقييد (يرى كل مستودعات فرعه). مصفوفة = المستودعات المسموحة فقط. */
export type WarehouseScope = string[] | null;

export async function loadUserWarehouseScope(db: Db, userId: string, role: string): Promise<WarehouseScope> {
  if (role === 'admin') return null;
  const r = await db.query<{ warehouse_id: string }>('SELECT warehouse_id FROM user_warehouses WHERE user_id=$1', [userId]);
  return r.rows.length ? r.rows.map((x) => x.warehouse_id.toLowerCase()) : null;
}

export function warehouseAllowed(scope: WarehouseScope | undefined, warehouseId: string | null | undefined): boolean {
  if (!scope) return true;
  if (!warehouseId) return false;
  return scope.includes(String(warehouseId).toLowerCase());
}

export const WAREHOUSE_FORBIDDEN_MSG = 'هذا المستودع غير مخصّص لحسابك';

/** يرمي VALIDATION/FORBIDDEN إن لم يُسمح بالمستودع. */
export function assertWarehouseAllowed(scope: WarehouseScope | undefined, warehouseId: string | null | undefined): void {
  if (!warehouseAllowed(scope, warehouseId)) throw Object.assign(new Error(WAREHOUSE_FORBIDDEN_MSG), { code: 'FORBIDDEN' });
}

/** يتحقق أن كل الأتواب المعطاة داخل المستودعات المسموحة. */
export async function assertRollsInScope(db: Db, companyId: string, scope: WarehouseScope | undefined, rollIds: Array<string | null | undefined>): Promise<void> {
  if (!scope) return;
  const ids = [...new Set(rollIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const r = await db.query<{ id: string; warehouse_id: string | null }>(
    'SELECT id, warehouse_id FROM fabric_rolls WHERE company_id=$1 AND id = ANY($2::uuid[])', [companyId, ids]);
  for (const row of r.rows) assertWarehouseAllowed(scope, row.warehouse_id);
}

export async function listUserWarehouses(db: Db, userId: string): Promise<string[]> {
  const r = await db.query<{ warehouse_id: string }>('SELECT warehouse_id FROM user_warehouses WHERE user_id=$1 ORDER BY warehouse_id', [userId]);
  return r.rows.map((x) => x.warehouse_id);
}

/** يستبدل مستودعات المستخدم (مصفوفة فارغة = بلا تقييد). المستودعات يجب أن تكون من نفس الفرع. */
export async function saveUserWarehouses(client: PoolClient, input: { companyId: string; userId: string; warehouseIds: string[]; changedBy: string }): Promise<string[]> {
  const u = await client.query<{ company_id: string; role: string }>('SELECT company_id, role FROM users WHERE id=$1 FOR UPDATE', [input.userId]);
  if (!u.rows[0] || u.rows[0].company_id !== input.companyId) throw Object.assign(new Error('المستخدم غير موجود'), { code: 'NOT_FOUND' });
  if (u.rows[0].role === 'admin' && input.warehouseIds.length) throw Object.assign(new Error('لا يمكن تقييد مدير النظام بمستودعات'), { code: 'VALIDATION' });
  const ids = [...new Set(input.warehouseIds)];
  if (ids.length) {
    const ok = await client.query('SELECT id FROM warehouses WHERE company_id=$1 AND id = ANY($2::uuid[])', [input.companyId, ids]);
    if (ok.rows.length !== ids.length) throw Object.assign(new Error('مستودع غير صالح'), { code: 'VALIDATION' });
  }
  await client.query('DELETE FROM user_warehouses WHERE user_id=$1', [input.userId]);
  for (const w of ids) {
    await client.query('INSERT INTO user_warehouses(user_id, warehouse_id, company_id, granted_by) VALUES($1,$2,$3,$4)', [input.userId, w, input.companyId, input.changedBy]);
  }
  return ids;
}
