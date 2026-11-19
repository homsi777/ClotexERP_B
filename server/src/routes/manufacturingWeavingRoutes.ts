import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { authenticateRequest, type JwtPayload } from "../middleware/auth.js";
import { sendError } from "../middleware/errorHandler.js";
import {
  calculateShiftProduction,
  generateWeavingRunNo,
} from "../services/manufacturingWeavingService.js";
import { generateBarcode } from "../utils/rollHelpers.js";
const has = (u: JwtPayload | undefined, p: string) =>
  Boolean(u && (u.role === "admin" || u.permissions.includes(p)));
export const manufacturingWeavingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateRequest);
  app.get("/", async (req, reply) => {
    if (
      !has(req.user, "manufacturing.weaving.view") &&
      !has(req.user, "manufacturing.dashboard.view")
    )
      return sendError(reply, 403, "ليست لديك صلاحية عرض النسج", "FORBIDDEN");
    const r = await getPool().query(
      `SELECT x.*,w.work_order_no,m.code AS loom_code,e.full_name AS operator_name,s.name AS shift_name,GREATEST(x.planned_length_m-x.produced_length_m,0) AS remaining_length_m FROM manufacturing_weaving_runs x JOIN manufacturing_work_orders w ON w.id=x.work_order_id AND w.company_id=x.company_id JOIN manufacturing_machines m ON m.id=x.loom_id AND m.company_id=x.company_id LEFT JOIN payroll_employees e ON e.id=x.operator_employee_id AND e.company_id=x.company_id LEFT JOIN attendance_shift_types s ON s.id=x.shift_type_id AND s.company_id=x.company_id WHERE x.company_id=$1 ORDER BY x.created_at DESC`,
      [req.user!.companyId],
    );
    return reply.send({ ok: true, data: r.rows });
  });
  app.get("/options", async (req, reply) => {
    if (
      !has(req.user, "manufacturing.weaving.view") &&
      !has(req.user, "manufacturing.weaving.manage")
    )
      return sendError(
        reply,
        403,
        "ليست لديك صلاحية خيارات النسج",
        "FORBIDDEN",
      );
    const c = req.user!.companyId;
    const [beams, sized, looms, employees, shifts, reasons] = await Promise.all(
      [
        getPool().query(
          `SELECT b.id,b.beam_no,b.length_m,w.work_order_id FROM manufacturing_warp_beams b JOIN manufacturing_warping_orders w ON w.id=b.warping_order_id AND w.company_id=b.company_id WHERE b.company_id=$1 AND b.status='READY_FOR_WEAVING'`,
          [c],
        ),
        getPool().query(
          `SELECT b.id,b.beam_no,b.length_m,w.work_order_id FROM manufacturing_sized_beams b JOIN manufacturing_sizing_orders s ON s.id=b.sizing_order_id AND s.company_id=b.company_id JOIN manufacturing_warp_beams i ON i.id=s.input_beam_id AND i.company_id=s.company_id JOIN manufacturing_warping_orders w ON w.id=i.warping_order_id AND w.company_id=i.company_id WHERE b.company_id=$1 AND b.status='READY_FOR_WEAVING'`,
          [c],
        ),
        getPool().query(
          `SELECT id,code,name FROM manufacturing_machines WHERE company_id=$1 AND machine_type='LOOM' AND is_active AND operational_status='ACTIVE' ORDER BY code`,
          [c],
        ),
        getPool().query(
          `SELECT id,employee_code,full_name FROM payroll_employees WHERE company_id=$1 AND is_active ORDER BY full_name`,
          [c],
        ),
        getPool().query(
          `SELECT id,code,name FROM attendance_shift_types WHERE company_id=$1 AND is_active ORDER BY name`,
          [c],
        ),
        getPool().query(
          `SELECT id,code,name FROM manufacturing_downtime_reasons WHERE company_id=$1 AND is_active AND stage IN('ALL','WEAVING')`,
          [c],
        ),
      ],
    );
    return reply.send({
      ok: true,
      data: {
        beams: beams.rows,
        sizedBeams: sized.rows,
        looms: looms.rows,
        employees: employees.rows,
        shifts: shifts.rows,
        downtimeReasons: reasons.rows,
      },
    });
  });
  app.post("/", async (req, reply) => {
    if (!has(req.user, "manufacturing.weaving.manage"))
      return sendError(
        reply,
        403,
        "ليست لديك صلاحية إنشاء تشغيل نسج",
        "FORBIDDEN",
      );
    const p = z
      .object({
        beamType: z.enum(["WARP", "SIZED"]),
        beamId: z.string().uuid(),
        loomId: z.string().uuid(),
        operatorEmployeeId: z.string().uuid().nullable().optional(),
        shiftTypeId: z.string().uuid().nullable().optional(),
        openingCounter: z.number().min(0).nullable().optional(),
      })
      .safeParse(req.body);
    if (!p.success)
      return sendError(
        reply,
        400,
        "بيانات تشغيل النسج غير صالحة",
        "VALIDATION",
      );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const sql =
        p.data.beamType === "WARP"
          ? `SELECT b.length_m,w.work_order_id,b.status FROM manufacturing_warp_beams b JOIN manufacturing_warping_orders w ON w.id=b.warping_order_id AND w.company_id=b.company_id WHERE b.id=$1 AND b.company_id=$2 FOR UPDATE OF b`
          : `SELECT b.length_m,w.work_order_id,b.status FROM manufacturing_sized_beams b JOIN manufacturing_sizing_orders s ON s.id=b.sizing_order_id AND s.company_id=b.company_id JOIN manufacturing_warp_beams i ON i.id=s.input_beam_id AND i.company_id=s.company_id JOIN manufacturing_warping_orders w ON w.id=i.warping_order_id AND w.company_id=i.company_id WHERE b.id=$1 AND b.company_id=$2 FOR UPDATE OF b`;
      const beam = await client.query<{
        length_m: string;
        work_order_id: string;
        status: string;
      }>(sql, [p.data.beamId, req.user!.companyId]);
      if (!beam.rows.length || beam.rows[0].status !== "READY_FOR_WEAVING") {
        await client.query("ROLLBACK");
        return sendError(
          reply,
          409,
          "المطواة غير متاحة للنسج",
          "INVALID_STATE",
        );
      }
      const loom = await client.query(
        `SELECT id FROM manufacturing_machines WHERE id=$1 AND company_id=$2 AND machine_type='LOOM' AND is_active AND operational_status='ACTIVE'`,
        [p.data.loomId, req.user!.companyId],
      );
      if (!loom.rows.length) {
        await client.query("ROLLBACK");
        return sendError(reply, 400, "النول غير صالح أو غير نشط", "VALIDATION");
      }
      const no = await generateWeavingRunNo(client, req.user!.companyId);
      const row = await client.query<{ id: string }>(
        `INSERT INTO manufacturing_weaving_runs(company_id,run_no,work_order_id,warp_beam_id,sized_beam_id,loom_id,operator_employee_id,shift_type_id,planned_length_m,opening_counter,current_counter,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$11) RETURNING id`,
        [
          req.user!.companyId,
          no,
          beam.rows[0].work_order_id,
          p.data.beamType === "WARP" ? p.data.beamId : null,
          p.data.beamType === "SIZED" ? p.data.beamId : null,
          p.data.loomId,
          p.data.operatorEmployeeId ?? null,
          p.data.shiftTypeId ?? null,
          Number(beam.rows[0].length_m),
          p.data.openingCounter ?? null,
          req.user!.sub,
        ],
      );
      await client.query("COMMIT");
      return reply
        .status(201)
        .send({ ok: true, data: { id: row.rows[0].id, runNo: no } });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });
  app.post("/:id/start", async (req, reply) => {
    if (!has(req.user, "manufacturing.weaving.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية بدء النسج", "FORBIDDEN");
    const { id } = req.params as { id: string };
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<{
        status: string;
        warp_beam_id: string | null;
        sized_beam_id: string | null;
      }>(
        `SELECT status,warp_beam_id,sized_beam_id FROM manufacturing_weaving_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, req.user!.companyId],
      );
      if (!r.rows.length || r.rows[0].status !== "DRAFT") {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "التشغيل ليس مسودة", "INVALID_STATE");
      }
      const x = r.rows[0];
      await client.query(
        `UPDATE manufacturing_weaving_runs SET status='IN_PROGRESS',started_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, req.user!.companyId],
      );
      await client.query(
        `UPDATE ${x.warp_beam_id ? "manufacturing_warp_beams" : "manufacturing_sized_beams"} SET status='IN_WEAVING',updated_at=now() WHERE id=$1 AND company_id=$2`,
        [x.warp_beam_id ?? x.sized_beam_id, req.user!.companyId],
      );
      await client.query("COMMIT");
      return reply.send({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });
  app.post("/:id/shift-logs", async (req, reply) => {
    if (!has(req.user, "manufacturing.weaving.manage"))
      return sendError(
        reply,
        403,
        "ليست لديك صلاحية تسجيل الوردية",
        "FORBIDDEN",
      );
    const { id } = req.params as { id: string };
    const p = z
      .object({
        productionDate: z.string().date(),
        counterStart: z.number().min(0),
        counterEnd: z.number().min(0),
        operatorEmployeeId: z.string().uuid().nullable().optional(),
        shiftTypeId: z.string().uuid().nullable().optional(),
        downtimeMinutes: z.number().int().min(0).default(0),
        downtimeReasonId: z.string().uuid().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .safeParse(req.body);
    if (!p.success)
      return sendError(reply, 400, "بيانات الوردية غير صالحة", "VALIDATION");
    const produced = calculateShiftProduction(
      p.data.counterStart,
      p.data.counterEnd,
    );
    if (produced === null)
      return sendError(reply, 400, "عداد النهاية أقل من البداية", "VALIDATION");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const run = await client.query<{
        status: string;
        produced_length_m: string;
      }>(
        `SELECT status,produced_length_m FROM manufacturing_weaving_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, req.user!.companyId],
      );
      if (!run.rows.length || run.rows[0].status !== "IN_PROGRESS") {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "التشغيل ليس قيد العمل", "INVALID_STATE");
      }
      await client.query(
        `INSERT INTO manufacturing_weaving_shift_logs(company_id,weaving_run_id,operator_employee_id,shift_type_id,production_date,counter_start,counter_end,produced_length_m,downtime_minutes,downtime_reason_id,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          req.user!.companyId,
          id,
          p.data.operatorEmployeeId ?? null,
          p.data.shiftTypeId ?? null,
          p.data.productionDate,
          p.data.counterStart,
          p.data.counterEnd,
          produced,
          p.data.downtimeMinutes,
          p.data.downtimeReasonId ?? null,
          p.data.notes ?? null,
          req.user!.sub,
        ],
      );
      await client.query(
        `UPDATE manufacturing_weaving_runs SET produced_length_m=produced_length_m+$3,current_counter=$4,version=version+1,updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, req.user!.companyId, produced, p.data.counterEnd],
      );
      await client.query("COMMIT");
      return reply.status(201).send({
        ok: true,
        data: {
          producedLengthM: produced,
          totalProducedLengthM:
            Number(run.rows[0].produced_length_m) + produced,
        },
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });

  app.post("/:id/complete", async (req, reply) => {
    if (!has(req.user, "manufacturing.weaving.manage"))
      return sendError(
        reply,
        403,
        "ليست لديك صلاحية إغلاق تشغيل النسج",
        "FORBIDDEN",
      );
    const { id } = req.params as { id: string };
    const p = z
      .object({
        rolls: z
          .array(
            z.object({
              rollNo: z.string().trim().min(1).max(100),
              lengthM: z.number().positive(),
            }),
          )
          .min(1)
          .max(200),
      })
      .safeParse(req.body);
    if (!p.success)
      return sendError(
        reply,
        400,
        "بيانات رولات الإنتاج غير صالحة",
        "VALIDATION",
      );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const run = await client.query<{
        status: string;
        run_no: string;
        produced_length_m: string;
        warp_beam_id: string | null;
        sized_beam_id: string | null;
      }>(
        `SELECT status,run_no,produced_length_m,warp_beam_id,sized_beam_id FROM manufacturing_weaving_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, req.user!.companyId],
      );
      if (!run.rows.length || run.rows[0].status !== "IN_PROGRESS") {
        await client.query("ROLLBACK");
        return sendError(
          reply,
          409,
          "تشغيل النسج ليس قيد العمل",
          "INVALID_STATE",
        );
      }
      const total = p.data.rolls.reduce((s, x) => s + x.lengthM, 0);
      if (total > Number(run.rows[0].produced_length_m) + 0.0005) {
        await client.query("ROLLBACK");
        return sendError(
          reply,
          400,
          "إجمالي أطوال الرولات يتجاوز الإنتاج المسجل",
          "VALIDATION",
        );
      }
      const batch = `${run.rows[0].run_no}-B1`;
      for (const roll of p.data.rolls)
        await client.query(
          `INSERT INTO manufacturing_raw_roll_outputs(company_id,weaving_run_id,production_batch_no,roll_no,production_barcode,length_m,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            req.user!.companyId,
            id,
            batch,
            roll.rollNo,
            `RAW-${crypto.randomUUID()}`,
            roll.lengthM,
            req.user!.sub,
          ],
        );
      await client.query(
        `UPDATE manufacturing_weaving_runs SET status='COMPLETED',completed_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, req.user!.companyId],
      );
      await client.query(
        `UPDATE ${run.rows[0].warp_beam_id ? "manufacturing_warp_beams" : "manufacturing_sized_beams"} SET status='CONSUMED',updated_at=now() WHERE id=$1 AND company_id=$2`,
        [
          run.rows[0].warp_beam_id ?? run.rows[0].sized_beam_id,
          req.user!.companyId,
        ],
      );
      await client.query("COMMIT");
      return reply.send({
        ok: true,
        data: { id, status: "COMPLETED", productionBatchNo: batch },
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });

  app.get("/raw-rolls/pending", async (req, reply) => {
    if (
      !has(req.user, "manufacturing.weaving.view") &&
      !has(req.user, "manufacturing.raw_inspection.manage")
    )
      return sendError(
        reply,
        403,
        "ليست لديك صلاحية عرض فحص الخام",
        "FORBIDDEN",
      );
    const rows = await getPool().query(
      `SELECT r.*,w.run_no,w.work_order_id,m.code AS loom_code FROM manufacturing_raw_roll_outputs r JOIN manufacturing_weaving_runs w ON w.id=r.weaving_run_id AND w.company_id=r.company_id JOIN manufacturing_machines m ON m.id=w.loom_id AND m.company_id=w.company_id WHERE r.company_id=$1 AND r.inspection_status='PENDING' ORDER BY r.created_at DESC`,
      [req.user!.companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post("/raw-rolls/:rollId/inspect", async (req, reply) => {
    if (!has(req.user, "manufacturing.raw_inspection.manage"))
      return sendError(
        reply,
        403,
        "ليست لديك صلاحية اعتماد فحص الخام",
        "FORBIDDEN",
      );
    const { rollId } = req.params as { rollId: string };
    const p = z
      .object({
        result: z.enum(["ACCEPTED", "CONDITIONAL", "REJECTED"]),
        itemId: z.string().uuid().nullable().optional(),
        colorId: z.string().uuid().nullable().optional(),
        warehouseId: z.string().uuid().nullable().optional(),
        locationId: z.string().uuid().nullable().optional(),
        widthCm: z.number().positive().nullable().optional(),
        actualWeightKg: z.number().min(0).nullable().optional(),
        gsm: z.number().positive().nullable().optional(),
        grade: z.string().max(50).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        defects: z
          .array(
            z.object({
              defectId: z.string().uuid(),
              positionM: z.number().min(0).nullable().optional(),
              quantity: z.number().int().positive().default(1),
              severity: z
                .enum(["MINOR", "MAJOR", "CRITICAL"])
                .nullable()
                .optional(),
              notes: z.string().max(1000).nullable().optional(),
            }),
          )
          .max(200)
          .default([]),
      })
      .safeParse(req.body);
    if (!p.success)
      return sendError(reply, 400, "بيانات الفحص غير صالحة", "VALIDATION");
    if (p.data.result !== "REJECTED" && (!p.data.itemId || !p.data.warehouseId))
      return sendError(
        reply,
        400,
        "الصنف والمستودع مطلوبان للرول المقبول",
        "VALIDATION",
      );
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const raw = await client.query<{
        length_m: string;
        production_batch_no: string;
        roll_no: string;
        inspection_status: string;
        weaving_run_id: string;
      }>(
        `SELECT length_m,production_batch_no,roll_no,inspection_status,weaving_run_id FROM manufacturing_raw_roll_outputs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [rollId, req.user!.companyId],
      );
      if (!raw.rows.length || raw.rows[0].inspection_status !== "PENDING") {
        await client.query("ROLLBACK");
        return sendError(
          reply,
          409,
          "الرول غير موجود أو سبق فحصه",
          "INVALID_STATE",
        );
      }
      if (
        p.data.defects.some(
          (defect) =>
            defect.positionM != null &&
            defect.positionM > Number(raw.rows[0].length_m),
        )
      ) {
        await client.query("ROLLBACK");
        return sendError(
          reply,
          400,
          "موقع العيب لا يمكن أن يتجاوز طول الرول",
          "VALIDATION",
        );
      }
      const references = await client.query<{
        color_ok: boolean;
        location_ok: boolean;
        defects_ok: boolean;
      }>(
        `SELECT
          ($1::uuid IS NULL OR EXISTS(
            SELECT 1 FROM fabric_colors WHERE id=$1 AND company_id=$5 AND is_active
          )) AS color_ok,
          ($2::uuid IS NULL OR EXISTS(
            SELECT 1 FROM warehouse_locations
            WHERE id=$2 AND warehouse_id=$3 AND company_id=$5 AND is_active
          )) AS location_ok,
          NOT EXISTS(
            SELECT 1 FROM unnest($4::uuid[]) AS requested(defect_id)
            WHERE NOT EXISTS(
              SELECT 1 FROM manufacturing_quality_defect_catalog catalog
              WHERE catalog.id=requested.defect_id AND catalog.company_id=$5
                AND catalog.is_active
                AND catalog.inspection_type IN ('ALL','RAW_FABRIC')
            )
          ) AS defects_ok`,
        [
          p.data.colorId ?? null,
          p.data.locationId ?? null,
          p.data.warehouseId ?? null,
          p.data.defects.map((defect) => defect.defectId),
          req.user!.companyId,
        ],
      );
      const validReferences = references.rows[0];
      if (
        !validReferences.color_ok ||
        !validReferences.location_ok ||
        !validReferences.defects_ok
      ) {
        await client.query("ROLLBACK");
        return sendError(
          reply,
          400,
          "اللون أو الموقع أو أحد العيوب غير صالح لهذا الفحص",
          "VALIDATION",
        );
      }
      let fabricRollId: string | null = null;
      if (p.data.result !== "REJECTED") {
        const refs = await client.query(
          `SELECT EXISTS(SELECT 1 FROM fabric_items WHERE id=$1 AND company_id=$3) AS item_ok,EXISTS(SELECT 1 FROM warehouses WHERE id=$2 AND company_id=$3) AS warehouse_ok`,
          [p.data.itemId, p.data.warehouseId, req.user!.companyId],
        );
        if (!refs.rows[0].item_ok || !refs.rows[0].warehouse_ok) {
          await client.query("ROLLBACK");
          return sendError(
            reply,
            400,
            "الصنف أو المستودع لا يتبع الشركة",
            "VALIDATION",
          );
        }
        const barcode = await generateBarcode(client, req.user!.companyId);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO fabric_rolls(company_id,roll_no,barcode,item_id,color_id,warehouse_id,location_id,length_m,width_cm,gsm,actual_weight_kg,batch_no,status,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'AVAILABLE',$13,$14) RETURNING id`,
          [
            req.user!.companyId,
            raw.rows[0].roll_no,
            barcode,
            p.data.itemId,
            p.data.colorId ?? null,
            p.data.warehouseId,
            p.data.locationId ?? null,
            Number(raw.rows[0].length_m),
            p.data.widthCm ?? null,
            p.data.gsm ?? null,
            p.data.actualWeightKg ?? null,
            raw.rows[0].production_batch_no,
            p.data.notes ?? null,
            req.user!.sub,
          ],
        );
        fabricRollId = inserted.rows[0].id;
        await client.query(
          `INSERT INTO inventory_movements(company_id,roll_id,movement_type,to_warehouse_id,to_location_id,new_status,length_delta_m,weight_delta_kg,reference_type,reference_id,reference_no,notes,created_by_user_id) VALUES($1,$2,'INTERNAL_PRODUCTION',$3,$4,'AVAILABLE',$5,$6,'WEAVING_RUN',$7,$8,$9,$10)`,
          [
            req.user!.companyId,
            fabricRollId,
            p.data.warehouseId,
            p.data.locationId ?? null,
            Number(raw.rows[0].length_m),
            p.data.actualWeightKg ?? null,
            raw.rows[0].weaving_run_id,
            raw.rows[0].production_batch_no,
            p.data.notes ?? null,
            req.user!.sub,
          ],
        );
      }
      await client.query(
        `UPDATE manufacturing_raw_roll_outputs SET inspection_status=$3,width_cm=$4,actual_weight_kg=$5,gsm=$6,grade=$7,inspection_notes=$8,result_fabric_roll_id=$9,inspected_by_user_id=$10,inspected_at=now() WHERE id=$1 AND company_id=$2`,
        [
          rollId,
          req.user!.companyId,
          p.data.result,
          p.data.widthCm ?? null,
          p.data.actualWeightKg ?? null,
          p.data.gsm ?? null,
          p.data.grade ?? null,
          p.data.notes ?? null,
          fabricRollId,
          req.user!.sub,
        ],
      );
      for (const d of p.data.defects)
        await client.query(
          `INSERT INTO manufacturing_raw_roll_defects(company_id,raw_roll_output_id,defect_id,position_m,quantity,severity,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            req.user!.companyId,
            rollId,
            d.defectId,
            d.positionM ?? null,
            d.quantity,
            d.severity ?? null,
            d.notes ?? null,
            req.user!.sub,
          ],
        );
      await client.query("COMMIT");
      return reply.send({
        ok: true,
        data: { id: rollId, status: p.data.result, fabricRollId },
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });
};
