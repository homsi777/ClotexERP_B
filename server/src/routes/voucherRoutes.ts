import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {validateCustomerOrderVoucherLink} from '../services/customerOrderVoucherLink.js';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import {
  applyVoucherCancellation,
  applyVoucherConfirmation,
  loadVoucherConfirmationLines,
} from '../services/voucherCashboxService.js';
import {
  applyPurchaseInvoicePaymentOnVoucherConfirm,
  validatePurchaseInvoicePaymentVoucher,
} from '../services/purchaseInvoiceService.js';
import {
  applySaleInvoiceReceiptOnVoucherConfirm,
  validateSaleInvoiceReceiptVoucher,
} from '../services/salesInvoiceService.js';
import { getExchangeRateToUsdTx } from '../services/exchangeRateService.js';
import { createCheck } from '../services/checksService.js';
import {
  VOUCHER_PURPOSES,
  mergeVoucherDescription,
  type VoucherPurpose,
} from '../utils/voucherPurpose.js';
import { todayYmd } from '../utils/businessDate.js';

const partyTypeSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER']).optional().nullable();
const paymentMethodSchema = z.enum(['CASH', 'BANK', 'TRANSFER', 'OTHER']);
const purposeSchema = z.enum(VOUCHER_PURPOSES).default('INVOICE_PAYMENT');

/** بند تقسيم السند على أكثر من حساب/وسيلة — اختياري بالكامل. عند إرساله، يجب
 * أن يساوي مجموع مبالغه إجمالي السند (amount) تماماً، وإلا يُرفَض الحفظ. */
const voucherLineSchema = z.object({
  /** اختياري لبند الشيك الجديد: يُحدَّد خزينة الشيكات بعملة السند تلقائياً (تُنشأ إن لم توجد). */
  cashboxId: z.string().uuid().optional().nullable(),
  paymentMethod: z.enum(['CASH', 'BANK', 'WALLET', 'CHECK']).default('CASH'),
  amount: z.coerce.number().positive(),
  transactionRef: z.string().optional().nullable(),
  transactionDate: z.string().optional().nullable(),
  attachmentImage: z.string().optional().nullable(),
  /** الدفع بشيك مستلَم سابقاً من خزينة الشيكات — سند دفع فقط. cashboxId يبقى
   * خزينة الشيكات (account_kind='CHECKS') كأي بند آخر؛ هذا الحقل يربط الشيك
   * الفعلي المُصروف به لتحديث حالته لاحقاً عند التأكيد. */
  checkId: z.string().uuid().optional().nullable(),
  /** شيك جديد يُستلَم داخل سند القبض (ملاحظة بشير): يُنشأ سجله عند التأكيد ويدخل خزينة الشيكات بحالة «مستلم». */
  checkDetails: z.object({
    checkNo: z.string().trim().min(1, 'رقم الشيك مطلوب').max(60),
    bankName: z.string().trim().min(1, 'اسم البنك مطلوب').max(120),
    accountHolderName: z.string().trim().max(120).optional().nullable(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ استحقاق الشيك غير صالح'),
    imageData: z.string().max(900_000, 'صورة الشيك كبيرة جداً').optional().nullable(),
  }).optional().nullable(),
});

const createBody = z.object({
  voucherType: z.enum(['RECEIPT', 'PAYMENT']),
  voucherDate: z.string().optional(),
  cashboxId: z.string().uuid().optional().nullable(),
  partyType: partyTypeSchema,
  partyId: z.string().uuid().optional().nullable(),
  partyName: z.string().min(1, 'اسم الجهة مطلوب'),
  amount: z.coerce.number().positive(),
  currencyCode: z.string().min(1).default('USD'),
  exchangeRateToUsd: z.coerce.number().optional(),
  /** false (مع عملة غير الدولار) = تسجيل بالعملة فقط بلا معادل دولار. الافتراضي true للتوافق. */
  convertToUsd: z.boolean().optional(),
  amountUsd: z.coerce.number().optional(),
  /** تحويل اختياري للعرض: مكافئ المبلغ بعملة أخرى بسعر محدد (لا يغيّر الأرصدة). */
  convertToCurrencyCode: z.string().trim().min(1).max(10).optional().nullable(),
  convertRate: z.coerce.number().positive().optional().nullable(),
  paymentMethod: paymentMethodSchema.default('CASH'),
  purpose: purposeSchema,
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  referenceDocumentType: z.string().optional().nullable(),
  referenceDocumentNo: z.string().optional().nullable(),
  lines: z.array(voucherLineSchema).optional(),
});

const updateBody = createBody;
const LINE_SUM_EPS = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function conversionOf(d: { amount: number; currencyCode?: string; convertToCurrencyCode?: string | null; convertRate?: number | null }) {
  const code = d.convertToCurrencyCode?.trim().toUpperCase() || null;
  const rate = d.convertRate ?? null;
  if (!code || !rate || code === (d.currencyCode ?? '').toUpperCase()) return { code: null, rate: null, amount: null };
  return { code, rate, amount: round2(d.amount * rate) };
}

/** يحدد سعر الصرف وهل يُحوَّل للدولار: بلا تحويل = تسجيل بالعملة فقط ولا يُفترض سعر 1. */
async function resolveVoucherRate(
  client: import('pg').PoolClient,
  companyId: string,
  currencyCode: string,
  d: { exchangeRateToUsd?: number; convertToUsd?: boolean },
): Promise<{ rate: number; usdConverted: boolean }> {
  if (currencyCode !== 'USD' && d.convertToUsd === false) return { rate: 1, usdConverted: false };
  let rate = d.exchangeRateToUsd != null ? Number(d.exchangeRateToUsd) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) {
    if (currencyCode === 'USD') rate = 1;
    else rate = (await getExchangeRateToUsdTx(client, companyId, currencyCode)) ?? NaN;
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw Object.assign(new Error('لا يمكن تنفيذ العملية بدون سعر صرف'), { code: 'VALIDATION' });
  }
  return { rate: currencyCode === 'USD' ? 1 : rate, usdConverted: true };
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

type ParsedVoucherLine = z.infer<typeof voucherLineSchema>;

/**
 * خزينة الشيكات (أوراق القبض / «شيكات تحت التحصيل» محاسبياً) بعملة معينة: تُستعمل إن وُجدت وإلا تُنشأ تلقائياً
 * برصيد افتتاحي صفر، فلا يتوقف استلام الشيك على إعداد يدوي مسبق. الربط المحاسبي بحسب نوع الحساب لا بكل صندوق.
 */
async function ensureChecksCashbox(
  client: import('pg').PoolClient,
  companyId: string,
  currencyCode: string,
  userId: string | null,
): Promise<string> {
  const currency = String(currencyCode || 'USD').trim().toUpperCase();
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM cashboxes WHERE company_id=$1 AND account_kind='CHECKS' AND currency_code=$2 AND is_active
      ORDER BY created_at ASC LIMIT 1`,
    [companyId, currency],
  );
  if (existing.rows.length) return existing.rows[0].id;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:checks_cashbox:${currency}`]);
  const again = await client.query<{ id: string }>(
    `SELECT id FROM cashboxes WHERE company_id=$1 AND account_kind='CHECKS' AND currency_code=$2 AND is_active
      ORDER BY created_at ASC LIMIT 1`,
    [companyId, currency],
  );
  if (again.rows.length) return again.rows[0].id;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = attempt === 0 ? `CHK-${currency}` : `CHK-${currency}-${attempt + 1}`;
    try {
      await client.query('SAVEPOINT ensure_checks_cashbox');
      const ins = await client.query<{ id: string }>(
        `INSERT INTO cashboxes (company_id, code, name, currency_code, opening_balance, current_balance,
                                is_default, is_active, notes, created_by_user_id, account_kind)
         VALUES ($1,$2,$3,$4,0,0,false,true,$5,$6,'CHECKS') RETURNING id`,
        [companyId, code, `خزينة الشيكات (${currency})`, currency, 'أُنشئت تلقائياً عند أول استلام شيك بسند قبض', userId],
      );
      await client.query('RELEASE SAVEPOINT ensure_checks_cashbox');
      return ins.rows[0].id;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT ensure_checks_cashbox');
      if ((err as { code?: string }).code !== '23505') throw err;
    }
  }
  throw Object.assign(new Error('تعذّر إنشاء خزينة الشيكات تلقائياً'), { code: 'VALIDATION' });
}

/** يستبدل بنود السند بالكامل (حذف ثم إعادة إدخال) — نمط نماذج البنود الفرعية
 * الموجود أصلاً بالمشروع (سطور الفاتورة مثلاً)، بسيط وآمن لعدد بنود صغير كهذا. */
async function replaceVoucherLines(
  client: import('pg').PoolClient,
  companyId: string,
  voucherId: string,
  lines: ParsedVoucherLine[],
  headerCurrencyCode: string,
  headerExchangeRateToUsd: number,
  voucherType: 'RECEIPT' | 'PAYMENT',
  userId: string | null = null,
  usdConverted = true,
): Promise<void> {
  await client.query(`DELETE FROM voucher_lines WHERE company_id=$1 AND voucher_id=$2`, [companyId, voucherId]);
  let sortOrder = 0;
  const seenNewChecks = new Set<string>();
  for (const line of lines) {
    const amountUsd = usdConverted ? computeUsd(line.amount, headerExchangeRateToUsd) : 0;

    let lineCashboxId = line.cashboxId ?? null;
    if (!lineCashboxId) {
      if (!line.checkDetails || voucherType !== 'RECEIPT') {
        throw Object.assign(new Error('الصندوق مطلوب لكل بند'), { code: 'VALIDATION' });
      }
      lineCashboxId = await ensureChecksCashbox(client, companyId, headerCurrencyCode, userId);
    }

    if (line.checkDetails) {
      if (voucherType !== 'RECEIPT') {
        throw Object.assign(new Error('إدخال شيك جديد يتم في سند القبض فقط؛ سند الدفع يدفع بشيك مستلَم من خزينة الشيكات'), { code: 'VALIDATION' });
      }
      if (line.checkId) {
        throw Object.assign(new Error('لا يمكن الجمع بين شيك جديد وشيك موجود في البند نفسه'), { code: 'VALIDATION' });
      }
      const box = await client.query<{ account_kind: string }>(`SELECT account_kind FROM cashboxes WHERE id=$1 AND company_id=$2`, [lineCashboxId, companyId]);
      if (!box.rows.length || box.rows[0].account_kind !== 'CHECKS') {
        throw Object.assign(new Error('الشيك يُستلَم على خزينة الشيكات فقط'), { code: 'VALIDATION' });
      }
      const dupKey = `${line.checkDetails.checkNo.toLowerCase()}|${line.checkDetails.bankName.toLowerCase()}`;
      if (seenNewChecks.has(dupKey)) {
        throw Object.assign(new Error(`الشيك ${line.checkDetails.checkNo} مكرر في السند`), { code: 'VALIDATION' });
      }
      seenNewChecks.add(dupKey);
      const dup = await client.query(
        `SELECT 1 FROM checks WHERE company_id=$1 AND check_no=$2 AND bank_name=$3 LIMIT 1`,
        [companyId, line.checkDetails.checkNo, line.checkDetails.bankName],
      );
      if (dup.rows.length) {
        throw Object.assign(new Error(`يوجد شيك بنفس الرقم والبنك مسبقاً (${line.checkDetails.checkNo})`), { code: 'VALIDATION' });
      }
    } else if (voucherType === 'RECEIPT' && line.paymentMethod === 'CHECK') {
      throw Object.assign(new Error('بيانات الشيك مطلوبة (الرقم والبنك وتاريخ الاستحقاق)'), { code: 'VALIDATION' });
    }

    if (line.checkId) {
      const checkRow = await client.query<{ id: string; status: string; amount: string; used_in_voucher_line_id: string | null }>(
        `SELECT id, status, amount, used_in_voucher_line_id FROM checks WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [line.checkId, companyId],
      );
      if (!checkRow.rows.length) {
        throw Object.assign(new Error('الشيك المحدَّد غير موجود'), { code: 'VALIDATION' });
      }
      const check = checkRow.rows[0];
      if (check.status !== 'RECEIVED') {
        throw Object.assign(new Error('لا يمكن الدفع إلا بشيك بحالة «مستلم وغير محصّل»'), { code: 'VALIDATION' });
      }
      if (check.used_in_voucher_line_id) {
        throw Object.assign(new Error('هذا الشيك مُستخدَم بالفعل بسند دفع آخر'), { code: 'VALIDATION' });
      }
      if (Math.abs(Number(check.amount) - line.amount) > LINE_SUM_EPS) {
        throw Object.assign(new Error('مبلغ البند يجب أن يساوي قيمة الشيك بالضبط'), { code: 'VALIDATION' });
      }
    }

    await client.query(
      `INSERT INTO voucher_lines (
         company_id, voucher_id, cashbox_id, payment_method, amount, currency_code,
         exchange_rate_to_usd, amount_usd, transaction_ref, transaction_date, attachment_image, check_id, sort_order, check_details
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        companyId,
        voucherId,
        lineCashboxId,
        line.paymentMethod,
        line.amount,
        headerCurrencyCode,
        headerExchangeRateToUsd,
        amountUsd,
        line.transactionRef?.trim() || null,
        line.transactionDate || null,
        line.attachmentImage || null,
        line.checkId ?? null,
        sortOrder++,
        line.checkDetails ? JSON.stringify(line.checkDetails) : null,
      ],
    );
  }
}

export const voucherRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const voucherType = q.type as string | undefined;
    const status = q.status as string | undefined;
    const cashboxId = q.cashboxId?.trim();
    const partyIdFilter = q.partyId?.trim();
    const partyType = q.partyType?.trim();
    const search = q.search?.trim() || '';
    const dateFrom = q.dateFrom?.trim();
    const dateTo = q.dateTo?.trim();
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['v.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (voucherType && ['RECEIPT', 'PAYMENT'].includes(voucherType)) {
      conditions.push(`v.voucher_type = $${p}`);
      params.push(voucherType);
      p++;
    }
    if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) {
      conditions.push(`v.status = $${p}`);
      params.push(status);
      p++;
    }
    if (cashboxId) {
      conditions.push(`v.cashbox_id = $${p}`);
      params.push(cashboxId);
      p++;
    }
    if (partyType && ['CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER'].includes(partyType)) {
      conditions.push(`v.party_type = $${p}`);
      params.push(partyType);
      p++;
    }
    if (partyIdFilter) {
      conditions.push(`v.party_id = $${p}::uuid`);
      params.push(partyIdFilter);
      p++;
    }
    const purposeFilter = q.purpose?.trim();
    if (purposeFilter && (VOUCHER_PURPOSES as readonly string[]).includes(purposeFilter)) {
      conditions.push(`v.purpose = $${p}`);
      params.push(purposeFilter);
      p++;
    }
    if (search) {
      conditions.push(`(v.voucher_no ILIKE $${p} OR v.party_name ILIKE $${p} OR COALESCE(v.description,'') ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (dateFrom) {
      conditions.push(`v.voucher_date >= $${p}::date`);
      params.push(dateFrom);
      p++;
    }
    if (dateTo) {
      conditions.push(`v.voucher_date <= $${p}::date`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.join(' AND ');
    const pool = getPool();

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.voucher_date, v.cashbox_id, v.party_type, v.party_id,
                v.party_name, v.amount, v.currency_code, v.payment_method, v.status,
                v.purpose, v.description,
                v.reference_document_type, v.reference_document_no,
                v.confirmed_at, v.cancelled_at, v.created_at,
                c.code AS cashbox_code, c.name AS cashbox_name
         FROM vouchers v
         LEFT JOIN cashboxes c ON c.id = v.cashbox_id AND c.company_id = v.company_id
         WHERE ${where}
         ORDER BY v.voucher_date DESC, v.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM vouchers v WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT v.*, c.code AS cashbox_code, c.name AS cashbox_name
       FROM vouchers v
       LEFT JOIN cashboxes c ON c.id = v.cashbox_id AND c.company_id = v.company_id
       WHERE v.id=$1 AND v.company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');

    const lines = await pool.query(
      `SELECT vl.id, vl.cashbox_id, c.name AS cashbox_name, c.account_kind, vl.payment_method, vl.amount,
              vl.currency_code, vl.transaction_ref, vl.transaction_date, vl.attachment_image, vl.sort_order,
              vl.check_id, chk.check_no, chk.bank_name AS check_bank_name, (vl.check_details - 'imageData') AS check_details
       FROM voucher_lines vl
       JOIN cashboxes c ON c.id = vl.cashbox_id AND c.company_id = vl.company_id
       LEFT JOIN checks chk ON chk.id = vl.check_id AND chk.company_id = vl.company_id
       WHERE vl.company_id=$1 AND vl.voucher_id=$2
       ORDER BY vl.sort_order ASC, vl.created_at ASC`,
      [companyId, id],
    );

    return reply.send({ ok: true, data: { ...row.rows[0], lines: lines.rows } });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    if (d.lines && d.lines.length > 0) {
      const linesSum = round2(d.lines.reduce((sum, l) => sum + l.amount, 0));
      if (Math.abs(linesSum - round2(d.amount)) > LINE_SUM_EPS) {
        return sendError(
          reply, 400,
          `مجموع بنود الدفع (${linesSum}) لا يساوي إجمالي السند (${round2(d.amount)})`,
          'VALIDATION',
        );
      }
    }

    const vd = d.voucherDate ? d.voucherDate : todayYmd();

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await validateCustomerOrderVoucherLink(client,companyId,d);
      const voucherNo = await generateSequentialDocumentNo(
        client,
        companyId,
        d.voucherType === 'RECEIPT' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER',
      );
      const currencyCode = String(d.currencyCode || 'USD').trim().toUpperCase();
      const { rate: exchangeRateToUsd, usdConverted } = await resolveVoucherRate(client, companyId, currencyCode, d);

      const amountUsd = usdConverted ? computeUsd(d.amount, exchangeRateToUsd) : 0;
      const purpose: VoucherPurpose = d.purpose ?? 'INVOICE_PAYMENT';
      const description = mergeVoucherDescription(purpose, d.description);
      const ins = await client.query(
        `INSERT INTO vouchers (
           company_id, voucher_no, voucher_type, voucher_date, cashbox_id, party_type, party_id, party_name,
           amount, currency_code, exchange_rate_to_usd, amount_usd,
           payment_method, status, purpose, description, notes,
           reference_document_type, reference_document_no,
           created_by_user_id, convert_to_currency_code, convert_rate, converted_amount, usd_converted
         ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING id, voucher_no, voucher_type, voucher_date, cashbox_id, party_type, party_id, party_name,
                   amount, currency_code, exchange_rate_to_usd, amount_usd, payment_method, status, purpose,
                   description, notes, reference_document_type, reference_document_no, created_at`,
        [
          companyId,
          voucherNo,
          d.voucherType,
          vd,
          d.cashboxId ?? null,
          d.partyType ?? null,
          d.partyId ?? null,
          d.partyName.trim(),
          d.amount,
          currencyCode,
          exchangeRateToUsd,
          amountUsd,
          d.paymentMethod,
          purpose,
          description,
          d.notes ?? null,
          d.referenceDocumentType?.trim() || null,
          d.referenceDocumentNo?.trim() || null,
          userId,
          ...(() => { const c = conversionOf({ amount: d.amount, currencyCode, convertToCurrencyCode: d.convertToCurrencyCode, convertRate: d.convertRate }); return [c.code, c.rate, c.amount]; })(),
          usdConverted,
        ],
      );

      if (d.lines && d.lines.length > 0) {
        await replaceVoucherLines(client, companyId, ins.rows[0].id, d.lines, currencyCode, exchangeRateToUsd, d.voucherType, userId, usdConverted);
      }

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: ins.rows[0] });
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

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    if (d.lines && d.lines.length > 0) {
      const linesSum = round2(d.lines.reduce((sum, l) => sum + l.amount, 0));
      if (Math.abs(linesSum - round2(d.amount)) > LINE_SUM_EPS) {
        return sendError(
          reply, 400,
          `مجموع بنود الدفع (${linesSum}) لا يساوي إجمالي السند (${round2(d.amount)})`,
          'VALIDATION',
        );
      }
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<{ status: string }>(
        `SELECT status FROM vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!cur.rows.length) return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
      if (cur.rows[0].status !== 'DRAFT') {
        return sendError(reply, 400, 'لا يمكن التعديل إلا في حالة مسودة', 'INVALID_STATE');
      }

      await validateCustomerOrderVoucherLink(client,companyId,d);
      const vd = d.voucherDate ? d.voucherDate : todayYmd();
      const currencyCode = String(d.currencyCode || 'USD').trim().toUpperCase();

      const { rate: exchangeRateToUsd, usdConverted } = await resolveVoucherRate(client, companyId, currencyCode, d);
      const amountUsd = usdConverted ? computeUsd(d.amount, exchangeRateToUsd) : 0;
      const purpose: VoucherPurpose = d.purpose ?? 'INVOICE_PAYMENT';
      const description = mergeVoucherDescription(purpose, d.description);

      const row = await client.query(
        `UPDATE vouchers SET
           voucher_type=$3, voucher_date=$4::date, cashbox_id=$5, party_type=$6, party_id=$7, party_name=$8,
           amount=$9, currency_code=$10, exchange_rate_to_usd=$11, amount_usd=$12,
           payment_method=$13, purpose=$14, description=$15, notes=$16,
           reference_document_type=$17, reference_document_no=$18,
           updated_at=now(), created_by_user_id=$19,
           convert_to_currency_code=$20, convert_rate=$21, converted_amount=$22, usd_converted=$23
         WHERE id=$1 AND company_id=$2
         RETURNING id, voucher_no, status, purpose, updated_at`,
        [
          id,
          companyId,
          d.voucherType,
          vd,
          d.cashboxId ?? null,
          d.partyType ?? null,
          d.partyId ?? null,
          d.partyName.trim(),
          d.amount,
          currencyCode,
          exchangeRateToUsd,
          amountUsd,
          d.paymentMethod,
          purpose,
          description,
          d.notes ?? null,
          d.referenceDocumentType?.trim() || null,
          d.referenceDocumentNo?.trim() || null,
          userId,
          ...(() => { const c = conversionOf({ amount: d.amount, currencyCode, convertToCurrencyCode: d.convertToCurrencyCode, convertRate: d.convertRate }); return [c.code, c.rate, c.amount]; })(),
          usdConverted,
        ],
      );

      // استبدال كامل للبنود دائماً عند التعديل (حتى لو أُرسلت فارغة — يعني
      // رجوعاً لسند أحادي الخزينة) — السند لا يزال DRAFT هنا فقط، لا أثر مالي بعد.
      await replaceVoucherLines(client, companyId, id, d.lines ?? [], currencyCode, exchangeRateToUsd, d.voucherType, userId, usdConverted);

      await client.query('COMMIT');
      return reply.send({ ok: true, data: row.rows[0] });
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

  // Financial confirm: lock voucher (DRAFT), cashbox + GL + invoice paid/remaining in one transaction.
  app.patch('/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return sendError(reply, 400, 'معرّف السند غير صالح', 'VALIDATION');
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const v = await client.query(
        `SELECT * FROM vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!v.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
      }
      const row = v.rows[0];
      if (row.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا يمكن التأكيد في هذه الحالة', 'INVALID_STATE');
      }

      await validateCustomerOrderVoucherLink(client,companyId,{referenceDocumentType:row.reference_document_type,referenceDocumentNo:row.reference_document_no,voucherType:row.voucher_type,partyType:row.party_type,partyId:row.party_id});
      const confirmationLines = await loadVoucherConfirmationLines(client, companyId, id);
      if (!row.cashbox_id && confirmationLines.length === 0) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'يجب اختيار صندوق أو إضافة بند دفع واحد على الأقل قبل التأكيد', 'VALIDATION');
      }

      // سياسة العملات: عملة وسعر صرف السند نفسه — تُستخدَم لتحويل مبلغه لعملة
      // الفاتورة المرجعية قبل أي مقارنة/خصم (voucherRoutes.ts لا يفترض تطابق
      // العملتين إطلاقاً بعد الآن).
      const voucherCurrencyCode = String(row.currency_code || 'USD').trim().toUpperCase();
      const voucherExchangeRateToUsd =
        Number(row.exchange_rate_to_usd ?? 1) > 0 ? Number(row.exchange_rate_to_usd ?? 1) : 1;

      await validateSaleInvoiceReceiptVoucher(client, companyId, {
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
        currencyCode: voucherCurrencyCode,
        exchangeRateToUsd: voucherExchangeRateToUsd,
        usdConverted: row.usd_converted !== false,
      });
      await validatePurchaseInvoicePaymentVoucher(client, companyId, {
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
        currencyCode: voucherCurrencyCode,
        exchangeRateToUsd: voucherExchangeRateToUsd,
        usdConverted: row.usd_converted !== false,
      });

      await applyVoucherConfirmation(client, {
        companyId,
        voucherId: id,
        voucherNo: row.voucher_no,
        voucherDate:
          row.voucher_date instanceof Date
            ? row.voucher_date.toISOString().slice(0, 10)
            : String(row.voucher_date).slice(0, 10),
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        currencyCode: String(row.currency_code || 'USD').trim().toUpperCase(),
        exchangeRateToUsd: Number(row.exchange_rate_to_usd ?? 1) > 0 ? Number(row.exchange_rate_to_usd ?? 1) : 1,
        amountUsd: row.usd_converted === false ? 0 : Number(row.amount_usd ?? 0) || computeUsd(Number(row.amount), Number(row.exchange_rate_to_usd ?? 1) || 1),
        usdConverted: row.usd_converted !== false,
        cashboxId: row.cashbox_id,
        partyType: row.party_type,
        partyId: row.party_id,
        partyName: row.party_name,
        description: row.description,
        userId,
        lines: confirmationLines,
      });

      // دفع بشيك مستلَم سابقاً — علامة "مصروف" فقط عند تأكيد سند الدفع فعلياً،
      // لا عند إضافته كبند بمسودة (قد تُحذف/تُعدَّل قبل التأكيد). إعادة التحقق
      // من حالة "مستلم" هنا (لا الاكتفاء بفحص وقت الإضافة) تمنع استخدام نفس
      // الشيك مرتين لو مرّ وقت بين إنشاء السند ومحاولات تأكيد متزامنة.
      for (const line of confirmationLines) {
        if (!line.checkId || !line.lineId) continue;
        const marked = await client.query(
          `UPDATE checks SET status='PAID_OUT', used_in_voucher_line_id=$3, updated_at=now()
           WHERE id=$1 AND company_id=$2 AND status='RECEIVED'
           RETURNING id`,
          [line.checkId, companyId, line.lineId],
        );
        if (!marked.rows.length) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'أحد الشيكات المُختارة لم يعد متاحاً للدفع به', 'VALIDATION');
        }
        await client.query(
          `INSERT INTO check_status_history (check_id, from_status, to_status, note, changed_by_user_id)
           VALUES ($1,'RECEIVED','PAID_OUT',$2,$3)`,
          [line.checkId, `سند دفع ${row.voucher_no}`, userId],
        );
      }

      // استلام شيكات جديدة بسند القبض: يُنشأ سجل كل شيك بحالة «مستلم» عند التأكيد فقط، ويُربَط بالبند.
      if (row.voucher_type === 'RECEIPT') {
        const pendingChecks = await client.query<{ id: string; amount: string; check_details: {
          checkNo: string; bankName: string; accountHolderName?: string | null; dueDate: string; imageData?: string | null;
        } }>(
          `SELECT id, amount, check_details FROM voucher_lines
            WHERE company_id=$1 AND voucher_id=$2 AND check_details IS NOT NULL AND check_id IS NULL
            ORDER BY sort_order ASC`,
          [companyId, id],
        );
        for (const pl of pendingChecks.rows) {
          const cd = pl.check_details;
          const created = await createCheck(client, {
            companyId,
            userId,
            checkNo: cd.checkNo,
            bankName: cd.bankName,
            accountHolderName: cd.accountHolderName ?? null,
            partyType: row.party_type === 'CUSTOMER' || row.party_type === 'SUPPLIER' ? row.party_type : 'OTHER',
            partyId: row.party_id ?? null,
            partyName: row.party_name,
            amount: Number(pl.amount),
            currencyCode: voucherCurrencyCode,
            receivedDate:
              row.voucher_date instanceof Date ? row.voucher_date.toISOString().slice(0, 10) : String(row.voucher_date).slice(0, 10),
            dueDate: cd.dueDate,
            imageData: cd.imageData ?? null,
            sourceVoucherLineId: pl.id,
          });
          await client.query(`UPDATE voucher_lines SET check_id=$2 WHERE id=$1`, [pl.id, created.id]);
        }
      }

      await client.query(
        `UPDATE vouchers SET status='CONFIRMED', confirmed_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      await applySaleInvoiceReceiptOnVoucherConfirm(client, companyId, userId, {
        voucherId: id,
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
        currencyCode: voucherCurrencyCode,
        exchangeRateToUsd: voucherExchangeRateToUsd,
        usdConverted: row.usd_converted !== false,
      });
      await applyPurchaseInvoicePaymentOnVoucherConfirm(client, companyId, userId, {
        voucherId: id,
        voucherType: row.voucher_type,
        amount: Number(row.amount),
        referenceDocumentType: row.reference_document_type,
        referenceDocumentNo: row.reference_document_no,
        partyType: row.party_type,
        partyId: row.party_id,
        currencyCode: voucherCurrencyCode,
        exchangeRateToUsd: voucherExchangeRateToUsd,
        usdConverted: row.usd_converted !== false,
      });

      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: 'CONFIRMED' } });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'GL_UNBALANCED') return sendError(reply, 400, err.message || 'قيد محاسبي غير متوازن', 'GL_UNBALANCED');
      if (err?.code === '22P02') return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
      if (err?.code === '23503') return sendError(reply, 400, err.message || 'مرجع غير صالح', 'VALIDATION');
      if (err?.code === '23505') return sendError(reply, 409, err.message || 'تعارض في البيانات', 'CONFLICT');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.patch('/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return sendError(reply, 400, 'معرّف السند غير صالح', 'VALIDATION');
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const v = await client.query(
        `SELECT * FROM vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!v.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'السند غير موجود', 'NOT_FOUND');
      }
      const row = v.rows[0];
      if (row.status === 'CANCELLED') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'السند ملغى مسبقاً', 'INVALID_STATE');
      }

      // شيكات استُلمت بهذا السند: لا إلغاء إن تحرّك أحدها (أُودع/حُصّل/صُرف)، وإلا تُعلَّم «مرتجع» مع الإلغاء.
      let receivedChecks: { id: string; status: string; check_no: string }[] = [];
      if (row.status === 'CONFIRMED' && row.voucher_type === 'RECEIPT') {
        const made = await client.query<{ id: string; status: string; check_no: string }>(
          `SELECT c.id, c.status, c.check_no
             FROM checks c JOIN voucher_lines vl ON vl.id = c.source_voucher_line_id
            WHERE vl.company_id=$1 AND vl.voucher_id=$2 FOR UPDATE OF c`,
          [companyId, id],
        );
        receivedChecks = made.rows;
        const moved = made.rows.find((c) => c.status !== 'RECEIVED');
        if (moved) {
          await client.query('ROLLBACK');
          return sendError(
            reply, 400,
            `لا يمكن إلغاء السند: الشيك ${moved.check_no} لم يعد «مستلماً» (أُودع أو حُصّل أو صُرف) — عالجه من خزينة الشيكات أولاً`,
            'INVALID_STATE',
          );
        }
      }

      const cancellationLines = await loadVoucherConfirmationLines(client, companyId, id);
      if (row.status === 'CONFIRMED' && (row.cashbox_id || cancellationLines.length > 0)) {
        await applyVoucherCancellation(client, {
          companyId,
          voucherId: id,
          voucherNo: row.voucher_no,
          voucherType: row.voucher_type,
          amount: Number(row.amount),
          currencyCode: String(row.currency_code || 'USD').trim().toUpperCase(),
          exchangeRateToUsd: Number(row.exchange_rate_to_usd ?? 1) > 0 ? Number(row.exchange_rate_to_usd ?? 1) : 1,
          amountUsd: row.usd_converted === false ? 0 : Number(row.amount_usd ?? 0) || computeUsd(Number(row.amount), Number(row.exchange_rate_to_usd ?? 1) || 1),
          cashboxId: row.cashbox_id,
          userId,
          lines: cancellationLines,
        });

        for (const line of cancellationLines) {
          // إعادة الشيك «مستلم» تخص سند الدفع فقط؛ شيكات سند القبض تُعالَج أدناه (receivedChecks).
          if (!line.checkId || row.voucher_type !== 'PAYMENT') continue;
          const restored = await client.query(
            `UPDATE checks SET status='RECEIVED', used_in_voucher_line_id=NULL, updated_at=now()
             WHERE id=$1 AND company_id=$2 AND status='PAID_OUT' RETURNING id`,
            [line.checkId, companyId],
          );
          if (!restored.rows.length) continue;
          await client.query(
            `INSERT INTO check_status_history (check_id, from_status, to_status, note, changed_by_user_id)
             VALUES ($1,'PAID_OUT','RECEIVED',$2,$3)`,
            [line.checkId, `إلغاء سند دفع ${row.voucher_no}`, userId],
          );
        }
      }

      for (const c of receivedChecks) {
        await client.query(`UPDATE checks SET status='RETURNED', updated_at=now() WHERE id=$1 AND company_id=$2 AND status='RECEIVED'`, [c.id, companyId]);
        await client.query(
          `INSERT INTO check_status_history (check_id, from_status, to_status, note, changed_by_user_id)
           VALUES ($1,'RECEIVED','RETURNED',$2,$3)`,
          [c.id, `إلغاء سند قبض ${row.voucher_no}`, userId],
        );
      }

      await client.query(
        `UPDATE vouchers SET status='CANCELLED', cancelled_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
        [id, companyId],
      );

      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, status: 'CANCELLED' } });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'GL_UNBALANCED') return sendError(reply, 400, err.message || 'قيد محاسبي غير متوازن', 'GL_UNBALANCED');
      if (err?.code === '22P02') return sendError(reply, 400, 'معرّف غير صالح', 'VALIDATION');
      if (err?.code === '23503') return sendError(reply, 400, err.message || 'مرجع غير صالح', 'VALIDATION');
      if (err?.code === '23505') return sendError(reply, 409, err.message || 'تعارض في البيانات', 'CONFLICT');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
