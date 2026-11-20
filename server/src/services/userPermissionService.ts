import type { Pool, PoolClient } from 'pg';
import { effectiveCustomPermissions, expandImplied, isMatrixCode } from './permissionCatalog.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type PermMode = 'ROLE' | 'CUSTOM';

export async function rolePermissionCodes(db: Db, roleCode: string): Promise<string[]> {
  const r = await db.query<{ code: string }>(
    `SELECT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN roles r ON r.id = rp.role_id
      WHERE r.code = $1 ORDER BY p.code`,
    [roleCode],
  );
  return r.rows.map((x) => x.code);
}

export async function grantedMatrixCodes(db: Db, userId: string): Promise<string[]> {
  const r = await db.query<{ permission_code: string }>('SELECT permission_code FROM user_permission_grants WHERE user_id=$1 ORDER BY permission_code', [userId]);
  return r.rows.map((x) => x.permission_code);
}

/**
 * الصلاحيات الفعلية: المدير admin والوضع ROLE ← صلاحيات الدور كما كانت.
 * الوضع CUSTOM ← المصفوفة بعد الاستكمال + الأكواد القديمة المقابلة فقط.
 */
export async function effectivePermissionsForUser(db: Db, user: { id: string; role: string; perm_mode?: string | null }): Promise<{ mode: PermMode; permissions: string[]; matrix: string[] }> {
  if (user.role === 'admin' || user.perm_mode !== 'CUSTOM') {
    return { mode: 'ROLE', permissions: await rolePermissionCodes(db, user.role), matrix: [] };
  }
  const selected = await grantedMatrixCodes(db, user.id);
  return { mode: 'CUSTOM', permissions: effectiveCustomPermissions(selected), matrix: [...expandImplied(selected)] };
}

export function sanitizeMatrix(codes: string[]): string[] {
  return [...new Set(codes.filter(isMatrixCode))].sort();
}

/** يحفظ مصفوفة مستخدم ويسجّل التغيير. المدير لا يُحوَّل لوضع مخصّص (منعاً لقفل النظام). */
export async function saveUserPermissions(
  client: PoolClient,
  input: { companyId: string; targetUserId: string; changedBy: string; mode: PermMode; codes: string[] },
): Promise<{ mode: PermMode; granted: number }> {
  const target = await client.query<{ id: string; role: string; company_id: string }>('SELECT id, role, company_id FROM users WHERE id=$1 FOR UPDATE', [input.targetUserId]);
  const row = target.rows[0];
  if (!row || row.company_id !== input.companyId) throw Object.assign(new Error('المستخدم غير موجود'), { code: 'NOT_FOUND' });
  if (row.role === 'admin' && input.mode === 'CUSTOM') throw Object.assign(new Error('لا يمكن تقييد صلاحيات مدير النظام'), { code: 'VALIDATION' });
  const before = new Set(await grantedMatrixCodes(client, input.targetUserId));
  const after = new Set(input.mode === 'CUSTOM' ? sanitizeMatrix(input.codes) : []);
  await client.query('DELETE FROM user_permission_grants WHERE user_id=$1', [input.targetUserId]);
  for (const code of after) {
    await client.query('INSERT INTO user_permission_grants(user_id, company_id, permission_code, granted_by) VALUES($1,$2,$3,$4)', [input.targetUserId, input.companyId, code, input.changedBy]);
  }
  await client.query('UPDATE users SET perm_mode=$2, updated_at=now() WHERE id=$1', [input.targetUserId, input.mode]);
  await client.query(
    'INSERT INTO user_permission_audit(company_id, user_id, changed_by, mode, granted_count, added, removed) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [input.companyId, input.targetUserId, input.changedBy, input.mode, after.size, [...after].filter((c) => !before.has(c)), [...before].filter((c) => !after.has(c))],
  );
  return { mode: input.mode, granted: after.size };
}
