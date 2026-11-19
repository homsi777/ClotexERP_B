import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { authenticateRequest, type JwtPayload } from "../middleware/auth.js";
import { sendError } from "../middleware/errorHandler.js";
import {
  buildWarpCardData,
  canTransitionWarpingOrder,
  generateWarpCardNo,
  generateWarpingOrderNo,
  type WarpingStatus,
} from "../services/manufacturingWarpingService.js";

const input = z.object({
  workOrderId: z.string().uuid(),
  plannedLengthM: z.number().positive(),
  warpingMachineId: z.string().uuid().nullable().optional(),
  targetLoomId: z.string().uuid().nullable().optional(),
  operatorEmployeeId: z.string().uuid().nullable().optional(),
  shiftTypeId: z.string().uuid().nullable().optional(),
  tieCount: z.number().int().min(0).nullable().optional(),
  beamNo: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const has = (u: JwtPayload | undefined, p: string) => Boolean(u && (u.role === "admin" || u.permissions.includes(p)));
const canView = (u: JwtPayload | undefined) =>
  has(u, "manufacturing.warping.view") || has(u, "manufacturing.dashboard.view");
function dbError(reply: FastifyReply, error: unknown) {
  const c = (error as { code?: string }).code;
  if (c === "23505") return sendError(reply, 409, "رقم الأمر أو الكارت مستخدم مسبقاً", "DUPLICATE");
  if (c === "23503") return sendError(reply, 409, "أحد المراجع غير موجود أو لا يتبع الشركة", "CONFLICT");
  if (c === "23514") return sendError(reply, 400, "بيانات أمر التسدية غير صالحة", "VALIDATION");
  throw error;
}

export const manufacturingWarpingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateRequest);
  app.get("/options", async (req, reply) => {
    if (!canView(req.user) && !has(req.user, "manufacturing.warping.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية عرض خيارات التسدية", "FORBIDDEN");
    const company = req.user!.companyId;
    const [orders, machines, employees, shifts] = await Promise.all([
      getPool().query(
        `SELECT id,work_order_no,target_length_m,status FROM manufacturing_work_orders WHERE company_id=$1 AND status IN ('RELEASED','IN_PROGRESS') ORDER BY created_at DESC`,
        [company],
      ),
      getPool().query(
        `SELECT id,code,name,machine_type,operational_status FROM manufacturing_machines WHERE company_id=$1 AND is_active AND machine_type IN ('WARPING','LOOM') ORDER BY code`,
        [company],
      ),
      getPool().query(
        `SELECT id,employee_code,full_name FROM payroll_employees WHERE company_id=$1 AND is_active ORDER BY full_name`,
        [company],
      ),
      getPool().query(
        `SELECT id,code,name FROM attendance_shift_types WHERE company_id=$1 AND is_active ORDER BY name`,
        [company],
      ),
    ]);
    return reply.send({
      ok: true,
      data: { workOrders: orders.rows, machines: machines.rows, employees: employees.rows, shifts: shifts.rows },
    });
  });
  app.get("/", async (req, reply) => {
    if (!canView(req.user)) return sendError(reply, 403, "ليست لديك صلاحية عرض أوامر التسدية", "FORBIDDEN");
    const rows = await getPool().query(
      `SELECT x.*,w.work_order_no,m.code AS machine_code,m.name AS machine_name,l.code AS loom_code,l.name AS loom_name,e.full_name AS operator_name,s.name AS shift_name,c.id AS warp_card_id,c.card_no,c.barcode AS card_barcode,c.card_data,c.print_count
      FROM manufacturing_warping_orders x JOIN manufacturing_work_orders w ON w.id=x.work_order_id AND w.company_id=x.company_id
      LEFT JOIN manufacturing_machines m ON m.id=x.warping_machine_id AND m.company_id=x.company_id LEFT JOIN manufacturing_machines l ON l.id=x.target_loom_id AND l.company_id=x.company_id
      LEFT JOIN payroll_employees e ON e.id=x.operator_employee_id AND e.company_id=x.company_id LEFT JOIN attendance_shift_types s ON s.id=x.shift_type_id AND s.company_id=x.company_id
      LEFT JOIN manufacturing_warp_cards c ON c.warping_order_id=x.id AND c.company_id=x.company_id AND c.status='ACTIVE' WHERE x.company_id=$1 ORDER BY x.created_at DESC`,
      [req.user!.companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post("/", async (req, reply) => {
    if (!has(req.user, "manufacturing.warping.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية إنشاء أمر تسدية", "FORBIDDEN");
    const p = input.safeParse(req.body);
    if (!p.success) return sendError(reply, 400, p.error.issues[0]?.message || "بيانات غير صالحة", "VALIDATION");
    const d = p.data,
      client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const wo = await client.query<{
        status: string;
        target_length_m: string;
        specification_snapshot: Record<string, unknown>;
      }>(
        `SELECT status,target_length_m,specification_snapshot FROM manufacturing_work_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [d.workOrderId, req.user!.companyId],
      );
      if (!wo.rows.length) {
        await client.query("ROLLBACK");
        return sendError(reply, 404, "أمر الإنتاج غير موجود", "NOT_FOUND");
      }
      if (!["RELEASED", "IN_PROGRESS"].includes(wo.rows[0].status)) {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "يجب إصدار أمر الإنتاج أولاً", "INVALID_STATE");
      }
      if (d.plannedLengthM > Number(wo.rows[0].target_length_m)) {
        await client.query("ROLLBACK");
        return sendError(reply, 400, "طول التسدية يتجاوز طول أمر الإنتاج", "VALIDATION");
      }
      if (d.warpingMachineId) {
        const m = await client.query<{ machine_type: string; operational_status: string }>(
          `SELECT machine_type,operational_status FROM manufacturing_machines WHERE id=$1 AND company_id=$2`,
          [d.warpingMachineId, req.user!.companyId],
        );
        if (!m.rows.length || m.rows[0].machine_type !== "WARPING" || m.rows[0].operational_status !== "ACTIVE") {
          await client.query("ROLLBACK");
          return sendError(reply, 400, "ماكينة التسدية غير صالحة أو غير نشطة", "VALIDATION");
        }
      }
      if (d.targetLoomId) {
        const l = await client.query<{ machine_type: string }>(
          `SELECT machine_type FROM manufacturing_machines WHERE id=$1 AND company_id=$2`,
          [d.targetLoomId, req.user!.companyId],
        );
        if (!l.rows.length || l.rows[0].machine_type !== "LOOM") {
          await client.query("ROLLBACK");
          return sendError(reply, 400, "النول المحدد غير صالح", "VALIDATION");
        }
      }
      const no = await generateWarpingOrderNo(client, req.user!.companyId),
        row = await client.query<{ id: string }>(
          `INSERT INTO manufacturing_warping_orders(company_id,warping_order_no,work_order_id,planned_length_m,warping_machine_id,target_loom_id,operator_employee_id,shift_type_id,tie_count,beam_no,specification_snapshot,notes,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13) RETURNING id`,
          [
            req.user!.companyId,
            no,
            d.workOrderId,
            d.plannedLengthM,
            d.warpingMachineId ?? null,
            d.targetLoomId ?? null,
            d.operatorEmployeeId ?? null,
            d.shiftTypeId ?? null,
            d.tieCount ?? null,
            d.beamNo ?? null,
            JSON.stringify(wo.rows[0].specification_snapshot),
            d.notes ?? null,
            req.user!.sub,
          ],
        );
      await event(
        client,
        req.user!.companyId,
        row.rows[0].id,
        "CREATED",
        null,
        "DRAFT",
        { warpingOrderNo: no },
        req.user!.sub,
      );
      await client.query("COMMIT");
      return reply.status(201).send({ ok: true, data: { id: row.rows[0].id, warpingOrderNo: no, status: "DRAFT" } });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      return dbError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post("/:id/release", async (req, reply) => {
    if (!has(req.user, "manufacturing.warping.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية إصدار أمر التسدية", "FORBIDDEN");
    const { id } = req.params as { id: string },
      p = z.object({ version: z.number().int().positive() }).safeParse(req.body);
    if (!p.success) return sendError(reply, 400, "رقم النسخة مطلوب", "VALIDATION");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const q = await client.query<any>(
        `SELECT x.*,l.code AS loom_code,e.full_name AS operator_name,s.name AS shift_name FROM manufacturing_warping_orders x LEFT JOIN manufacturing_machines l ON l.id=x.target_loom_id AND l.company_id=x.company_id LEFT JOIN payroll_employees e ON e.id=x.operator_employee_id AND e.company_id=x.company_id LEFT JOIN attendance_shift_types s ON s.id=x.shift_type_id AND s.company_id=x.company_id WHERE x.id=$1 AND x.company_id=$2 FOR UPDATE OF x`,
        [id, req.user!.companyId],
      );
      if (!q.rows.length) {
        await client.query("ROLLBACK");
        return sendError(reply, 404, "أمر التسدية غير موجود", "NOT_FOUND");
      }
      const x = q.rows[0];
      if (x.status !== "DRAFT" || x.version !== p.data.version) {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "حالة الأمر أو نسخته غير صالحة", "INVALID_STATE");
      }
      if (!x.warping_machine_id) {
        await client.query("ROLLBACK");
        return sendError(reply, 400, "ماكينة التسدية مطلوبة", "VALIDATION");
      }
      const cardNo = await generateWarpCardNo(client, req.user!.companyId),
        barcode = `WARP-${randomUUID()}`,
        card = buildWarpCardData({
          specificationSnapshot: x.specification_snapshot,
          plannedLengthM: Number(x.planned_length_m),
          loomLabel: x.loom_code,
          operatorName: x.operator_name,
          shiftName: x.shift_name,
          tieCount: x.tie_count,
          issuedAt: new Date(),
        });
      await client.query(
        `UPDATE manufacturing_warping_orders SET status='RELEASED',beam_barcode=$3,execution_snapshot=$4::jsonb,released_by_user_id=$5,released_at=now(),version=version+1,updated_by_user_id=$5,updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, req.user!.companyId, barcode, JSON.stringify(card), req.user!.sub],
      );
      await client.query(
        `INSERT INTO manufacturing_warp_cards(company_id,warping_order_id,card_no,barcode,card_data,created_by_user_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
        [req.user!.companyId, id, cardNo, barcode, JSON.stringify(card), req.user!.sub],
      );
      await event(client, req.user!.companyId, id, "RELEASED", "DRAFT", "RELEASED", { cardNo, barcode }, req.user!.sub);
      await client.query("COMMIT");
      return reply.send({ ok: true, data: { id, status: "RELEASED", version: p.data.version + 1, cardNo, barcode } });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      return dbError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post("/:id/transition", async (req, reply) => {
    if (!has(req.user, "manufacturing.warping.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية تحديث أمر التسدية", "FORBIDDEN");
    const { id } = req.params as { id: string },
      p = z
        .object({
          targetStatus: z.enum(["IN_PROGRESS", "CANCELLED"]),
          version: z.number().int().positive(),
          reason: z.string().trim().max(2000).nullable().optional(),
        })
        .safeParse(req.body);
    if (!p.success || (p.data.targetStatus === "CANCELLED" && !p.data.reason))
      return sendError(reply, 400, "بيانات الانتقال أو سبب الإلغاء غير صالحة", "VALIDATION");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const q = await client.query<{ status: WarpingStatus; version: number; work_order_id: string }>(
        `SELECT status,version,work_order_id FROM manufacturing_warping_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, req.user!.companyId],
      );
      if (!q.rows.length) {
        await client.query("ROLLBACK");
        return sendError(reply, 404, "أمر التسدية غير موجود", "NOT_FOUND");
      }
      const x = q.rows[0];
      if (x.version !== p.data.version || !canTransitionWarpingOrder(x.status, p.data.targetStatus)) {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "انتقال الحالة غير مسموح", "INVALID_STATE");
      }
      await client.query(
        `UPDATE manufacturing_warping_orders SET status=$3,started_by_user_id=CASE WHEN $3='IN_PROGRESS' THEN $4 ELSE started_by_user_id END,started_at=CASE WHEN $3='IN_PROGRESS' THEN now() ELSE started_at END,cancelled_by_user_id=CASE WHEN $3='CANCELLED' THEN $4 ELSE cancelled_by_user_id END,cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE cancelled_at END,cancellation_reason=CASE WHEN $3='CANCELLED' THEN $5 ELSE cancellation_reason END,version=version+1,updated_by_user_id=$4,updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, req.user!.companyId, p.data.targetStatus, req.user!.sub, p.data.reason ?? null],
      );
      if (p.data.targetStatus === "IN_PROGRESS") {
        const workOrderStarted = await client.query(
          `UPDATE manufacturing_work_orders SET status='IN_PROGRESS',version=version+1,updated_by_user_id=$3,updated_at=now() WHERE id=$1 AND company_id=$2 AND status='RELEASED'`,
          [x.work_order_id, req.user!.companyId, req.user!.sub],
        );
        if (workOrderStarted.rowCount) await client.query(
          `INSERT INTO manufacturing_work_order_events(company_id,work_order_id,event_type,old_status,new_status,details,created_by_user_id)
           VALUES($1,$2,'STARTED','RELEASED','IN_PROGRESS',$3::jsonb,$4)`,
          [req.user!.companyId,x.work_order_id,JSON.stringify({ source:'WARPING', warpingOrderId:id }),req.user!.sub],
        );
      }
      await event(
        client,
        req.user!.companyId,
        id,
        p.data.targetStatus === "IN_PROGRESS" ? "STARTED" : "CANCELLED",
        x.status,
        p.data.targetStatus,
        { reason: p.data.reason ?? null },
        req.user!.sub,
      );
      await client.query("COMMIT");
      return reply.send({ ok: true, data: { id, status: p.data.targetStatus, version: p.data.version + 1 } });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      return dbError(reply, e);
    } finally {
      client.release();
    }
  });

  app.post("/:id/complete", async (req, reply) => {
    if (!has(req.user, "manufacturing.warping.quality"))
      return sendError(reply, 403, "ليست لديك صلاحية اعتماد الفحص", "FORBIDDEN");
    const { id } = req.params as { id: string },
      p = z
        .object({
          version: z.number().int().positive(),
          actualLengthM: z.number().min(0),
          qualityStatus: z.enum(["ACCEPTED", "CONDITIONAL", "REJECTED"]),
          qualityNotes: z.string().trim().max(2000).nullable().optional(),
        })
        .safeParse(req.body);
    if (!p.success) return sendError(reply, 400, "بيانات الفحص غير صالحة", "VALIDATION");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const q = await client.query<{ status: WarpingStatus; version: number }>(
        `SELECT status,version FROM manufacturing_warping_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, req.user!.companyId],
      );
      if (!q.rows.length) {
        await client.query("ROLLBACK");
        return sendError(reply, 404, "أمر التسدية غير موجود", "NOT_FOUND");
      }
      const target = p.data.qualityStatus === "REJECTED" ? "REJECTED" : "COMPLETED";
      if (q.rows[0].version !== p.data.version || !canTransitionWarpingOrder(q.rows[0].status, target)) {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "لا يمكن إكمال الفحص في الحالة الحالية", "INVALID_STATE");
      }
      await client.query(
        `UPDATE manufacturing_warping_orders SET status=$3,actual_length_m=$4,quality_status=$5,quality_notes=$6,completed_by_user_id=$7,completed_at=now(),version=version+1,updated_by_user_id=$7,updated_at=now() WHERE id=$1 AND company_id=$2`,
        [
          id,
          req.user!.companyId,
          target,
          p.data.actualLengthM,
          p.data.qualityStatus,
          p.data.qualityNotes ?? null,
          req.user!.sub,
        ],
      );
      await event(
        client,
        req.user!.companyId,
        id,
        "QUALITY_COMPLETED",
        q.rows[0].status,
        target,
        { actualLengthM: p.data.actualLengthM, qualityStatus: p.data.qualityStatus },
        req.user!.sub,
      );
      await client.query("COMMIT");
      return reply.send({ ok: true, data: { id, status: target, version: p.data.version + 1 } });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      return dbError(reply, e);
    } finally {
      client.release();
    }
  });
  app.post("/:id/card/printed", async (req, reply) => {
    if (!canView(req.user)) return sendError(reply, 403, "ليست لديك صلاحية طباعة كارت السداء", "FORBIDDEN");
    const { id } = req.params as { id: string };
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const q = await client.query<{
        id: string;
        card_no: string;
        barcode: string;
        card_data: Record<string, unknown>;
        print_count: number;
        status: WarpingStatus;
      }>(
        `SELECT c.id,c.card_no,c.barcode,c.card_data,c.print_count,x.status FROM manufacturing_warp_cards c JOIN manufacturing_warping_orders x ON x.id=c.warping_order_id AND x.company_id=c.company_id WHERE c.warping_order_id=$1 AND c.company_id=$2 AND c.status='ACTIVE' FOR UPDATE OF c`,
        [id, req.user!.companyId],
      );
      if (!q.rows.length) {
        await client.query("ROLLBACK");
        return sendError(reply, 404, "لا يوجد كارت سداء فعال لهذا الأمر", "NOT_FOUND");
      }
      const c = q.rows[0];
      await client.query(
        `UPDATE manufacturing_warp_cards SET print_count=print_count+1 WHERE id=$1 AND company_id=$2`,
        [c.id, req.user!.companyId],
      );
      await event(
        client,
        req.user!.companyId,
        id,
        "CARD_PRINTED",
        c.status,
        c.status,
        { cardNo: c.card_no, printCount: c.print_count + 1 },
        req.user!.sub,
      );
      await client.query("COMMIT");
      return reply.send({
        ok: true,
        data: { cardNo: c.card_no, barcode: c.barcode, cardData: c.card_data, printCount: c.print_count + 1 },
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      return dbError(reply, e);
    } finally {
      client.release();
    }
  });
};

async function event(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  companyId: string,
  id: string,
  type: string,
  oldStatus: string | null,
  newStatus: string,
  details: unknown,
  userId: string,
) {
  await client.query(
    `INSERT INTO manufacturing_warping_order_events(company_id,warping_order_id,event_type,old_status,new_status,details,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [companyId, id, type, oldStatus, newStatus, JSON.stringify(details), userId],
  );
}
