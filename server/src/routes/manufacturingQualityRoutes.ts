import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { authenticateRequest, type JwtPayload } from "../middleware/auth.js";
import { sendError } from "../middleware/errorHandler.js";
import { generateBarcode } from "../utils/rollHelpers.js";
import { calculateRollReceiptBalance, validateQualityBreakdown } from "../services/manufacturingQualityService.js";

import { manufacturingQualityCompletionRoutes } from './manufacturingQualityCompletionRoutes.js';
import { qualityChecklistSchema } from '../services/manufacturingQualityCompletionService.js';

const has = (user: JwtPayload | undefined, permission: string) =>
  Boolean(user && (user.role === "admin" || user.permissions.includes(permission)));
const defectSchema = z.object({
  defectId: z.string().uuid(), positionM: z.number().min(0).nullable().optional(),
  quantity: z.number().int().positive().default(1), severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const manufacturingQualityRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateRequest);
  await app.register(manufacturingQualityCompletionRoutes);

  app.get("/batches", async (req, reply) => {
    if (!has(req.user, "manufacturing.weaving.view") && !has(req.user, "manufacturing.raw_inspection.manage") && !has(req.user, "inventory.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية عرض دفعات الجودة", "FORBIDDEN");
    const rows = await getPool().query(
      `SELECT b.*,r.run_no,r.work_order_id,w.work_order_no,m.code AS loom_code,
        s.production_date,s.counter_start,s.counter_end,s.downtime_minutes,
        e.full_name AS operator_name,st.name AS shift_name,
        COALESCE((SELECT SUM(o.length_m) FROM manufacturing_raw_roll_outputs o WHERE o.company_id=b.company_id AND o.production_batch_id=b.id),0) AS received_roll_length_m
       FROM manufacturing_production_batches b
       JOIN manufacturing_weaving_runs r ON r.id=b.weaving_run_id AND r.company_id=b.company_id
       JOIN manufacturing_work_orders w ON w.id=r.work_order_id AND w.company_id=r.company_id
       JOIN manufacturing_machines m ON m.id=r.loom_id AND m.company_id=r.company_id
       JOIN manufacturing_weaving_shift_logs s ON s.id=b.shift_log_id AND s.company_id=b.company_id
       LEFT JOIN payroll_employees e ON e.id=s.operator_employee_id AND e.company_id=s.company_id
       LEFT JOIN attendance_shift_types st ON st.id=s.shift_type_id AND st.company_id=s.company_id
       WHERE b.company_id=$1 ORDER BY b.created_at DESC`,
      [req.user!.companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.get("/batches/:batchId/report", async (req, reply) => {
    if (!has(req.user, "manufacturing.weaving.view") && !has(req.user, "manufacturing.raw_inspection.manage") && !has(req.user, "inventory.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية عرض تقرير الجودة", "FORBIDDEN");
    const { batchId } = req.params as { batchId: string };
    const [batch, defects, rolls] = await Promise.all([
      getPool().query(
        `SELECT b.*,r.run_no,w.work_order_no,m.code AS loom_code,m.name AS loom_name,s.production_date,s.counter_start,s.counter_end,s.downtime_minutes,
          e.full_name AS operator_name,st.name AS shift_name,inspector.full_name AS inspector_name,approver.full_name AS approver_name
         FROM manufacturing_production_batches b
         JOIN manufacturing_weaving_runs r ON r.id=b.weaving_run_id AND r.company_id=b.company_id
         JOIN manufacturing_work_orders w ON w.id=r.work_order_id AND w.company_id=r.company_id
         JOIN manufacturing_machines m ON m.id=r.loom_id AND m.company_id=r.company_id
         JOIN manufacturing_weaving_shift_logs s ON s.id=b.shift_log_id AND s.company_id=b.company_id
         LEFT JOIN payroll_employees e ON e.id=s.operator_employee_id AND e.company_id=s.company_id
         LEFT JOIN attendance_shift_types st ON st.id=s.shift_type_id AND st.company_id=s.company_id
         LEFT JOIN users inspector ON inspector.id=b.inspected_by_user_id
         LEFT JOIN users approver ON approver.id=b.approved_by_user_id
         WHERE b.id=$1 AND b.company_id=$2`, [batchId, req.user!.companyId],
      ),
      getPool().query(
        `SELECT x.defect_id,x.position_m,x.quantity,x.severity,x.notes,d.code,d.name FROM manufacturing_production_batch_defects x
         JOIN manufacturing_quality_defect_catalog d ON d.id=x.defect_id AND d.company_id=x.company_id WHERE x.production_batch_id=$1 AND x.company_id=$2 ORDER BY x.created_at`,
        [batchId, req.user!.companyId],
      ),
      getPool().query(
        `SELECT roll_no,production_barcode,length_m,width_cm,actual_weight_kg,gsm FROM manufacturing_raw_roll_outputs WHERE production_batch_id=$1 AND company_id=$2 ORDER BY created_at`,
        [batchId, req.user!.companyId],
      ),
    ]);
    if (!batch.rows.length) return sendError(reply, 404, "دفعة الإنتاج غير موجودة", "NOT_FOUND");
    return reply.send({ ok: true, data: { batch: batch.rows[0], defects: defects.rows, rolls: rolls.rows } });
  });

  app.put("/batches/:batchId/inspection", async (req, reply) => {
    if (!has(req.user, "manufacturing.raw_inspection.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية تسجيل فحص الجودة", "FORBIDDEN");
    const { batchId } = req.params as { batchId: string };
    const parsed = z.object({
      cleanLengthM: z.number().min(0), reworkLengthM: z.number().min(0),
      rejectedLengthM: z.number().min(0), pendingLengthM: z.number().min(0),
      checklist: qualityChecklistSchema.default([]),
      notes: z.string().max(2000).nullable().optional(), defects: z.array(defectSchema).max(300).default([]),
    }).safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "بيانات فحص الدفعة غير صالحة", "VALIDATION");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const batch = await client.query<{ produced_length_m: string; status: string }>(
        `SELECT produced_length_m,status FROM manufacturing_production_batches WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [batchId, req.user!.companyId],
      );
      if (!batch.rows.length || batch.rows[0].status === "APPROVED" || batch.rows[0].status === "CLOSED") {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "الدفعة غير موجودة أو سبق اعتمادها", "INVALID_STATE");
      }
      const breakdown = validateQualityBreakdown({ producedLengthM: Number(batch.rows[0].produced_length_m), ...parsed.data });
      if (!breakdown.balanced) {
        await client.query("ROLLBACK");
        return sendError(reply, 400, "يجب أن يساوي مجموع فئات الجودة إجمالي إنتاج الدفعة", "UNBALANCED_INSPECTION");
      }
      if (parsed.data.defects.some((d) => d.positionM != null && d.positionM > Number(batch.rows[0].produced_length_m))) {
        await client.query("ROLLBACK");
        return sendError(reply, 400, "موقع العيب يتجاوز طول إنتاج الدفعة", "VALIDATION");
      }
      const validDefects = await client.query<{ ok: boolean }>(
        `SELECT NOT EXISTS(SELECT 1 FROM unnest($1::uuid[]) requested(id) WHERE NOT EXISTS(
          SELECT 1 FROM manufacturing_quality_defect_catalog d WHERE d.id=requested.id AND d.company_id=$2 AND d.is_active AND d.inspection_type IN('ALL','RAW_FABRIC')
        )) AS ok`,
        [parsed.data.defects.map((d) => d.defectId), req.user!.companyId],
      );
      if (!validDefects.rows[0].ok) {
        await client.query("ROLLBACK");
        return sendError(reply, 400, "أحد العيوب غير صالح لفحص القماش الخام", "VALIDATION");
      }
      await client.query(
        `UPDATE manufacturing_production_batches SET clean_length_m=$3,rework_length_m=$4,rejected_length_m=$5,pending_length_m=$6,
          quality_checklist=$9,inspection_notes=$7,status='INSPECTED',inspected_by_user_id=$8,inspected_at=now(),updated_at=now() WHERE id=$1 AND company_id=$2`,
        [batchId, req.user!.companyId, parsed.data.cleanLengthM, parsed.data.reworkLengthM, parsed.data.rejectedLengthM, parsed.data.pendingLengthM, parsed.data.notes ?? null, req.user!.sub, JSON.stringify(parsed.data.checklist)],
      );
      await client.query(`DELETE FROM manufacturing_production_batch_defects WHERE production_batch_id=$1 AND company_id=$2`, [batchId, req.user!.companyId]);
      for (const defect of parsed.data.defects) await client.query(
        `INSERT INTO manufacturing_production_batch_defects(company_id,production_batch_id,defect_id,position_m,quantity,severity,notes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.user!.companyId, batchId, defect.defectId, defect.positionM ?? null, defect.quantity, defect.severity ?? null, defect.notes ?? null, req.user!.sub],
      );
      await client.query("COMMIT");
      return reply.send({ ok: true, data: { id: batchId, status: "INSPECTED" } });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  });

  app.post("/batches/:batchId/approve", async (req, reply) => {
    const user=req.user!;
    if (!has(user,'manufacturing.raw_inspection.manage') && !['admin','accountant'].includes(user.role))
      return sendError(reply,403,'ليست لديك صلاحية اعتماد فحص الجودة','FORBIDDEN');
    const {batchId}=req.params as {batchId:string};
    const db=await getPool().connect();
    try {
      await db.query('BEGIN');
      const batch=(await db.query(`SELECT * FROM manufacturing_production_batches WHERE id=$1 AND company_id=$2 FOR UPDATE`,[batchId,user.companyId])).rows[0];
      if(!batch||batch.status!=='INSPECTED') {await db.query('ROLLBACK');return sendError(reply,409,'يجب تسجيل الفحص قبل اعتماده','INVALID_STATE');}
      if(Number(batch.rejected_length_m)>0 && (!['admin','accountant'].includes(user.role)||batch.inspected_by_user_id===user.sub)) {
        await db.query('ROLLBACK');return sendError(reply,403,'الهالك يتطلب اعتماد مدير أو محاسب مختلف عن الفاحص','WASTE_APPROVAL_REQUIRED');
      }
      const breakdown=validateQualityBreakdown({producedLengthM:Number(batch.produced_length_m),cleanLengthM:Number(batch.clean_length_m),reworkLengthM:Number(batch.rework_length_m),rejectedLengthM:Number(batch.rejected_length_m),pendingLengthM:Number(batch.pending_length_m)});
      if(!batch.inspected_by_user_id||!batch.inspected_at||!breakdown.balanced){await db.query('ROLLBACK');return sendError(reply,409,'الفحص غير مكتمل أو كمياته غير متوازنة','INVALID_STATE');}
      await db.query(`UPDATE manufacturing_production_batches SET status='APPROVED',approved_by_user_id=$3,approved_at=now(),updated_at=now() WHERE id=$1 AND company_id=$2`,[batchId,user.companyId,user.sub]);
      await db.query('COMMIT');return reply.send({ok:true,data:{id:batchId,status:'APPROVED'}});
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  });

  app.post("/batches/:batchId/rolls", async (req, reply) => {
    if (!has(req.user, "inventory.manage"))
      return sendError(reply, 403, "ليست لديك صلاحية إدخال الرولات إلى المخزون", "FORBIDDEN");
    const { batchId } = req.params as { batchId: string };
    const parsed = z.object({
      itemId: z.string().uuid(), colorId: z.string().uuid().nullable().optional(), warehouseId: z.string().uuid(),
      locationId: z.string().uuid().nullable().optional(), notes: z.string().max(2000).nullable().optional(),
      rolls: z.array(z.object({ rollNo: z.string().trim().min(1).max(100), lengthM: z.number().positive(), widthCm: z.number().positive().nullable().optional(), actualWeightKg: z.number().min(0).nullable().optional(), gsm: z.number().positive().nullable().optional() })).min(1).max(200),
    }).safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "بيانات إدخال الرولات غير صالحة", "VALIDATION");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const batch = await client.query<{ status: string; clean_length_m: string; weaving_run_id: string; batch_no: string }>(
        `SELECT status,clean_length_m,weaving_run_id,batch_no FROM manufacturing_production_batches WHERE id=$1 AND company_id=$2 FOR UPDATE`, [batchId, req.user!.companyId],
      );
      if (!batch.rows.length || !["APPROVED", "CLOSED"].includes(batch.rows[0].status)) {
        await client.query("ROLLBACK"); return sendError(reply, 409, "دفعة الجودة غير معتمدة", "INVALID_STATE");
      }
      const references = await client.query<{ item_ok: boolean; warehouse_ok: boolean; color_ok: boolean; location_ok: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM fabric_items WHERE id=$1 AND company_id=$5 AND is_active) item_ok,
          EXISTS(SELECT 1 FROM warehouses WHERE id=$2 AND company_id=$5 AND is_active) warehouse_ok,
          ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM fabric_colors WHERE id=$3 AND company_id=$5 AND is_active)) color_ok,
          ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM warehouse_locations WHERE id=$4 AND warehouse_id=$2 AND company_id=$5 AND is_active)) location_ok`,
        [parsed.data.itemId, parsed.data.warehouseId, parsed.data.colorId ?? null, parsed.data.locationId ?? null, req.user!.companyId],
      );
      if (Object.values(references.rows[0]).some((value) => !value)) {
        await client.query("ROLLBACK"); return sendError(reply, 400, "مرجع مخزني غير صالح", "VALIDATION");
      }
      const received = await client.query<{ length_m: string }>(
        `SELECT COALESCE(SUM(length_m),0) length_m FROM manufacturing_raw_roll_outputs WHERE production_batch_id=$1 AND company_id=$2`, [batchId, req.user!.companyId],
      );
      const balance = calculateRollReceiptBalance({ approvedCleanLengthM: Number(batch.rows[0].clean_length_m), previouslyReceivedLengthM: Number(received.rows[0].length_m), newRollLengthsM: parsed.data.rolls.map((roll) => roll.lengthM) });
      if (balance.exceedsApproved) {
        await client.query("ROLLBACK"); return sendError(reply, 400, "مجموع الرولات يتجاوز الكمية النظيفة المعتمدة", "QUANTITY_EXCEEDED");
      }
      const rollNumbers = parsed.data.rolls.map((roll) => roll.rollNo);
      const duplicate = await client.query(
        `SELECT id FROM manufacturing_raw_roll_outputs WHERE company_id=$1 AND weaving_run_id=$2 AND roll_no=ANY($3::text[]) LIMIT 1`,
        [req.user!.companyId, batch.rows[0].weaving_run_id, rollNumbers],
      );
      if (new Set(rollNumbers).size !== rollNumbers.length || duplicate.rows.length) {
        await client.query("ROLLBACK");
        return sendError(reply, 409, "أحد أرقام الرولات سبق استلامه أو تكرر في الطلب", "DUPLICATE_ROLL");
      }
      // Serialise manufacturing receipts across batches sharing the barcode range.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('MANUFACTURING_ROLL_RECEIPT'))", [req.user!.companyId]);
      for (const roll of parsed.data.rolls) {
        const barcode = await generateBarcode(client, req.user!.companyId);
        const fabricRoll = await client.query<{ id: string }>(
          `INSERT INTO fabric_rolls(company_id,roll_no,barcode,item_id,color_id,warehouse_id,location_id,length_m,width_cm,gsm,actual_weight_kg,batch_no,status,notes,created_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'AVAILABLE',$13,$14) RETURNING id`,
          [req.user!.companyId, roll.rollNo, barcode, parsed.data.itemId, parsed.data.colorId ?? null, parsed.data.warehouseId, parsed.data.locationId ?? null, roll.lengthM, roll.widthCm ?? null, roll.gsm ?? null, roll.actualWeightKg ?? null, batch.rows[0].batch_no, parsed.data.notes ?? null, req.user!.sub],
        );
        await client.query(
          `INSERT INTO manufacturing_raw_roll_outputs(company_id,weaving_run_id,production_batch_id,production_batch_no,roll_no,production_barcode,length_m,width_cm,actual_weight_kg,gsm,inspection_status,result_fabric_roll_id,inspected_by_user_id,inspected_at,created_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACCEPTED',$11,$12,now(),$12)`,
          [req.user!.companyId, batch.rows[0].weaving_run_id, batchId, batch.rows[0].batch_no, roll.rollNo, barcode, roll.lengthM, roll.widthCm ?? null, roll.actualWeightKg ?? null, roll.gsm ?? null, fabricRoll.rows[0].id, req.user!.sub],
        );
        await client.query(
          `INSERT INTO inventory_movements(company_id,roll_id,movement_type,to_warehouse_id,to_location_id,new_status,length_delta_m,weight_delta_kg,reference_type,reference_id,reference_no,notes,created_by_user_id)
           VALUES($1,$2,'INTERNAL_PRODUCTION',$3,$4,'AVAILABLE',$5,$6,'PRODUCTION_BATCH',$7,$8,$9,$10)`,
          [req.user!.companyId, fabricRoll.rows[0].id, parsed.data.warehouseId, parsed.data.locationId ?? null, roll.lengthM, roll.actualWeightKg ?? null, batchId, batch.rows[0].batch_no, parsed.data.notes ?? null, req.user!.sub],
        );
      }
      if (balance.closesBatch) await client.query(`UPDATE manufacturing_production_batches SET status='CLOSED',updated_at=now() WHERE id=$1 AND company_id=$2`, [batchId, req.user!.companyId]);
      await client.query("COMMIT");
      return reply.status(201).send({ ok: true, data: { batchId, receivedLengthM: balance.receivedAfterM, differenceM: balance.differenceM } });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  });
};
