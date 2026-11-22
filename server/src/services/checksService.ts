import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { todayYmd, daysUntilYmd } from '../utils/businessDate.js';
import { postCheckDepositToGl, postCheckReturnToGl } from './glPostingService.js';

type ServiceErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'INVALID_STATE' | 'CONFLICT';

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CheckStatus = 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'PAID_OUT';

export type CheckRow = {
  id: string;
  check_no: string;
  bank_name: string;
  account_holder_name: string | null;
  party_type: string | null;
  party_id: string | null;
  party_name: string | null;
  amount: string;
  currency_code: string;
  received_date: string;
  due_date: string;
  image_data: string | null;
  /** للقوائم: وجود صورة دون إرسالها (تُجلب عند الطلب). */
  has_image?: boolean;
  /** سند القبض الذي استُلم به الشيك (إن كان بسند). */
  voucher_no?: string | null;
  voucher_id?: string | null;
  status: CheckStatus;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
};

const CHECK_SELECT = `
  SELECT id, check_no, bank_name, account_holder_name, party_type, party_id, party_name,
         amount, currency_code, received_date, due_date, NULL::text AS image_data, (image_data IS NOT NULL) AS has_image,
         (SELECT v.voucher_no FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id WHERE vl.id = checks.source_voucher_line_id) AS voucher_no,
         (SELECT v.id FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id WHERE vl.id = checks.source_voucher_line_id) AS voucher_id,
         status, needs_review,
         created_at, updated_at
  FROM checks
`;

export async function insertStatusHistory(
  client: PoolClient,
  input: { checkId: string; fromStatus: string | null; toStatus: string; note?: string | null; userId: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO check_status_history (check_id, from_status, to_status, note, changed_by_user_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.checkId, input.fromStatus, input.toStatus, input.note ?? null, input.userId],
  );
}

export type CreateCheckInput = {
  companyId: string;
  userId: string | null;
  checkNo: string;
  bankName: string;
  accountHolderName?: string | null;
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'OTHER' | null;
  partyId?: string | null;
  partyName?: string | null;
  amount: number;
  currencyCode?: string;
  receivedDate?: string;
  dueDate: string;
  imageData?: string | null;
  sourceVoucherLineId?: string | null;
  needsReview?: boolean;
};

/** إنشاء شيك جديد بحالة "مستلم" — يُستدعى إما يدوياً أو من ضمن معاملة سند
 * القبض عند اختيار شيك كوسيلة (voucher_lines.check_id يُربَط لاحقاً من المستدعي). */
export async function createCheck(client: PoolClient, input: CreateCheckInput): Promise<CheckRow> {
  if (!input.checkNo.trim()) fail('رقم الشيك مطلوب', 'VALIDATION');
  if (!input.bankName.trim()) fail('اسم البنك مطلوب', 'VALIDATION');
  if (!(input.amount > 0)) fail('مبلغ الشيك يجب أن يكون أكبر من صفر', 'VALIDATION');
  if (!input.dueDate) fail('تاريخ استحقاق الشيك مطلوب', 'VALIDATION');

  const row = await client.query<CheckRow>(
    `INSERT INTO checks (
       company_id, check_no, bank_name, account_holder_name, party_type, party_id, party_name,
       amount, currency_code, received_date, due_date, image_data, status,
       source_voucher_line_id, needs_review, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,current_date),$11,$12,'RECEIVED',$13,$14,$15)
     RETURNING id, check_no, bank_name, account_holder_name, party_type, party_id, party_name,
               amount, currency_code, received_date, due_date, image_data, status, needs_review,
               created_at, updated_at`,
    [
      input.companyId,
      input.checkNo.trim(),
      input.bankName.trim(),
      input.accountHolderName?.trim() || null,
      input.partyType ?? null,
      input.partyId ?? null,
      input.partyName?.trim() || null,
      input.amount,
      String(input.currencyCode || 'USD').trim().toUpperCase(),
      input.receivedDate ?? null,
      input.dueDate,
      input.imageData ?? null,
      input.sourceVoucherLineId ?? null,
      input.needsReview ?? false,
      input.userId,
    ],
  );
  const check = row.rows[0];
  await insertStatusHistory(client, { checkId: check.id, fromStatus: null, toStatus: 'RECEIVED', userId: input.userId });
  if (input.imageData) {
    // الصورة الأولى تُحفظ أيضاً كأصل في check_images كي يمكن تعديلها لاحقاً دون فقدان الأصل.
    await client.query(
      `INSERT INTO check_images (company_id, check_id, side, sort_order, original_data, created_by_user_id) VALUES ($1,$2,'FRONT',0,$3,$4)`,
      [input.companyId, check.id, input.imageData, input.userId],
    );
  }
  return check;
}

export async function listChecks(
  companyId: string,
  filters: {
    status?: CheckStatus;
    search?: string;
    dueFrom?: string;
    dueTo?: string;
    sortBy?: 'dueDate' | 'amountDesc' | 'amountAsc' | 'receivedDesc' | 'receivedAsc';
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ rows: CheckRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize || 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (filters.status) {
    conditions.push(`status = $${p}`);
    params.push(filters.status);
    p++;
  }
  if (filters.search) {
    conditions.push(`(check_no ILIKE $${p} OR bank_name ILIKE $${p} OR COALESCE(party_name,'') ILIKE $${p} OR COALESCE(account_holder_name,'') ILIKE $${p})`);
    params.push(`%${filters.search}%`);
    p++;
  }
  if (filters.dueFrom) {
    conditions.push(`due_date >= $${p}::date`);
    params.push(filters.dueFrom);
    p++;
  }
  if (filters.dueTo) {
    conditions.push(`due_date <= $${p}::date`);
    params.push(filters.dueTo);
    p++;
  }

  const where = conditions.join(' AND ');
  let orderBy = 'due_date ASC, created_at ASC';
  if (filters.sortBy === 'amountDesc') orderBy = 'amount DESC';
  else if (filters.sortBy === 'amountAsc') orderBy = 'amount ASC';
  else if (filters.sortBy === 'receivedDesc') orderBy = 'received_date DESC, created_at DESC';
  else if (filters.sortBy === 'receivedAsc') orderBy = 'received_date ASC, created_at ASC';

  const pool = getPool();
  const [rows, countRow] = await Promise.all([
    pool.query<CheckRow>(`${CHECK_SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT $${p} OFFSET $${p + 1}`, [...params, pageSize, offset]),
    pool.query<{ c: string }>(`SELECT COUNT(*)::int AS c FROM checks WHERE ${where}`, params),
  ]);

  return { rows: rows.rows, total: Number(countRow.rows[0]?.c ?? 0), page, pageSize };
}

async function lockCheck(client: PoolClient, companyId: string, checkId: string): Promise<CheckRow> {
  const row = await client.query<CheckRow>(`${CHECK_SELECT} WHERE id=$1 AND company_id=$2 FOR UPDATE`, [checkId, companyId]);
  if (!row.rows.length) fail('الشيك غير موجود', 'NOT_FOUND');
  return row.rows[0];
}

/** إيداع شيك بالبنك — نقل رصيد من خزينة الشيكات لحساب البنك المودَع به +
 * ترحيل محاسبي مطابق (ليس قبضاً جديداً). */
export async function depositCheck(
  client: PoolClient,
  input: { companyId: string; checkId: string; bankCashboxId: string; depositDate?: string; userId: string | null },
): Promise<CheckRow> {
  const check = await lockCheck(client, input.companyId, input.checkId);
  if (check.status !== 'RECEIVED') fail('لا يمكن إيداع شيك إلا بحالة «مستلم»', 'INVALID_STATE');

  const checksBox = await client.query<{ id: string; account_kind: string; current_balance: string; currency_code: string }>(
    `SELECT id, account_kind, current_balance, currency_code FROM cashboxes WHERE company_id=$1 AND account_kind='CHECKS' ORDER BY (currency_code = $2) DESC, created_at ASC LIMIT 1 FOR UPDATE`,
    [input.companyId, check.currency_code],
  );
  if (!checksBox.rows.length) fail('لا توجد خزينة شيكات مُعرَّفة بعد — أنشئيها أولاً من شاشة الصناديق', 'VALIDATION');
  const bankBox = await client.query<{ id: string; account_kind: string; current_balance: string; currency_code: string }>(
    `SELECT id, account_kind, current_balance, currency_code FROM cashboxes WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [input.bankCashboxId, input.companyId],
  );
  if (!bankBox.rows.length) fail('الحساب البنكي المحدَّد غير موجود', 'NOT_FOUND');
  if (String(bankBox.rows[0].currency_code).trim().toUpperCase() !== String(check.currency_code).trim().toUpperCase()) {
    fail('عملة الشيك يجب أن تطابق عملة الحساب البنكي المودَع به', 'VALIDATION');
  }

  const amount = Number(check.amount);
  const checksBoxId = checksBox.rows[0].id;
  const bankBoxId = bankBox.rows[0].id;
  const checksNext = round2(Number(checksBox.rows[0].current_balance) - amount);
  const bankNext = round2(Number(bankBox.rows[0].current_balance) + amount);
  const depositDate = input.depositDate ?? todayYmd();

  await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [checksBoxId, input.companyId, checksNext]);
  await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [bankBoxId, input.companyId, bankNext]);

  const movNo = generateDocumentNo('MOV');
  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount, currency_code,
       balance_after, source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'TRANSFER_OUT','OUT',$4,$5,$6,'CHECK_DEPOSIT',$7,$8,$9,$10)`,
    [input.companyId, checksBoxId, movNo, amount, check.currency_code, checksNext, check.id, check.check_no, `إيداع شيك ${check.check_no}`, input.userId],
  );
  const movNo2 = generateDocumentNo('MOV');
  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount, currency_code,
       balance_after, source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'TRANSFER_IN','IN',$4,$5,$6,'CHECK_DEPOSIT',$7,$8,$9,$10)`,
    [input.companyId, bankBoxId, movNo2, amount, check.currency_code, bankNext, check.id, check.check_no, `إيداع شيك ${check.check_no}`, input.userId],
  );

  await postCheckDepositToGl(client, {
    companyId: input.companyId,
    checkId: check.id,
    checkNo: check.check_no,
    depositDate,
    amountUsd: amount,
    bankCashboxId: bankBoxId,
    userId: input.userId,
  });

  const updated = await client.query<CheckRow>(
    `UPDATE checks SET status='DEPOSITED', deposited_to_cashbox_id=$3, updated_at=now() WHERE id=$1 AND company_id=$2
     RETURNING id, check_no, bank_name, account_holder_name, party_type, party_id, party_name,
               amount, currency_code, received_date, due_date, image_data, status, needs_review, created_at, updated_at`,
    [check.id, input.companyId, bankBoxId],
  );
  await insertStatusHistory(client, { checkId: check.id, fromStatus: 'RECEIVED', toStatus: 'DEPOSITED', userId: input.userId });
  return updated.rows[0];
}

/** تحصيل نهائي بعد الإيداع — إقرار حالة فقط، لا قيد جديد (التحصيل الفعلي
 * بالحساب البنكي الحقيقي تم تسجيله أصلاً عند الإيداع). */
export async function markCheckCleared(
  client: PoolClient,
  input: { companyId: string; checkId: string; userId: string | null },
): Promise<CheckRow> {
  const check = await lockCheck(client, input.companyId, input.checkId);
  // شيك مودَع بالبنك، أو شيك مُعطى لمورد (PAID_OUT) يقرر المحاسب إقفاله بعد أن اندفع.
  if (check.status !== 'DEPOSITED' && check.status !== 'PAID_OUT') fail('لا يمكن تأكيد التحصيل إلا لشيك مودَع أو مدفوع به', 'INVALID_STATE');

  const updated = await client.query<CheckRow>(
    `UPDATE checks SET status='CLEARED', updated_at=now() WHERE id=$1 AND company_id=$2
     RETURNING id, check_no, bank_name, account_holder_name, party_type, party_id, party_name,
               amount, currency_code, received_date, due_date, image_data, status, needs_review, created_at, updated_at`,
    [check.id, input.companyId],
  );
  await insertStatusHistory(client, {
    checkId: check.id, fromStatus: check.status, toStatus: 'CLEARED',
    note: check.status === 'PAID_OUT' ? 'إقفال: اندفع الشيك المُعطى للمستفيد' : null, userId: input.userId,
  });
  return updated.rows[0];
}

/** ارتجاع شيك — من حالة مستلم أو مودَع فقط (لا بعد التحصيل النهائي) — يعيد
 * أثره على ذمة العميل ويُخرجه من خزينة الشيكات/الحساب البنكي حسب حالته الحالية. */
export async function returnCheck(
  client: PoolClient,
  input: { companyId: string; checkId: string; note?: string | null; returnDate?: string; userId: string | null },
): Promise<CheckRow> {
  const check = await lockCheck(client, input.companyId, input.checkId);
  if (check.status === 'PAID_OUT') {
    // شيك مُعطى لمورد وارتدّ: يُقفل كمرتجع ويُعلَّم للمراجعة. لا قيد آلي هنا؛ المحاسب يسوّي ذمة المورد/العميل يدوياً.
    const closed = await client.query<CheckRow>(
      `UPDATE checks SET status='RETURNED', needs_review=true, updated_at=now() WHERE id=$1 AND company_id=$2
       RETURNING id, check_no, bank_name, account_holder_name, party_type, party_id, party_name,
                 amount, currency_code, received_date, due_date, image_data, status, needs_review, created_at, updated_at`,
      [check.id, input.companyId],
    );
    await insertStatusHistory(client, { checkId: check.id, fromStatus: 'PAID_OUT', toStatus: 'RETURNED', note: input.note ?? 'إقفال: ارتدّ الشيك المُعطى للمستفيد', userId: input.userId });
    return closed.rows[0];
  }
  if (check.status !== 'RECEIVED' && check.status !== 'DEPOSITED') {
    fail('لا يمكن ارتجاع شيك بهذه الحالة', 'INVALID_STATE');
  }
  const amount = Number(check.amount);
  const returnDate = input.returnDate ?? todayYmd();

  // إخراج المبلغ من الحساب الذي يحمله حالياً (خزينة الشيكات إن لم يُودَع بعد،
  // أو الحساب البنكي المودَع به إن كان قد أُودع فعلاً).
  let fromCashboxId: string;
  if (check.status === 'DEPOSITED') {
    const depositedRow = await client.query<{ deposited_to_cashbox_id: string | null }>(
      `SELECT deposited_to_cashbox_id FROM checks WHERE id=$1 AND company_id=$2`,
      [check.id, input.companyId],
    );
    fromCashboxId = depositedRow.rows[0]?.deposited_to_cashbox_id ?? '';
    if (!fromCashboxId) fail('تعذّر تحديد الحساب الذي أُودع به الشيك', 'VALIDATION');
  } else {
    const checksBox = await client.query<{ id: string }>(
      `SELECT id FROM cashboxes WHERE company_id=$1 AND account_kind='CHECKS' ORDER BY (currency_code = $2) DESC, created_at ASC LIMIT 1`,
      [input.companyId, check.currency_code],
    );
    if (!checksBox.rows.length) fail('لا توجد خزينة شيكات مُعرَّفة', 'VALIDATION');
    fromCashboxId = checksBox.rows[0].id;
  }

  const box = await client.query<{ current_balance: string }>(
    `SELECT current_balance FROM cashboxes WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [fromCashboxId, input.companyId],
  );
  const next = round2(Number(box.rows[0].current_balance) - amount);
  await client.query(`UPDATE cashboxes SET current_balance=$3, updated_at=now() WHERE id=$1 AND company_id=$2`, [fromCashboxId, input.companyId, next]);

  const movNo = generateDocumentNo('MOV');
  await client.query(
    `INSERT INTO cashbox_movements (
       company_id, cashbox_id, movement_no, movement_type, direction, amount, currency_code,
       balance_after, source_type, source_id, source_no, description, created_by_user_id
     ) VALUES ($1,$2,$3,'ADJUSTMENT','OUT',$4,$5,$6,'CHECK_RETURN',$7,$8,$9,$10)`,
    [input.companyId, fromCashboxId, movNo, amount, check.currency_code, next, check.id, check.check_no, `ارتجاع شيك ${check.check_no}`, input.userId],
  );

  await postCheckReturnToGl(client, {
    companyId: input.companyId,
    checkId: check.id,
    checkNo: check.check_no,
    returnDate,
    amountUsd: amount,
    partyType: check.party_type,
    partyId: check.party_id,
    userId: input.userId,
  });

  const updated = await client.query<CheckRow>(
    `UPDATE checks SET status='RETURNED', updated_at=now() WHERE id=$1 AND company_id=$2
     RETURNING id, check_no, bank_name, account_holder_name, party_type, party_id, party_name,
               amount, currency_code, received_date, due_date, image_data, status, needs_review, created_at, updated_at`,
    [check.id, input.companyId],
  );
  await insertStatusHistory(client, { checkId: check.id, fromStatus: check.status, toStatus: 'RETURNED', note: input.note ?? null, userId: input.userId });
  return updated.rows[0];
}

/** صورة الشيك (base64 data URL) — تُجلب منفصلة لتخفيف القوائم. */
export async function getCheckImage(companyId: string, checkId: string): Promise<string | null> {
  const r = await getPool().query<{ image_data: string | null }>(
    `SELECT image_data FROM checks WHERE id = $1 AND company_id = $2`,
    [checkId, companyId],
  );
  if (!r.rows.length) fail('الشيك غير موجود', 'NOT_FOUND');
  return r.rows[0].image_data;
}

/** ملخص الاستحقاق للتنبيه: الشيوك المفتوحة (مستلم أو مُعطى للمورد) المتأخرة أو المستحقة خلال N يوماً. */
export async function dueSummary(companyId: string, withinDays = 7) {
  const rows = (await getPool().query<{ id: string; check_no: string; bank_name: string; party_name: string | null; amount: string; currency_code: string; due_date: string; status: string }>(
    `SELECT id, check_no, bank_name, party_name, amount, currency_code, due_date, status
       FROM checks WHERE company_id=$1 AND status IN ('RECEIVED','PAID_OUT') AND due_date <= $2::date + $3::int
       ORDER BY due_date ASC LIMIT 100`,
    [companyId, todayYmd(), withinDays],
  )).rows;
  const items = rows.map((r) => ({ ...r, days_remaining: daysUntilYmd(r.due_date) }));
  return { overdue: items.filter((i) => i.days_remaining < 0).length, dueSoon: items.filter((i) => i.days_remaining >= 0).length, items };
}
