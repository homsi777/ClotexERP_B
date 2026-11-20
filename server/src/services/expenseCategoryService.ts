import type { PoolClient } from 'pg';
import { ensureCompanyOperatingExpenseCoa } from './glCoaService.js';

/**
 * ملاحظة بشير: إضافة تصنيف مصروف خاص داخل القائمة المنسدلة نفسها ليكون موحداً ومستقلاً لا يختلف باختلاف الإملاء.
 * الاسم يُنظَّف ويُقارَن بمفتاح مُوحَّد إملائياً (همزات الألف، الياء/الألف المقصورة، التاء المربوطة/الهاء، التشكيل،
 * التطويل، المسافات، حالة الأحرف اللاتينية) فلا يُنشأ تصنيفان لنفس المعنى؛ وإن وُجد تصنيف مطابق يُعاد هو بدل التكرار.
 * الحساب المحاسبي للتصنيف الجديد هو حساب «مصاريف إدارية عامة» (يستطيع المحاسب تغييره لاحقاً)، فلا قيد جديد بلا حساب.
 */

export class ExpenseCategoryError extends Error {
  constructor(message: string, public code: 'VALIDATION' | 'GL_CONFIG') {
    super(message);
  }
}

/** ينظّف الاسم المعروض: مسافات متتالية → واحدة، وإزالة الأطراف. */
export function cleanCategoryName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** مفتاح مقارنة موحّد إملائياً (لا يُعرَض للمستخدم). */
export function categoryNameKey(raw: unknown): string {
  return cleanCategoryName(raw)
    .toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭ]/g, '') // التشكيل وعلامات القرآن
    .replace(/ـ/g, '') // التطويل
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/[ؤ]/g, 'و') // ؤ → و
    .replace(/[ئ]/g, 'ي') // ئ → ي
    .replace(/[\s\-_.,،؛:'"()/\\]+/g, ''); // المسافات وعلامات الترقيم
}

export type ExpenseCategoryResult = {
  id: string;
  code: string;
  name: string;
  gl_account_id: string;
  is_active: boolean;
  sort_order: number;
  /** true = كان موجوداً مسبقاً (أُعيد دون إنشاء مكرر). */
  existing: boolean;
};

/** يعمل داخل معاملة يملكها المستدعي. */
export async function createExpenseCategory(client: PoolClient, companyId: string, rawName: unknown): Promise<ExpenseCategoryResult> {
  const name = cleanCategoryName(rawName);
  if (!name) throw new ExpenseCategoryError('اسم التصنيف مطلوب', 'VALIDATION');
  if (name.length > 80) throw new ExpenseCategoryError('اسم التصنيف طويل (80 حرفاً كحد أقصى)', 'VALIDATION');
  const key = categoryNameKey(name);
  if (!key) throw new ExpenseCategoryError('اسم التصنيف غير صالح', 'VALIDATION');

  await ensureCompanyOperatingExpenseCoa(client, companyId);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:expense_category`]);

  const all = await client.query<{ id: string; code: string; name: string; gl_account_id: string; is_active: boolean; sort_order: number }>(
    `SELECT id, code, name, gl_account_id, is_active, sort_order FROM expense_categories WHERE company_id = $1`,
    [companyId],
  );
  const same = all.rows.find((r) => categoryNameKey(r.name) === key);
  if (same) {
    if (!same.is_active) {
      await client.query(`UPDATE expense_categories SET is_active = true, updated_at = now() WHERE id = $1`, [same.id]);
      same.is_active = true;
    }
    return { ...same, existing: true };
  }

  const admin = all.rows.find((r) => r.code === 'ADMIN') ?? all.rows[0];
  if (!admin) throw new ExpenseCategoryError('لا يوجد حساب مصاريف افتراضي لربط التصنيف به', 'GL_CONFIG');

  const maxSort = all.rows.reduce((m, r) => Math.max(m, r.sort_order), 50);
  let seq = all.rows.filter((r) => /^CUS-\d+$/.test(r.code)).reduce((m, r) => Math.max(m, Number(r.code.slice(4))), 0);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    seq += 1;
    const code = `CUS-${String(seq).padStart(3, '0')}`;
    try {
      await client.query('SAVEPOINT expense_category_ins');
      const ins = await client.query<ExpenseCategoryResult>(
        `INSERT INTO expense_categories (company_id, code, name, gl_account_id, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, code, name, gl_account_id, is_active, sort_order`,
        [companyId, code, name, admin.gl_account_id, maxSort + 10],
      );
      await client.query('RELEASE SAVEPOINT expense_category_ins');
      return { ...ins.rows[0], existing: false };
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT expense_category_ins');
      if ((err as { code?: string }).code !== '23505') throw err;
    }
  }
  throw new ExpenseCategoryError('تعذّر توليد كود للتصنيف', 'VALIDATION');
}
