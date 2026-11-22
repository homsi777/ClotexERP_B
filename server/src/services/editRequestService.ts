import type { Pool, PoolClient } from 'pg';
import { insertAuditLog } from './auditLogService.js';
import { sendMessage } from './chatService.js';

type Db = Pool | PoolClient;

export type EditEntityType = 'CUSTOMER' | 'SUPPLIER' | 'SALES_INVOICE' | 'PURCHASE_INVOICE';

export const ENTITY_LABEL_AR: Record<EditEntityType, string> = {
  CUSTOMER: 'عميل',
  SUPPLIER: 'مورد',
  SALES_INVOICE: 'فاتورة بيع',
  PURCHASE_INVOICE: 'فاتورة شراء',
};

export const ENTITY_LINK: Record<EditEntityType, (id: string) => string> = {
  CUSTOMER: (id) => `/customers?edit=${id}`,
  SUPPLIER: (id) => `/suppliers?edit=${id}`,
  SALES_INVOICE: (id) => `/invoices/sales/${id}/edit`,
  PURCHASE_INVOICE: (id) => `/invoices/purchases/${id}/edit`,
};

export interface EditRequestDto {
  id: string;
  entityType: EditEntityType;
  entityId: string;
  entityLabel: string;
  requestedBy: string;
  requestedByName: string;
  supervisorId: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'CANCELLED';
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

function fail(message: string, code = 'VALIDATION'): never {
  throw Object.assign(new Error(message), { code });
}

const SELECT = `SELECT r.id, r.entity_type, r.entity_id, r.entity_label, r.requested_by,
       COALESCE(NULLIF(btrim(u.full_name), ''), u.username) AS requested_by_name,
       r.supervisor_id, r.reason, r.status, r.decision_note, r.created_at, r.decided_at
  FROM edit_requests r JOIN users u ON u.id = r.requested_by`;

const map = (x: Record<string, unknown>): EditRequestDto => ({
  id: x.id as string,
  entityType: x.entity_type as EditEntityType,
  entityId: x.entity_id as string,
  entityLabel: x.entity_label as string,
  requestedBy: x.requested_by as string,
  requestedByName: x.requested_by_name as string,
  supervisorId: (x.supervisor_id as string | null) ?? null,
  reason: x.reason as string,
  status: x.status as EditRequestDto['status'],
  decisionNote: (x.decision_note as string | null) ?? null,
  createdAt: (x.created_at as Date).toISOString(),
  decidedAt: x.decided_at ? (x.decided_at as Date).toISOString() : null,
});

/** هل الكيان موجود بالفرع؟ ويرجع وصفاً قصيراً له (اسم/رقم). */
export async function resolveEntityLabel(db: Db, companyId: string, type: EditEntityType, id: string): Promise<string> {
  const sql: Record<EditEntityType, string> = {
    CUSTOMER: `SELECT name AS label FROM customers WHERE id=$1 AND company_id=$2`,
    SUPPLIER: `SELECT name AS label FROM suppliers WHERE id=$1 AND company_id=$2`,
    SALES_INVOICE: `SELECT invoice_no AS label FROM sales_invoices WHERE id=$1 AND company_id=$2`,
    PURCHASE_INVOICE: `SELECT invoice_no AS label FROM purchase_invoices WHERE id=$1 AND company_id=$2`,
  };
  const r = await db.query<{ label: string }>(sql[type], [id, companyId]);
  if (!r.rows.length) fail('العنصر المطلوب تعديله غير موجود', 'NOT_FOUND');
  return r.rows[0].label ?? '';
}

export async function getSupervisorId(db: Db, companyId: string, userId: string): Promise<string | null> {
  const r = await db.query<{ supervisor_id: string }>(
    `SELECT s.supervisor_id FROM user_supervisors s JOIN users u ON u.id = s.supervisor_id AND u.is_active
      WHERE s.user_id = $1 AND s.company_id = $2`,
    [userId, companyId],
  );
  return r.rows[0]?.supervisor_id ?? null;
}

/** طلب إذن تعديل. طلب معلّق/معتمد غير مستهلَك لنفس العنصر والموظف يُعاد بدل تكرار الطلب. */
export async function createEditRequest(
  client: PoolClient,
  input: { companyId: string; userId: string; entityType: EditEntityType; entityId: string; reason: string },
): Promise<EditRequestDto> {
  const reason = input.reason.trim();
  if (reason.length < 3) fail('اكتب سبب التعديل المطلوب');
  const label = await resolveEntityLabel(client, input.companyId, input.entityType, input.entityId);
  const open = await client.query(
    `${SELECT} WHERE r.company_id=$1 AND r.requested_by=$2 AND r.entity_type=$3 AND r.entity_id=$4 AND r.status IN ('PENDING','APPROVED')
      ORDER BY r.created_at DESC LIMIT 1`,
    [input.companyId, input.userId, input.entityType, input.entityId],
  );
  if (open.rows.length) return map(open.rows[0]);

  const supervisorId = await getSupervisorId(client, input.companyId, input.userId);
  const ins = await client.query(
    `INSERT INTO edit_requests (company_id, entity_type, entity_id, entity_label, requested_by, supervisor_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [input.companyId, input.entityType, input.entityId, label, input.userId, supervisorId, reason],
  );
  await insertAuditLog(client, {
    companyId: input.companyId, userId: input.userId, action: 'EDIT_REQUEST_CREATED', entityType: 'edit_request', entityId: ins.rows[0].id,
    details: { entityType: input.entityType, entityId: input.entityId, supervisorId },
  });
  // إشعار المسؤول بالدردشة الداخلية مرتبطاً بالعملية (إن وُجد مسؤول معيّن؛ وإلا يظهر لكل مدير/محاسب بالجرس).
  if (supervisorId) {
    await sendMessage(
      client, input.companyId, input.userId, supervisorId,
      `🔔 طلب إذن تعديل ${ENTITY_LABEL_AR[input.entityType]} «${label}»\nالسبب: ${reason}\nللموافقة أو الرفض افتح الجرس أو الرابط: ${ENTITY_LINK[input.entityType](input.entityId)}`,
    );
  }
  const full = await client.query(`${SELECT} WHERE r.id=$1`, [ins.rows[0].id]);
  return map(full.rows[0]);
}

export async function listMyRequests(db: Db, companyId: string, userId: string, entityType: string, entityId: string): Promise<EditRequestDto[]> {
  const r = await db.query(
    `${SELECT} WHERE r.company_id=$1 AND r.requested_by=$2 AND r.entity_type=$3 AND r.entity_id=$4 ORDER BY r.created_at DESC LIMIT 5`,
    [companyId, userId, entityType, entityId],
  );
  return r.rows.map(map);
}

/** الطلبات المعلّقة المعروضة للمعتمِد: المسؤول المعيَّن، والمدير/المحاسب يرون الكل. */
export async function listPendingFor(db: Db, companyId: string, approverId: string, seesAll: boolean): Promise<EditRequestDto[]> {
  const r = await db.query(
    `${SELECT} WHERE r.company_id=$1 AND r.status='PENDING' AND ($3::boolean OR r.supervisor_id = $2 OR r.supervisor_id IS NULL)
      ORDER BY r.created_at DESC LIMIT 50`,
    [companyId, approverId, seesAll],
  );
  return r.rows.map(map);
}

export async function decideEditRequest(
  client: PoolClient,
  input: { companyId: string; approverId: string; approverSeesAll: boolean; requestId: string; approve: boolean; note?: string | null },
): Promise<EditRequestDto> {
  const cur = await client.query(`${SELECT} WHERE r.id=$1 AND r.company_id=$2 FOR UPDATE OF r`, [input.requestId, input.companyId]);
  if (!cur.rows.length) fail('الطلب غير موجود', 'NOT_FOUND');
  const req = map(cur.rows[0]);
  if (req.status !== 'PENDING') fail('تم البتّ في هذا الطلب مسبقاً', 'INVALID_STATE');
  if (req.requestedBy === input.approverId) fail('لا يمكنك الموافقة على طلبك أنت');
  if (!input.approverSeesAll && req.supervisorId !== input.approverId) fail('الطلب موجّه لمسؤول آخر', 'FORBIDDEN');
  await client.query(
    `UPDATE edit_requests SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5 WHERE id=$1 AND company_id=$2`,
    [input.requestId, input.companyId, input.approve ? 'APPROVED' : 'REJECTED', input.approverId, input.note?.trim() || null],
  );
  await insertAuditLog(client, {
    companyId: input.companyId, userId: input.approverId, action: input.approve ? 'EDIT_REQUEST_APPROVED' : 'EDIT_REQUEST_REJECTED',
    entityType: 'edit_request', entityId: input.requestId, details: { entityType: req.entityType, entityId: req.entityId, requestedBy: req.requestedBy },
  });
  await sendMessage(
    client, input.companyId, input.approverId, req.requestedBy,
    input.approve
      ? `✅ تمت الموافقة على تعديل ${ENTITY_LABEL_AR[req.entityType]} «${req.entityLabel}» — يمكنك التعديل الآن (مرة واحدة): ${ENTITY_LINK[req.entityType](req.entityId)}`
      : `❌ رُفض طلب تعديل ${ENTITY_LABEL_AR[req.entityType]} «${req.entityLabel}»${input.note?.trim() ? `\nالسبب: ${input.note.trim()}` : ''}`,
  );
  return { ...req, status: input.approve ? 'APPROVED' : 'REJECTED', decisionNote: input.note?.trim() || null };
}

/** إذن معتمد وغير مستهلَك صالح لتعديل هذا العنصر بالذات من هذا الموظف. */
export async function findApprovedGrant(db: Db, companyId: string, userId: string, requestId: string, entityId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9a-f-]{36}$/i.test(entityId)) return false;
  const r = await db.query(
    `SELECT 1 FROM edit_requests WHERE id=$1 AND company_id=$2 AND requested_by=$3 AND entity_id=$4 AND status='APPROVED'`,
    [requestId, companyId, userId, entityId],
  );
  return r.rows.length > 0;
}

export async function markGrantUsed(db: Db, companyId: string, requestId: string): Promise<void> {
  await db.query(`UPDATE edit_requests SET status='USED', used_at=now() WHERE id=$1 AND company_id=$2 AND status='APPROVED'`, [requestId, companyId]);
}

export async function listSupervisorAssignments(db: Db, companyId: string) {
  const r = await db.query(
    `SELECT u.id AS user_id, COALESCE(NULLIF(btrim(u.full_name), ''), u.username) AS name, u.username, u.role,
            s.supervisor_id
       FROM users u LEFT JOIN user_supervisors s ON s.user_id = u.id
      WHERE u.company_id=$1 AND u.is_active ORDER BY name`,
    [companyId],
  );
  return r.rows.map((x) => ({ userId: x.user_id as string, name: x.name as string, username: x.username as string, role: x.role as string, supervisorId: (x.supervisor_id as string | null) ?? null }));
}

export async function setSupervisor(
  client: PoolClient,
  input: { companyId: string; actorId: string; userId: string; supervisorId: string | null },
): Promise<void> {
  const u = await client.query(`SELECT 1 FROM users WHERE id=$1 AND company_id=$2 AND is_active`, [input.userId, input.companyId]);
  if (!u.rows.length) fail('الموظف غير موجود', 'NOT_FOUND');
  if (input.supervisorId) {
    if (input.supervisorId === input.userId) fail('لا يكون الموظف مسؤولاً عن نفسه');
    const s = await client.query(`SELECT 1 FROM users WHERE id=$1 AND company_id=$2 AND is_active`, [input.supervisorId, input.companyId]);
    if (!s.rows.length) fail('المسؤول غير موجود', 'NOT_FOUND');
    await client.query(
      `INSERT INTO user_supervisors (user_id, company_id, supervisor_id, updated_by_user_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET supervisor_id = EXCLUDED.supervisor_id, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
      [input.userId, input.companyId, input.supervisorId, input.actorId],
    );
  } else {
    await client.query(`DELETE FROM user_supervisors WHERE user_id=$1 AND company_id=$2`, [input.userId, input.companyId]);
  }
  await insertAuditLog(client, {
    companyId: input.companyId, userId: input.actorId, action: 'USER_SUPERVISOR_SET', entityType: 'user', entityId: input.userId,
    details: { supervisorId: input.supervisorId },
  });
}
