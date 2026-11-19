import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  importAttendanceRows,
  listAttendanceRecords,
  updateAttendanceRecordManual,
  listShiftTypes,
  createShiftType,
  computeMonthlyAttendanceSummaries,
  approveMonthlyAttendanceReview,
  setAttendanceStatus,
  computeMonthlyStatusEffects,
  createEmployeesFromFingerprints,
} from '../services/attendanceService.js';
import { computeDailyAlerts, computeAnnualReport } from '../services/hr/hrInsights.js';
import { ATTENDANCE_STATUS_CODES } from '../services/hr/attendanceStatus.js';
import { insertAuditLog } from '../services/auditLogService.js';

function requirePermission(user: { role: string; permissions: string[] } | undefined, code: string): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.permissions.includes(code);
}

const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;

const importRowSchema = z.object({
  fingerprintCode: z.string().min(1),
  nameInFile: z.string().optional().default(''),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInTime: z.string().regex(timeRegex).optional().nullable(),
  checkOutTime: z.string().regex(timeRegex).optional().nullable(),
  totalHours: z.coerce.number().nonnegative().default(0),
});

const importBody = z.object({
  fileName: z.string().min(1),
  rows: z.array(importRowSchema).min(1),
});

const shiftTypeBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  startTime: z.string().regex(timeRegex),
  endTime: z.string().regex(timeRegex),
  crossesMidnight: z.boolean().optional().default(false),
});

const approveReviewBody = z.object({
  employeeId: z.string().uuid(),
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  notes: z.string().optional().nullable(),
});

const manualUpdateBody = z.object({
  checkInTime: z.string().regex(timeRegex).optional().nullable(),
  checkOutTime: z.string().regex(timeRegex).optional().nullable(),
  lateMinutes: z.coerce.number().nonnegative().optional(),
  permissionMinutes: z.coerce.number().nonnegative().optional(),
  dayType: z.enum(['WORK', 'REST', 'HOLIDAY']).optional(),
  // TASK 018: ساعات الإضافي اليومية بفئات ورقة الانتظام (0–24).
  otDayHours: z.coerce.number().min(0).max(24).optional(),
  otNightHours: z.coerce.number().min(0).max(24).optional(),
  otHoliday1Hours: z.coerce.number().min(0).max(24).optional(),
  otHoliday2Hours: z.coerce.number().min(0).max(24).optional(),
  reason: z.string().min(1, 'سبب التعديل مطلوب'),
});

const setStatusBody = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // null = مسح الحالة
  statusCode: z.enum(ATTENDANCE_STATUS_CODES as [string, ...string[]]).nullable(),
  reason: z.string().trim().min(1, 'سبب التعديل مطلوب'),
});

const createEmployeesBody = z.object({
  employees: z
    .array(z.object({ fingerprintCode: z.string().trim().min(1), nameInFile: z.string().optional().default('') }))
    .min(1)
    .max(300),
});

export const attendanceRoutes: FastifyPluginAsync = async (app) => {
  // TASK 019: إنشاء موظفين من أرقام بصمة غير مرتبطة يختارها المحاسب بعد الاستيراد (أجر 0، اسم + رقم بصمة).
  app.post('/create-employees', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'payroll.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    const parsed = createEmployeesBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await createEmployeesFromFingerprints(client, { companyId, employees: parsed.data.employees });
      await insertAuditLog(client, {
        companyId,
        userId,
        action: 'EMPLOYEES_CREATED_FROM_FINGERPRINT_IMPORT',
        entityType: 'payroll_employee',
        entityId: null,
        details: { count: result.created, codes: parsed.data.employees.map((e) => e.fingerprintCode).slice(0, 100) },
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  // TASK 013: ضبط/مسح حالة يوم (غ، س، ع، م، ز، ج…) — ينشئ سجل اليوم إن لم يوجد. لا يمسّ الرواتب.
  app.put('/status', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    const parsed = setStatusBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const row = await setAttendanceStatus(client, {
        companyId, userId, employeeId: d.employeeId, date: d.date, statusCode: d.statusCode, reason: d.reason,
      });
      await insertAuditLog(client, {
        companyId,
        userId,
        action: 'ATTENDANCE_STATUS_SET',
        entityType: 'attendance_daily_record',
        entityId: row.id,
        details: { employeeId: d.employeeId, date: d.date, statusCode: d.statusCode, reason: d.reason },
      });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: row });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  // شاشة HR: تنبيهات يوم محدد (لم يُسجَّل/غياب/نسيان انصراف/تأخر) — قراءة فقط.
  app.get('/alerts', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const q = req.query as Record<string, string>;
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : new Date().toISOString().slice(0, 10);
    return reply.send({ ok: true, data: await computeDailyAlerts(req.user!.companyId, date) });
  });

  // تقرير سنوي: إجمالي لكل موظف + تفصيل شهري — قراءة فقط.
  app.get('/annual-report', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const q = req.query as Record<string, string>;
    const year = Number.parseInt(q.year ?? '', 10) || new Date().getFullYear();
    if (year < 2000 || year > 2100) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    return reply.send({ ok: true, data: await computeAnnualReport(req.user!.companyId, year, q.employeeId || undefined) });
  });

  // TASK 013: معاينة أثر حالات شهر على الراتب ورصيد الإجازات (قراءة فقط).
  app.get('/monthly-effects', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const year = Number.parseInt(q.year ?? '', 10);
    const month = Number.parseInt(q.month ?? '', 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    }
    const rows = await computeMonthlyStatusEffects(companyId, year, month, q.employeeId || undefined);
    return reply.send({ ok: true, data: { year, month, rows } });
  });

  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const rows = await listAttendanceRecords(companyId, {
      employeeId: q.employeeId || undefined,
      dateFrom: q.dateFrom || undefined,
      dateTo: q.dateTo || undefined,
    });
    return reply.send({ ok: true, data: rows });
  });

  app.post('/import', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await importAttendanceRows(client, { companyId, fileName: d.fileName, rows: d.rows });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = manualUpdateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await updateAttendanceRecordManual(client, {
        companyId,
        userId,
        id,
        checkInTime: d.checkInTime,
        checkOutTime: d.checkOutTime,
        lateMinutes: d.lateMinutes,
        permissionMinutes: d.permissionMinutes,
        dayType: d.dayType,
        otDayHours: d.otDayHours,
        otNightHours: d.otNightHours,
        otHoliday1Hours: d.otHoliday1Hours,
        otHoliday2Hours: d.otHoliday2Hours,
        reason: d.reason,
      });
      await insertAuditLog(client, {
        companyId,
        userId,
        action: 'ATTENDANCE_RECORD_MANUALLY_EDITED',
        entityType: 'attendance_daily_record',
        entityId: id,
        details: { reason: d.reason, checkInTime: d.checkInTime, checkOutTime: d.checkOutTime, lateMinutes: d.lateMinutes, permissionMinutes: d.permissionMinutes, dayType: d.dayType, otDayHours: d.otDayHours, otNightHours: d.otNightHours, otHoliday1Hours: d.otHoliday1Hours, otHoliday2Hours: d.otHoliday2Hours },
      });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: row });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.get('/shift-types', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const rows = await listShiftTypes(companyId);
    return reply.send({ ok: true, data: rows });
  });

  app.post('/shift-types', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const parsed = shiftTypeBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await createShiftType(client, { companyId, ...d });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: row });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return sendError(reply, 409, 'كود الشفت مستخدم مسبقاً', 'DUPLICATE');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.get('/monthly-review', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const periodMonth = Number(q.periodMonth);
    const periodYear = Number(q.periodYear);
    if (!periodMonth || !periodYear) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const rows = await computeMonthlyAttendanceSummaries(companyId, periodMonth, periodYear, q.employeeId || undefined);
    return reply.send({ ok: true, data: rows });
  });

  app.post('/monthly-review/approve', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.approve')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    const parsed = approveReviewBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await approveMonthlyAttendanceReview(client, {
        companyId,
        userId,
        employeeId: d.employeeId,
        periodMonth: d.periodMonth,
        periodYear: d.periodYear,
        notes: d.notes,
      });
      await insertAuditLog(client, {
        companyId,
        userId,
        action: 'ATTENDANCE_MONTHLY_REVIEW_APPROVED',
        entityType: 'monthly_attendance_review',
        entityId: (row as { id?: string }).id ?? null,
        details: { employeeId: d.employeeId, periodMonth: d.periodMonth, periodYear: d.periodYear, notes: d.notes ?? null },
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: row });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
