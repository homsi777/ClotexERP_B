/**
 * TASK 010 (بشير): شجرة سجل الكارتيلات — الخامة ← كود الدسان ← الكارتيلات (ثم ألوانها).
 * "الخامة" = اسم الخامة (title) فتُجمَع كل الكارتيلات التي تحمل الاسم نفسه ولو اختلف
 * كود الدسان (art_code). دالة صِرفة لا تغيّر أي بيانات.
 */
export type CartelaTreeSource = {
  id: string;
  title: string;
  art_code: string;
};

export type CartelaTreeDesign<T extends CartelaTreeSource> = {
  key: string;
  artCode: string;
  cartelas: T[];
};

export type CartelaTreeFabric<T extends CartelaTreeSource> = {
  key: string;
  title: string;
  designs: CartelaTreeDesign<T>[];
  cartelaCount: number;
};

const norm = (v: string | null | undefined) => (v ?? '').trim();
const keyOf = (v: string) => v.toLocaleLowerCase();

export function groupCartelasByFabric<T extends CartelaTreeSource>(items: T[]): CartelaTreeFabric<T>[] {
  const fabrics = new Map<string, CartelaTreeFabric<T>>();
  for (const item of items) {
    const title = norm(item.title);
    const art = norm(item.art_code);
    const fKey = keyOf(title);
    let fabric = fabrics.get(fKey);
    if (!fabric) {
      fabric = { key: fKey, title, designs: [], cartelaCount: 0 };
      fabrics.set(fKey, fabric);
    }
    const dKey = keyOf(art);
    let design = fabric.designs.find((d) => d.key === dKey);
    if (!design) {
      design = { key: dKey, artCode: art, cartelas: [] };
      fabric.designs.push(design);
    }
    design.cartelas.push(item);
    fabric.cartelaCount += 1;
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const result = Array.from(fabrics.values());
  result.sort((a, b) => collator.compare(a.title, b.title));
  for (const f of result) f.designs.sort((a, b) => collator.compare(a.artCode, b.artCode));
  return result;
}
