import type { Pool, PoolClient } from 'pg';
import { insertAuditLog } from './auditLogService.js';

type Db = Pool | PoolClient;

export type CheckImageSide = 'FRONT' | 'BACK' | 'OTHER';

export interface CheckImageMeta {
  id: string;
  checkId: string;
  side: CheckImageSide;
  sortOrder: number;
  hasEdit: boolean;
  editParams: unknown;
  updatedAt: string;
}

export const MAX_IMAGES_PER_CHECK = 6;
/** الحد الأقصى لحجم صورة واحدة (نص data URL) — العميل يصغّر قبل الرفع؛ هذا حاجز أمان. */
export const MAX_IMAGE_CHARS = 3_000_000;
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;

function fail(message: string, code = 'VALIDATION'): never {
  throw Object.assign(new Error(message), { code });
}

export function assertImageData(data: unknown): string {
  const s = typeof data === 'string' ? data.trim() : '';
  if (!s) fail('الصورة مطلوبة');
  if (s.length > MAX_IMAGE_CHARS) fail('حجم الصورة كبير جداً — صغّرها قبل الرفع');
  if (!DATA_URL_RE.test(s)) fail('صيغة الصورة غير مدعومة (JPEG/PNG/WebP فقط)');
  return s;
}

async function assertCheck(db: Db, companyId: string, checkId: string): Promise<void> {
  const r = await db.query(`SELECT 1 FROM checks WHERE id = $1 AND company_id = $2`, [checkId, companyId]);
  if (!r.rows.length) fail('الشيك غير موجود', 'NOT_FOUND');
}

/** يُبقي checks.image_data = أول صورة فعّالة (المعدّلة إن وُجد تعديل). لا يلمس أي حقل مالي أو الحالة. */
export async function syncPrimaryImage(db: Db, companyId: string, checkId: string): Promise<void> {
  await db.query(
    `UPDATE checks SET image_data = (
        SELECT COALESCE(edited_data, original_data) FROM check_images
         WHERE check_id = $1 AND company_id = $2 ORDER BY sort_order, created_at LIMIT 1
     )
     WHERE id = $1 AND company_id = $2`,
    [checkId, companyId],
  );
}

export async function listCheckImages(db: Db, companyId: string, checkId: string): Promise<CheckImageMeta[]> {
  await assertCheck(db, companyId, checkId);
  const r = await db.query(
    `SELECT id, check_id, side, sort_order, (edited_data IS NOT NULL) AS has_edit, edit_params, updated_at
       FROM check_images WHERE check_id = $1 AND company_id = $2 ORDER BY sort_order, created_at`,
    [checkId, companyId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    checkId: x.check_id,
    side: x.side,
    sortOrder: x.sort_order,
    hasEdit: x.has_edit,
    editParams: x.edit_params,
    updatedAt: x.updated_at.toISOString(),
  }));
}

export async function getCheckImageData(
  db: Db,
  companyId: string,
  imageId: string,
  variant: 'effective' | 'original',
): Promise<{ data: string; checkId: string }> {
  const r = await db.query(
    `SELECT check_id, original_data, edited_data FROM check_images WHERE id = $1 AND company_id = $2`,
    [imageId, companyId],
  );
  if (!r.rows.length) fail('الصورة غير موجودة', 'NOT_FOUND');
  const row = r.rows[0];
  return { checkId: row.check_id, data: variant === 'original' ? row.original_data : (row.edited_data ?? row.original_data) };
}

/** بيانات الطباعة لعدة شيكات: الصور الفعّالة + تاريخ التسليم (للشيكات الصادرة). لا تعدّل شيئاً. */
export async function getPrintData(db: Db, companyId: string, checkIds: string[]) {
  if (!checkIds.length) return [];
  const imgs = await db.query(
    `SELECT id, check_id, side, COALESCE(edited_data, original_data) AS data
       FROM check_images WHERE company_id = $1 AND check_id = ANY($2::uuid[]) ORDER BY check_id, sort_order, created_at`,
    [companyId, checkIds],
  );
  const delivered = await db.query(
    `SELECT h.check_id, max(h.changed_at) AS delivered_at
       FROM check_status_history h JOIN checks c ON c.id = h.check_id
      WHERE c.company_id = $1 AND h.check_id = ANY($2::uuid[]) AND h.to_status = 'PAID_OUT' GROUP BY h.check_id`,
    [companyId, checkIds],
  );
  const dmap = new Map(delivered.rows.map((d) => [d.check_id as string, (d.delivered_at as Date).toISOString().slice(0, 10)]));
  return checkIds.map((id) => ({
    checkId: id,
    deliveredAt: dmap.get(id) ?? null,
    images: imgs.rows.filter((i) => i.check_id === id).map((i) => ({ id: i.id as string, side: i.side as CheckImageSide, data: i.data as string })),
  }));
}

export async function addCheckImage(
  client: PoolClient,
  input: { companyId: string; userId: string | null; checkId: string; side: CheckImageSide; data: string },
): Promise<CheckImageMeta> {
  await assertCheck(client, input.companyId, input.checkId);
  const data = assertImageData(input.data);
  const count = await client.query<{ n: string; next: string }>(
    `SELECT count(*) AS n, COALESCE(max(sort_order), -1) + 1 AS next FROM check_images WHERE check_id = $1 AND company_id = $2`,
    [input.checkId, input.companyId],
  );
  if (Number(count.rows[0].n) >= MAX_IMAGES_PER_CHECK) fail(`الحد الأقصى ${MAX_IMAGES_PER_CHECK} صور للشيك الواحد`);
  const ins = await client.query(
    `INSERT INTO check_images (company_id, check_id, side, sort_order, original_data, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
    [input.companyId, input.checkId, input.side, Number(count.rows[0].next), data, input.userId],
  );
  await syncPrimaryImage(client, input.companyId, input.checkId);
  await insertAuditLog(client, {
    companyId: input.companyId,
    userId: input.userId,
    action: 'CHECK_IMAGE_ADDED',
    entityType: 'check_image',
    entityId: ins.rows[0].id,
    details: { checkId: input.checkId, side: input.side },
  });
  return (await listCheckImages(client, input.companyId, input.checkId)).find((m) => m.id === ins.rows[0].id)!;
}

/** حفظ تعديل (قص/تدوير) كنسخة معدَّلة بجانب الأصل. الأصل لا يُلمس أبداً. */
export async function saveCheckImageEdit(
  client: PoolClient,
  input: { companyId: string; userId: string | null; imageId: string; editedData: string; editParams: unknown; side?: CheckImageSide },
): Promise<CheckImageMeta> {
  const edited = assertImageData(input.editedData);
  const cur = await client.query(`SELECT check_id FROM check_images WHERE id = $1 AND company_id = $2 FOR UPDATE`, [input.imageId, input.companyId]);
  if (!cur.rows.length) fail('الصورة غير موجودة', 'NOT_FOUND');
  const checkId = cur.rows[0].check_id as string;
  await client.query(
    `UPDATE check_images SET edited_data = $3, edit_params = $4::jsonb, side = COALESCE($5, side),
            updated_by_user_id = $6, updated_at = now()
      WHERE id = $1 AND company_id = $2`,
    [input.imageId, input.companyId, edited, input.editParams == null ? null : JSON.stringify(input.editParams), input.side ?? null, input.userId],
  );
  await syncPrimaryImage(client, input.companyId, checkId);
  await insertAuditLog(client, {
    companyId: input.companyId,
    userId: input.userId,
    action: 'CHECK_IMAGE_EDITED',
    entityType: 'check_image',
    entityId: input.imageId,
    details: { checkId, params: input.editParams ?? null },
  });
  return (await listCheckImages(client, input.companyId, checkId)).find((m) => m.id === input.imageId)!;
}

/** إلغاء التعديلات والعودة للأصل. */
export async function resetCheckImageEdit(
  client: PoolClient,
  input: { companyId: string; userId: string | null; imageId: string },
): Promise<CheckImageMeta> {
  const cur = await client.query(`SELECT check_id FROM check_images WHERE id = $1 AND company_id = $2 FOR UPDATE`, [input.imageId, input.companyId]);
  if (!cur.rows.length) fail('الصورة غير موجودة', 'NOT_FOUND');
  const checkId = cur.rows[0].check_id as string;
  await client.query(
    `UPDATE check_images SET edited_data = NULL, edit_params = NULL, updated_by_user_id = $3, updated_at = now() WHERE id = $1 AND company_id = $2`,
    [input.imageId, input.companyId, input.userId],
  );
  await syncPrimaryImage(client, input.companyId, checkId);
  await insertAuditLog(client, {
    companyId: input.companyId,
    userId: input.userId,
    action: 'CHECK_IMAGE_RESET',
    entityType: 'check_image',
    entityId: input.imageId,
    details: { checkId },
  });
  return (await listCheckImages(client, input.companyId, checkId)).find((m) => m.id === input.imageId)!;
}

export async function deleteCheckImage(
  client: PoolClient,
  input: { companyId: string; userId: string | null; imageId: string },
): Promise<void> {
  const cur = await client.query(`SELECT check_id, side FROM check_images WHERE id = $1 AND company_id = $2 FOR UPDATE`, [input.imageId, input.companyId]);
  if (!cur.rows.length) fail('الصورة غير موجودة', 'NOT_FOUND');
  const checkId = cur.rows[0].check_id as string;
  await client.query(`DELETE FROM check_images WHERE id = $1 AND company_id = $2`, [input.imageId, input.companyId]);
  await syncPrimaryImage(client, input.companyId, checkId);
  await insertAuditLog(client, {
    companyId: input.companyId,
    userId: input.userId,
    action: 'CHECK_IMAGE_DELETED',
    entityType: 'check_image',
    entityId: input.imageId,
    details: { checkId, side: cur.rows[0].side },
  });
}
