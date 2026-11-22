import type { PoolClient } from 'pg';
import { allocateNextColorNo, buildColorBarcodeCode, normalizeColorCode, validateColorCode } from './cartelaColorService.js';

type Db = Pick<PoolClient, 'query'>;

/**
 * ملاحظة بشير: عند إنشاء كارتيلة مرتبطة بالمخزون، تُعرض كل ألوان الخامة المرتبطة بنفس كود الدسان
 * (design_code) التي ليس لها كارتيلة بعد، ويُسأل المستخدم دائماً قبل إنشاء كارتيلاتها بنفس مواصفات الكارتيلة المصدر.
 * اللون = (خامة + لون): من فاريانتات الخامات ذات نفس كود الدسان، ومن ألوان أتوابها الفعلية بالمستودع.
 */

export type SiblingCandidate = {
  itemId: string;
  itemName: string;
  colorId: string;
  colorCode: string | null;
  colorName: string | null;
};

export type SiblingResult = {
  linked: boolean;
  designCode: string;
  candidates: SiblingCandidate[];
};

export class SiblingError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'VALIDATION') {
    super(message);
  }
}

async function loadSource(db: Db, companyId: string, cartelaId: string) {
  const r = await db.query(
    `SELECT cl.*, fi.design_code AS item_design_code
       FROM cartela_labels cl
       LEFT JOIN fabric_items fi ON fi.id = cl.fabric_item_id AND fi.company_id = cl.company_id
      WHERE cl.id = $1 AND cl.company_id = $2`,
    [cartelaId, companyId],
  );
  if (!r.rows.length) throw new SiblingError('الكارتيلة غير موجودة', 'NOT_FOUND');
  return r.rows[0] as Record<string, any>;
}

async function computeCandidates(db: Db, companyId: string, source: Record<string, any>): Promise<SiblingResult> {
  const designCode = String(source.item_design_code ?? '').trim();
  if (!source.fabric_item_id) return { linked: false, designCode, candidates: [] };

  const items = await db.query(
    `SELECT id, name FROM fabric_items
      WHERE company_id = $1 AND is_active
        AND (id = $2 OR ($3 <> '' AND lower(trim(design_code)) = lower($3)))`,
    [companyId, source.fabric_item_id, designCode],
  );
  const itemIds = items.rows.map((i) => i.id as string);
  if (!itemIds.length) return { linked: true, designCode, candidates: [] };
  const itemName = new Map<string, string>(items.rows.map((i) => [i.id as string, i.name as string]));

  // ألوان الخامات: فاريانتات مسجّلة + ألوان أتواب فعلية (قد لا يكون لها فاريانت بعد).
  const colors = await db.query(
    `SELECT x.item_id, x.color_id, fc.color_code, fc.name_ar,
            (EXISTS (
              SELECT 1 FROM fabric_item_variants v
                JOIN cartela_labels cl ON cl.fabric_variant_id = v.id
               WHERE v.company_id = $1 AND v.item_id = x.item_id AND v.color_id = x.color_id
            ) OR EXISTS (
              SELECT 1 FROM cartela_label_colors clc
               WHERE clc.company_id = $1 AND clc.cartela_label_id = $3 AND clc.fabric_color_id = x.color_id
            )) AS has_cartela
       FROM (
         SELECT v.item_id, v.color_id FROM fabric_item_variants v
          WHERE v.company_id = $1 AND v.is_active AND v.item_id = ANY($2::uuid[])
         UNION
         SELECT r.item_id, r.color_id FROM fabric_rolls r
          WHERE r.company_id = $1 AND r.item_id = ANY($2::uuid[]) AND r.color_id IS NOT NULL
       ) x
       JOIN fabric_colors fc ON fc.id = x.color_id
      ORDER BY fc.color_code NULLS LAST, fc.name_ar`,
    [companyId, itemIds, source.id],
  );

  // لون الكارتيلة المصدر نفسها يُستبعد.
  let sourceColorId: string | null = null;
  if (source.fabric_variant_id) {
    const sv = await db.query(`SELECT color_id FROM fabric_item_variants WHERE id = $1 AND company_id = $2`, [source.fabric_variant_id, companyId]);
    sourceColorId = sv.rows[0]?.color_id ?? null;
  }

  const candidates: SiblingCandidate[] = colors.rows
    .filter((c) => !c.has_cartela && !(c.item_id === source.fabric_item_id && c.color_id === sourceColorId))
    .map((c) => ({
      itemId: c.item_id as string,
      itemName: itemName.get(c.item_id as string) ?? '',
      colorId: c.color_id as string,
      colorCode: (c.color_code as string | null) ?? null,
      colorName: (c.name_ar as string | null) ?? null,
    }));
  return { linked: true, designCode, candidates };
}

export async function listSiblingColors(db: Db, companyId: string, cartelaId: string): Promise<SiblingResult> {
  return computeCandidates(db, companyId, await loadSource(db, companyId, cartelaId));
}

export type CloneOutcome = {
  /** الألوان المضافة كألوان فرعية داخل الكارتيلة نفسها (لا كارتيلات مستقلة). */
  created: { id: string; colorCode: string | null; colorName: string | null; barcodeCode: string }[];
  failed: { colorCode: string | null; colorName: string | null; message: string }[];
};

/**
 * ملاحظة بشير: الألوان الأخرى لنفس الخامة تُضاف كألوان فرعية داخل الكارتيلة المصدر (cartela_label_colors)
 * وليست كارتيلات منفردة. كود اللون الفرعي = كود لون الخامة إن صلح، وإلا C-NN؛ والباركود = الرقم التسلسلي-كود اللون.
 * كل لون بنقطة حفظ مستقلة: فشل لون لا يُفشل البقية. على المستدعي فتح المعاملة.
 */
export async function cloneCartelaToSiblings(
  client: PoolClient,
  companyId: string,
  _userId: string | null,
  cartelaId: string,
  picks: { itemId: string; colorId: string }[],
): Promise<CloneOutcome> {
  if (!picks.length) throw new SiblingError('اختر لوناً واحداً على الأقل', 'VALIDATION');
  const source = await loadSource(client, companyId, cartelaId);
  const allowed = await computeCandidates(client, companyId, source);
  if (!allowed.linked) throw new SiblingError('الكارتيلة غير مرتبطة بخامة من المخزون', 'VALIDATION');
  const serialNo = String(source.serial_no ?? '').trim();
  if (!serialNo) throw new SiblingError('احفظ الكارتيلة برقم تسلسلي قبل إضافة ألوان', 'VALIDATION');
  const byKey = new Map(allowed.candidates.map((c) => [`${c.itemId}|${c.colorId}`, c]));
  await client.query(`SELECT 1 FROM cartela_labels WHERE id = $1 AND company_id = $2 FOR UPDATE`, [cartelaId, companyId]);

  const out: CloneOutcome = { created: [], failed: [] };
  const seen = new Set<string>();
  for (const pick of picks) {
    const key = `${pick.itemId}|${pick.colorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cand = byKey.get(key);
    if (!cand) {
      out.failed.push({ colorCode: null, colorName: null, message: 'اللون غير مؤهل (له كارتيلة أو لون فرعي بالفعل، أو ليس من نفس كود الدسان)' });
      continue;
    }
    await client.query('SAVEPOINT cartela_sub_color_one');
    try {
      const colorNo = await allocateNextColorNo(client, cartelaId);
      let colorCode = normalizeColorCode(cand.colorCode ?? '');
      if (validateColorCode(colorCode) || !colorCode) colorCode = `C-${String(colorNo).padStart(2, '0')}`;
      const taken = await client.query(
        `SELECT 1 FROM cartela_label_colors WHERE cartela_label_id = $1 AND color_code = $2`,
        [cartelaId, colorCode],
      );
      if (taken.rows.length) colorCode = `C-${String(colorNo).padStart(2, '0')}`;
      const barcode = buildColorBarcodeCode(serialNo, colorCode);
      const ins = await client.query(
        `INSERT INTO cartela_label_colors (
           company_id, cartela_label_id, color_no, color_code, barcode_code, name_ar, name_tr, fabric_color_id, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,'',$7,$3)
         RETURNING id`,
        [companyId, cartelaId, colorNo, colorCode, barcode, cand.colorName ?? '', cand.colorId],
      );
      out.created.push({ id: ins.rows[0].id, colorCode, colorName: cand.colorName, barcodeCode: barcode });
      await client.query('RELEASE SAVEPOINT cartela_sub_color_one');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT cartela_sub_color_one');
      out.failed.push({ colorCode: cand.colorCode, colorName: cand.colorName, message: e instanceof Error ? e.message : 'تعذّرت الإضافة' });
    }
  }
  return out;
}
