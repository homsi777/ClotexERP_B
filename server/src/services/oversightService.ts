import type { Pool, PoolClient } from 'pg';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export interface UserOversightRow {
  id: string; branch: string; branchName: string; username: string; fullName: string | null; role: string; permMode: string; isActive: boolean; grants: number;
  /** حمل العمل المفتوح — مؤشرات مسؤولية لا مقياس أداء وحيد؛ آخر نشاط لا يُعدّ حكماً على الموظف. */
  open: { salesDrafts: number; purchaseDrafts: number; editRequests: number; followUpsOverdue: number; alertsAssigned: number };
  lastActivityAt: string | null;
}

/** المستخدمون والمسؤوليات والعمليات المتأخرة (companyId = null لكل الفروع: للمالك فقط). */
export async function listUsersOversight(db: Db, companyId: string | null): Promise<UserOversightRow[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `SELECT u.id, c.code AS branch, c.name AS branch_name, u.username, u.full_name, u.role, u.perm_mode, u.is_active,
            (SELECT count(*) FROM user_permission_grants g WHERE g.user_id=u.id)::int AS grants,
            (SELECT count(*) FROM sales_invoices s WHERE s.company_id=u.company_id AND s.created_by_user_id=u.id AND s.document_status='DRAFT')::int AS sales_drafts,
            (SELECT count(*) FROM purchase_invoices p WHERE p.company_id=u.company_id AND p.created_by_user_id=u.id AND p.document_status='DRAFT')::int AS purchase_drafts,
            (SELECT count(*) FROM edit_requests e WHERE e.company_id=u.company_id AND e.requested_by=u.id AND e.status='PENDING')::int AS edit_requests,
            (SELECT count(*) FROM party_collection_profiles f WHERE f.company_id=u.company_id AND f.owner_user_id=u.id AND f.expected_collection_date < current_date)::int AS follow_overdue,
            (SELECT count(*) FROM alert_states a WHERE a.company_id=u.company_id AND a.assignee_user_id=u.id AND a.status <> 'RESOLVED')::int AS alerts_assigned,
            (SELECT max(a.created_at)::text FROM audit_logs a WHERE a.user_id=u.id) AS last_activity
       FROM users u JOIN companies c ON c.id=u.company_id WHERE ($1::uuid IS NULL OR u.company_id=$1) ORDER BY c.code, u.is_active DESC, u.username`, [companyId])).rows;
  return rows.map((r) => ({
    id: String(r.id), branch: String(r.branch), branchName: String(r.branch_name), username: String(r.username), fullName: (r.full_name as string | null) ?? null, role: String(r.role),
    permMode: String(r.perm_mode), isActive: Boolean(r.is_active), grants: Number(r.grants),
    open: { salesDrafts: Number(r.sales_drafts), purchaseDrafts: Number(r.purchase_drafts), editRequests: Number(r.edit_requests), followUpsOverdue: Number(r.follow_overdue), alertsAssigned: Number(r.alerts_assigned) },
    lastActivityAt: (r.last_activity as string | null) ?? null,
  }));
}

/** سجل تغييرات الصلاحيات (من غيّر ماذا ومتى). */
export async function permissionChangeLog(db: Db, companyId: string | null, limit = 50) {
  return (await db.query(
    `SELECT a.changed_at::text AS at, c.name AS branch, tu.username AS target, COALESCE(cu.username,'—') AS changed_by, a.mode, a.granted_count, cardinality(a.added) AS added, cardinality(a.removed) AS removed
       FROM user_permission_audit a JOIN users tu ON tu.id=a.user_id JOIN companies c ON c.id=a.company_id LEFT JOIN users cu ON cu.id=a.changed_by
      WHERE ($1::uuid IS NULL OR a.company_id=$1) ORDER BY a.changed_at DESC LIMIT $2`, [companyId, Math.min(200, Math.max(1, limit))])).rows;
}

export interface ExceptionRow { at: string; branch: string; kind: string; ref: string; amount: number | null; currency: string | null; user: string | null; detail: string | null }

/** سجل الاستثناءات الإدارية: إلغاءات، خصومات، تسويات فروقات، تعديلات معتمدة بإذن. آخر 90 يوماً (companyId = null لكل الفروع للمالك). */
export async function administrativeExceptions(db: Db, companyId: string | null, limit = 100): Promise<ExceptionRow[]> {
  const rows = (await db.query<ExceptionRow>(
    `SELECT * FROM (
       SELECT si.updated_at::text AS at, c.name AS branch, 'إلغاء فاتورة بيع' AS kind, si.invoice_no AS ref, si.total_amount::float AS amount, si.currency_code AS currency, COALESCE(u.username,'—') AS "user", NULL::text AS detail
         FROM sales_invoices si JOIN companies c ON c.id=si.company_id LEFT JOIN users u ON u.id=si.updated_by_user_id WHERE si.document_status='VOIDED' AND si.updated_at > now() - interval '90 days' AND ($1::uuid IS NULL OR si.company_id=$1)
       UNION ALL
       SELECT pi.updated_at::text, c.name, 'إلغاء فاتورة شراء', pi.invoice_no, pi.total_amount::float, pi.currency_code, COALESCE(u.username,'—'), NULL
         FROM purchase_invoices pi JOIN companies c ON c.id=pi.company_id LEFT JOIN users u ON u.id=pi.updated_by_user_id WHERE pi.document_status='VOIDED' AND pi.updated_at > now() - interval '90 days' AND ($1::uuid IS NULL OR pi.company_id=$1)
       UNION ALL
       SELECT v.cancelled_at::text, c.name, CASE v.voucher_type WHEN 'RECEIPT' THEN 'إلغاء سند قبض' ELSE 'إلغاء سند صرف' END, v.voucher_no, v.amount::float, v.currency_code, COALESCE(u.username,'—'), 'المنشئ'
         FROM vouchers v JOIN companies c ON c.id=v.company_id LEFT JOIN users u ON u.id=v.created_by_user_id WHERE v.status='CANCELLED' AND v.cancelled_at > now() - interval '90 days' AND ($1::uuid IS NULL OR v.company_id=$1)
       UNION ALL
       SELECT cd.created_at::text, c.name, 'حسم عميل', cd.discount_no, cd.amount::float, cd.currency_code, COALESCE(u.username,'—'), cd.description
         FROM customer_discounts cd JOIN companies c ON c.id=cd.company_id LEFT JOIN users u ON u.id=cd.created_by_user_id WHERE cd.status='CONFIRMED' AND cd.created_at > now() - interval '90 days' AND ($1::uuid IS NULL OR cd.company_id=$1)
       UNION ALL
       SELECT oe.cancelled_at::text, c.name, 'إلغاء مصروف', oe.expense_no, oe.amount::float, oe.currency_code, NULL, oe.cancellation_reason
         FROM operating_expenses oe JOIN companies c ON c.id=oe.company_id WHERE oe.status='CANCELLED' AND oe.cancelled_at > now() - interval '90 days' AND ($1::uuid IS NULL OR oe.company_id=$1)
       UNION ALL
       SELECT s.approved_at::text, c.name, CASE s.kind WHEN 'SHORTAGE' THEN 'تسوية نقص (مصنعية خارجية)' ELSE 'تسوية زيادة (مصنعية خارجية)' END, j.job_no, s.amount_m::float, 'م', COALESCE(u.username,'—'), s.reason
         FROM external_job_settlements s JOIN external_jobs j ON j.id=s.job_id JOIN companies c ON c.id=s.company_id LEFT JOIN users u ON u.id=s.approved_by WHERE s.approved_at > now() - interval '90 days' AND ($1::uuid IS NULL OR s.company_id=$1)
       UNION ALL
       SELECT er.decided_at::text, c.name, 'تعديل بإذن معتمد', er.entity_label, NULL, NULL, COALESCE(u.username,'—'), er.reason
         FROM edit_requests er JOIN companies c ON c.id=er.company_id LEFT JOIN users u ON u.id=er.requested_by WHERE er.status IN ('APPROVED','USED') AND er.decided_at > now() - interval '90 days' AND ($1::uuid IS NULL OR er.company_id=$1)
     ) x ORDER BY at DESC LIMIT $2`, [companyId, Math.min(300, Math.max(1, limit))])).rows;
  return rows;
}
