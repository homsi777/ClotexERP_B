import type { Pool, PoolClient } from 'pg';
import { orderInventoryWorkflow } from './customerOrderWorkflowService.js';

export const OPEN_ORDER_PHASES = ['pending_supply', 'partial_ready', 'ready_pickup'] as const;
export type DueNotificationKind = 'due_soon' | 'due_today' | 'overdue';
export type OrderNotificationKind = DueNotificationKind | 'stock_available' | 'phase_changed';
const DAY = 86_400_000;

export function branchCalendarDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function dueNotificationKind(expectedDate: string | null, now: Date, timeZone: string): DueNotificationKind | null {
  if (!expectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) return null;
  const target = Date.parse(`${expectedDate}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== expectedDate) return null;
  const today = Date.parse(`${branchCalendarDate(now, timeZone)}T00:00:00Z`);
  const days = Math.round((target - today) / DAY);
  return days < 0 ? 'overdue' : days === 0 ? 'due_today' : days <= 3 ? 'due_soon' : null;
}

interface OrderRow {
  id: string; order_no: string; status: string; expected_date: string | null;
  follow_up_user_id: string | null; follow_up_employee_id: string | null;
  follow_up_employee_name: string | null; follow_up_user_name: string | null;
}
interface RecipientResolution { userIds: string[]; issues: string[] }
interface EventPayload {
  orderNumber: string; expectedDate: string | null; timeZone: string;
  phase?: string; fromPhase?: string; materialName?: string; colorCode?: string;
  availableMeters?: number; remainingMeters?: number;
}

export async function notificationTimeZone(db: PoolClient, companyId: string): Promise<string> {
  const result = await db.query<{ zone: string | null }>(
    `SELECT value->>'timezone' AS zone FROM system_settings WHERE company_id=$1 AND key='general'`, [companyId]);
  const zone = result.rows[0]?.zone || 'Asia/Damascus';
  // Misconfiguration must be visible/retryable, never silently switch the branch's day.
  new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
  return zone;
}

async function eligibleUsers(db: PoolClient, companyId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.query<{ id: string }>(`SELECT u.id FROM users u WHERE u.company_id=$1 AND u.id=ANY($2::uuid[])
    AND u.is_active AND (u.role='admin' OR EXISTS(SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id
      JOIN permissions p ON p.id=rp.permission_id WHERE r.code=u.role AND p.code='customers.view'))`, [companyId, ids]);
  return rows.rows.map(row => row.id);
}

async function resolveRecipients(db: PoolClient, companyId: string, order: OrderRow, phase?: string): Promise<RecipientResolution> {
  const issues: string[] = [];
  let responsible = order.follow_up_user_id;
  if (!responsible && order.follow_up_employee_id) {
    const link = await db.query<{ user_id: string }>(`SELECT m.user_id FROM customer_order_notification_employee_users m
      JOIN payroll_employees e ON e.company_id=m.company_id AND e.id=m.employee_id AND e.is_active
      WHERE m.company_id=$1 AND m.employee_id=$2`, [companyId, order.follow_up_employee_id]);
    responsible = link.rows[0]?.user_id || null;
    if (!responsible) issues.push('employee_unlinked');
  }
  if (!responsible && !order.follow_up_employee_id) issues.push('responsible_unassigned');
  const candidates = responsible ? [responsible] : [];
  if (phase) {
    const next = await db.query<{ user_id: string }>(`SELECT user_id FROM customer_order_notification_phase_users WHERE company_id=$1 AND phase=$2`, [companyId, phase]);
    if (next.rows[0]) candidates.push(next.rows[0].user_id);
    else issues.push('phase_recipient_unassigned');
  }
  const userIds = await eligibleUsers(db, companyId, [...new Set(candidates)]);
  if (candidates.some(id => !userIds.includes(id))) issues.push('recipient_inactive_or_unauthorized');
  return { userIds, issues };
}

async function ensureEvent(db: PoolClient, companyId: string, order: OrderRow, kind: OrderNotificationKind, key: string,
  payload: EventPayload, now: Date, lineId: string | null = null) {
  await db.query(`INSERT INTO app_notification_events(company_id,source,entity_id,line_id,event_kind,dedupe_key,payload,created_at)
    VALUES($1,'customer_order',$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(company_id,dedupe_key) DO NOTHING`,
    [companyId, order.id, lineId, kind, key, JSON.stringify(payload), now]);
}

async function deliverPendingEvents(db: PoolClient, companyId: string, order: OrderRow, now: Date) {
  const events = await db.query<{ id: string; event_kind: string; payload: EventPayload }>(`SELECT id,event_kind,payload FROM app_notification_events
    WHERE company_id=$1 AND source='customer_order' AND entity_id=$2 AND resolved_at IS NULL`, [companyId, order.id]);
  for (const event of events.rows) {
    const recipients = await resolveRecipients(db, companyId, order, event.event_kind === 'phase_changed' ? event.payload.phase : undefined);
    // Reassignment removes previous recipients' access without destroying the historical delivery/read record.
    await db.query(`UPDATE app_notification_recipients SET revoked_at=$4 WHERE company_id=$1 AND notification_id=$2
      AND NOT(user_id=ANY($3::uuid[])) AND revoked_at IS NULL`, [companyId, event.id, recipients.userIds, now]);
    for (const userId of recipients.userIds) await db.query(`INSERT INTO app_notification_recipients(company_id,notification_id,user_id,delivered_at)
      VALUES($1,$2,$3,$4) ON CONFLICT(company_id,notification_id,user_id) DO UPDATE SET revoked_at=NULL`, [companyId, event.id, userId, now]);
  }
}

/** Called in a transaction; trigger outbox + unique event/recipient keys make retries atomic and idempotent. */
export async function scanOrderNotifications(db: PoolClient, companyId: string, orderId: string, now: Date, timeZone: string) {
  const locked = await db.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked`, [`gap006:${companyId}:${orderId}`]);
  if (!locked.rows[0].locked) return;
  const result = await db.query<OrderRow>(`SELECT id,order_no,status,expected_date::text,follow_up_user_id,follow_up_employee_id,
    follow_up_employee_name,follow_up_user_name FROM customer_orders WHERE company_id=$1 AND id=$2 FOR UPDATE`, [companyId, orderId]);
  const order = result.rows[0];
  if (!order) return;
  const open = OPEN_ORDER_PHASES.some(phase => phase === order.status);
  // Retire obsolete reminders. Resolved events never reopen for the same order/date/key.
  await db.query(`UPDATE app_notification_events SET resolved_at=$3 WHERE company_id=$1 AND source='customer_order'
    AND entity_id=$2 AND resolved_at IS NULL AND ($4::boolean=false OR
      (event_kind IN ('due_soon','due_today','overdue') AND (payload->>'expectedDate') IS DISTINCT FROM $5::text))`,
    [companyId, orderId, now, open, order.expected_date]);
  const phases = await db.query<{ id: string; from_phase: string; to_phase: string; happened_at: Date }>(`SELECT id,from_phase,to_phase,happened_at
    FROM customer_order_notification_phase_outbox WHERE company_id=$1 AND order_id=$2 AND processed_at IS NULL ORDER BY happened_at,id`, [companyId, orderId]);
  if (!open) {
    await db.query(`UPDATE customer_order_notification_phase_outbox SET processed_at=$3 WHERE company_id=$1 AND order_id=$2 AND processed_at IS NULL`, [companyId, orderId, now]);
    await db.query(`UPDATE customer_order_notification_stock_state SET available=false WHERE company_id=$1 AND order_id=$2`, [companyId, orderId]);
    return;
  }
  const payload: EventPayload = { orderNumber: order.order_no, expectedDate: order.expected_date, timeZone };
  for (const phase of phases.rows) {
    if (OPEN_ORDER_PHASES.some(value => value === phase.to_phase)) await ensureEvent(db, companyId, order, 'phase_changed',
      `order:${orderId}:phase:${phase.id}`, { ...payload, fromPhase: phase.from_phase, phase: phase.to_phase }, phase.happened_at);
    await db.query('UPDATE customer_order_notification_phase_outbox SET processed_at=$2 WHERE id=$1 AND company_id=$3', [phase.id, now, companyId]);
  }
  const due = dueNotificationKind(order.expected_date, now, timeZone);
  // Earlier reminders cease to be actionable when the next threshold is reached.
  await db.query(`UPDATE app_notification_events SET resolved_at=$3 WHERE company_id=$1 AND source='customer_order' AND entity_id=$2
    AND event_kind IN ('due_soon','due_today','overdue') AND event_kind IS DISTINCT FROM $4::text AND resolved_at IS NULL`, [companyId, orderId, now, due]);
  if (due) await ensureEvent(db, companyId, order, due, `order:${orderId}:${due}:${order.expected_date}`, payload, now);

  // Reuse the authoritative eligibility/fulfillment/reservation/quality engine, never a second stock balance.
  const workflow = await orderInventoryWorkflow(db, companyId, orderId);
  const currentLines = workflow.lines.map(line => line.id as string);
  await db.query(`UPDATE app_notification_events SET resolved_at=$3 WHERE company_id=$1 AND source='customer_order' AND entity_id=$2
    AND event_kind='stock_available' AND resolved_at IS NULL AND NOT(line_id=ANY($4::uuid[]))`, [companyId, orderId, now, currentLines]);
  for (const line of workflow.lines) {
    const previousPhase=(await db.query<{phase:string;generation:number}>('SELECT phase,generation FROM customer_order_notification_line_phases WHERE company_id=$1 AND line_id=$2',[companyId,line.id])).rows[0];
    const phaseGeneration=(previousPhase?.generation??0)+(previousPhase?.phase===line.phase?0:1);
    if(previousPhase?.phase!==line.phase){
      await db.query(`INSERT INTO customer_order_notification_line_phases(company_id,order_id,line_id,phase,generation) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(company_id,line_id) DO UPDATE SET phase=EXCLUDED.phase,generation=EXCLUDED.generation`,[companyId,orderId,line.id,line.phase,phaseGeneration]);
      await db.query(`UPDATE app_notification_events SET resolved_at=$4 WHERE company_id=$1 AND entity_id=$2 AND line_id=$3 AND source='customer_order' AND event_kind='phase_changed' AND resolved_at IS NULL`,[companyId,orderId,line.id,now]);
      await ensureEvent(db,companyId,order,'phase_changed',`order:${orderId}:line:${line.id}:phase:${phaseGeneration}`,{...payload,materialName:line.materialName,colorCode:line.colorCode,phase:line.phase,fromPhase:previousPhase?.phase},now,line.id);
    }
    const available = line.remainingMeters > line.reservedMeters + 0.0005 && line.availableMeters > 0.0005;
    const state = await db.query<{ available: boolean; generation: number }>(`SELECT available,generation FROM customer_order_notification_stock_state
      WHERE company_id=$1 AND order_id=$2 AND line_id=$3`, [companyId, orderId, line.id]);
    const previous = state.rows[0];
    const generation = (previous?.generation || 0) + (available && !previous?.available ? 1 : 0);
    await db.query(`INSERT INTO customer_order_notification_stock_state(company_id,order_id,line_id,available,generation)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id,order_id,line_id) DO UPDATE SET available=EXCLUDED.available,generation=EXCLUDED.generation`,
      [companyId, orderId, line.id, available, generation]);
    if (!available) await db.query(`UPDATE app_notification_events SET resolved_at=$4 WHERE company_id=$1 AND source='customer_order' AND entity_id=$2
      AND line_id=$3 AND event_kind='stock_available' AND resolved_at IS NULL`, [companyId, orderId, line.id, now]);
    if (available && !previous?.available) await ensureEvent(db, companyId, order, 'stock_available', `order:${orderId}:line:${line.id}:stock:${generation}`,
      { ...payload, materialName: line.materialName, colorCode: line.colorCode, availableMeters: line.availableMeters, remainingMeters: line.remainingMeters }, now, line.id);
  }
  await deliverPendingEvents(db, companyId, order, now);
}

export async function scanCustomerOrderNotifications(pool: Pool, companyId: string, now = new Date()) {
  const stats = { scanned: 0, failed: 0 };
  const db = await pool.connect();
  try {
    const timeZone = await notificationTimeZone(db, companyId);
    let cursor = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const orders = await db.query<{ id: string }>(`SELECT o.id FROM customer_orders o WHERE o.company_id=$1 AND o.id>$2
        AND (o.status IN ('pending_supply','partial_ready','ready_pickup') OR
          EXISTS(SELECT 1 FROM app_notification_events n WHERE n.company_id=o.company_id AND n.source='customer_order' AND n.entity_id=o.id AND n.resolved_at IS NULL) OR
          EXISTS(SELECT 1 FROM customer_order_notification_phase_outbox q WHERE q.company_id=o.company_id AND q.order_id=o.id AND q.processed_at IS NULL))
        ORDER BY o.id LIMIT 100`, [companyId, cursor]);
      if (!orders.rows.length) break;
      for (const order of orders.rows) {
        await db.query('BEGIN');
        try { await scanOrderNotifications(db, companyId, order.id, now, timeZone); await db.query('COMMIT'); stats.scanned++; }
        catch (error) { await db.query('ROLLBACK'); stats.failed++; console.error('[order-notifications] retryable order scan failure', order.id, error instanceof Error ? error.message : 'unknown'); }
      }
      cursor = orders.rows[orders.rows.length - 1].id;
    }
    return stats;
  } finally { db.release(); }
}

export interface InboxNotification {
  id: string; source: string; entityId: string; lineId: string | null; kind: string;
  payload: EventPayload; createdAt: string; readAt: string | null;
}
export async function listNotificationInbox(db: PoolClient, companyId: string, userId: string, unreadOnly = false, offset = 0) {
  const base = `FROM app_notification_events n JOIN app_notification_recipients r ON r.company_id=n.company_id AND r.notification_id=n.id
    WHERE r.company_id=$1 AND r.user_id=$2 AND r.revoked_at IS NULL AND n.resolved_at IS NULL`;
  const count = await db.query<{ unread: number; total: number }>(`SELECT COUNT(*) FILTER(WHERE r.read_at IS NULL)::int AS unread, COUNT(*)::int AS total ${base}`, [companyId, userId]);
  const rows = await db.query<InboxNotification>(`SELECT n.id,n.source,n.entity_id AS "entityId",n.line_id AS "lineId",n.event_kind AS kind,n.payload,
    n.created_at::text AS "createdAt",r.read_at::text AS "readAt" ${base} AND ($3::boolean=false OR r.read_at IS NULL)
    ORDER BY n.created_at DESC,n.id DESC LIMIT 30 OFFSET $4`, [companyId, userId, unreadOnly, offset]);
  return { items: rows.rows, unread: count.rows[0].unread, total: unreadOnly ? count.rows[0].unread : count.rows[0].total };
}
export async function setNotificationRead(db: PoolClient, companyId: string, userId: string, id: string, read: boolean) {
  const result = await db.query(`UPDATE app_notification_recipients r SET read_at=CASE WHEN $4::boolean THEN COALESCE(r.read_at,clock_timestamp()) ELSE NULL END
    WHERE r.company_id=$1 AND r.user_id=$2 AND r.notification_id=$3 AND r.revoked_at IS NULL AND EXISTS(
      SELECT 1 FROM app_notification_events n WHERE n.company_id=r.company_id AND n.id=r.notification_id AND n.resolved_at IS NULL) RETURNING notification_id`, [companyId, userId, id, read]);
  return result.rows.length > 0;
}

export async function notificationRecipientDiagnostics(db: PoolClient, companyId: string) {
  const orders = await db.query<OrderRow>(`SELECT id,order_no,status,expected_date::text,follow_up_user_id,follow_up_employee_id,
    follow_up_employee_name,follow_up_user_name FROM customer_orders WHERE company_id=$1 AND status IN ('pending_supply','partial_ready','ready_pickup') ORDER BY order_no LIMIT 200`, [companyId]);
  const rows = [];
  for (const order of orders.rows) {
    const recipients = await resolveRecipients(db, companyId, order, order.status);
    rows.push({ orderId: order.id, orderNumber: order.order_no, employeeName: order.follow_up_employee_name,
      userName: order.follow_up_user_name, phase: order.status, ...recipients });
  }
  return rows;
}
