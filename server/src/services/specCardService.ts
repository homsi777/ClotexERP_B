import * as XLSX from 'xlsx';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { extractWorkbookIllustrations, extractWorkbookSheets, workbookSheetsSchema } from './manufacturingWorkbookVisuals.js';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/**
 * M-0001 — مكتبة بطاقات المواصفات.
 * البطاقة مرجع للعرض والتعديل والطباعة والتصدير فقط: لا يُحسب منها استهلاك ولا تنشأ منها حركات مخزون.
 */
const illustrationSchema = z.array(z.object({
  name: z.string().max(200),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  base64: z.string().max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/=]+$/),
}).strict()).max(20);

export const specCardBodySchema = z.object({
  materialName: z.string().trim().min(1, 'اسم الخامة مطلوب').max(200),
  materialCode: z.string().trim().min(1, 'كود الخامة مطلوب').max(80),
  fabricItemId: z.string().uuid().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  sheets: workbookSheetsSchema.optional(),
  illustrations: illustrationSchema.optional(),
  sourceFileName: z.string().max(260).nullable().optional(),
}).strict();

export type SpecCardBody = z.infer<typeof specCardBodySchema>;

const fail = (message: string, code = 'VALIDATION') => Object.assign(new Error(message), { code });

/** يقرأ ملف Excel ويحوّله لشبكة أوراق (قيم وألوان ودمج) دون حفظ أي شيء. */
export function parseSpecCardWorkbook(contentBase64: string): { sheets: ReturnType<typeof extractWorkbookSheets>; illustrations: ReturnType<typeof extractWorkbookIllustrations> } {
  if (!/^[A-Za-z0-9+/=]+$/.test(contentBase64)) throw fail('ملف غير صالح');
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw fail('حجم الملف يجب أن يكون أقل من 4 ميغابايت');
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellStyles: true, bookFiles: true, cellDates: true });
  } catch {
    throw fail('تعذر قراءة ملف Excel');
  }
  if (!workbook.SheetNames.length) throw fail('الملف لا يحتوي أوراقاً');
  return { sheets: extractWorkbookSheets(workbook), illustrations: extractWorkbookIllustrations(workbook) };
}

async function assertFabricItem(db: Db, companyId: string, itemId: string | null | undefined) {
  if (!itemId) return;
  const r = await db.query('SELECT 1 FROM fabric_items WHERE id=$1 AND company_id=$2', [itemId, companyId]);
  if (!r.rows.length) throw fail('الخامة المرتبطة غير موجودة في دليل الخامات');
}

const LIST_SORTS: Record<string, string> = {
  material_name: 'c.material_name',
  material_code: 'c.material_code',
  updated_at: 'c.updated_at',
};

export async function listSpecCards(db: Db, companyId: string, opts: { search?: string; sort?: string; dir?: string; fabricItemId?: string }) {
  const params: unknown[] = [companyId];
  let where = 'c.company_id = $1 AND c.is_active';
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where += ` AND (c.material_name ILIKE $${params.length} OR c.material_code ILIKE $${params.length} OR fi.name ILIKE $${params.length} OR fi.internal_code ILIKE $${params.length})`;
  }
  if (opts.fabricItemId) {
    params.push(opts.fabricItemId);
    where += ` AND c.fabric_item_id = $${params.length}`;
  }
  const sort = LIST_SORTS[opts.sort ?? ''] ?? LIST_SORTS.material_name;
  const dir = String(opts.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const r = await db.query(
    `SELECT c.id, c.material_name, c.material_code, c.fabric_item_id, fi.name AS fabric_item_name, fi.internal_code AS fabric_item_code,
            c.source_file_name, c.updated_at, c.created_at, jsonb_array_length(c.sheets) AS sheet_count
       FROM spec_cards c
       LEFT JOIN fabric_items fi ON fi.id = c.fabric_item_id AND fi.company_id = c.company_id
      WHERE ${where}
      ORDER BY ${sort} ${dir}, c.material_code ASC
      LIMIT 1000`,
    params,
  );
  return r.rows;
}

export async function getSpecCard(db: Db, companyId: string, id: string) {
  const r = await db.query(
    `SELECT c.*, fi.name AS fabric_item_name, fi.internal_code AS fabric_item_code
       FROM spec_cards c LEFT JOIN fabric_items fi ON fi.id = c.fabric_item_id AND fi.company_id = c.company_id
      WHERE c.id=$1 AND c.company_id=$2 AND c.is_active`,
    [id, companyId],
  );
  return r.rows[0] ?? null;
}

export async function createSpecCard(db: Db, companyId: string, userId: string, raw: unknown) {
  const parsed = specCardBodySchema.safeParse(raw);
  if (!parsed.success) throw fail(parsed.error.issues[0]?.message ?? 'بيانات البطاقة غير صالحة');
  const d = parsed.data;
  await assertFabricItem(db, companyId, d.fabricItemId);
  const r = await db.query<{ id: string }>(
    `INSERT INTO spec_cards (company_id, material_name, material_code, fabric_item_id, notes, sheets, illustrations, source_file_name, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$9) RETURNING id`,
    [companyId, d.materialName, d.materialCode, d.fabricItemId ?? null, d.notes?.trim() || null, JSON.stringify(d.sheets ?? []), JSON.stringify(d.illustrations ?? []), d.sourceFileName ?? null, userId],
  );
  return getSpecCard(db, companyId, r.rows[0].id);
}

export async function updateSpecCard(db: Db, companyId: string, userId: string, id: string, raw: unknown) {
  const parsed = specCardBodySchema.partial().safeParse(raw);
  if (!parsed.success) throw fail(parsed.error.issues[0]?.message ?? 'بيانات البطاقة غير صالحة');
  const d = parsed.data;
  const cur = await db.query('SELECT 1 FROM spec_cards WHERE id=$1 AND company_id=$2 AND is_active', [id, companyId]);
  if (!cur.rows.length) throw fail('البطاقة غير موجودة', 'NOT_FOUND');
  if (d.fabricItemId !== undefined) await assertFabricItem(db, companyId, d.fabricItemId);
  await db.query(
    `UPDATE spec_cards SET
       material_name = COALESCE($3, material_name),
       material_code = COALESCE($4, material_code),
       fabric_item_id = CASE WHEN $5::boolean THEN $6::uuid ELSE fabric_item_id END,
       notes = CASE WHEN $7::boolean THEN $8 ELSE notes END,
       sheets = COALESCE($9::jsonb, sheets),
       illustrations = COALESCE($10::jsonb, illustrations),
       source_file_name = CASE WHEN $11::boolean THEN $12 ELSE source_file_name END,
       updated_by_user_id = $13, updated_at = now()
     WHERE id=$1 AND company_id=$2`,
    [
      id, companyId, d.materialName ?? null, d.materialCode ?? null,
      d.fabricItemId !== undefined, d.fabricItemId ?? null,
      d.notes !== undefined, d.notes?.trim() || null,
      d.sheets ? JSON.stringify(d.sheets) : null, d.illustrations ? JSON.stringify(d.illustrations) : null,
      d.sourceFileName !== undefined, d.sourceFileName ?? null,
      userId,
    ],
  );
  return getSpecCard(db, companyId, id);
}

/** إخفاء البطاقة من المكتبة (حذف منطقي، لا يُحذف شيء فعلياً). */
export async function archiveSpecCard(db: Db, companyId: string, userId: string, id: string): Promise<boolean> {
  const r = await db.query('UPDATE spec_cards SET is_active=false, updated_by_user_id=$3, updated_at=now() WHERE id=$1 AND company_id=$2 AND is_active', [id, companyId, userId]);
  return (r.rowCount ?? 0) > 0;
}
