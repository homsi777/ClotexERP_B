/** تنسيق حقول التاريخ: العرض والإدخال «يوم/شهر/سنة» (dd/mm/yyyy)، والقيمة المخزَّنة/المرسلة ISO «yyyy-mm-dd». دوال صِرفة. */

export function isoToDmy(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** يقبل أرقاماً فقط ويضع الفواصل تلقائياً أثناء الكتابة: 2111 → 21/11 ، 21112026 → 21/11/2026. */
export function maskDmyTyping(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** يحوّل «21/11/2026» (أو بفواصل - . ) إلى ISO؛ null إن لم يكن تاريخاً حقيقياً (يرفض 31/02 و29/02 بغير كبيسة). */
export function parseDmy(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** هل التاريخ ضمن min/max (كلاهما ISO اختياري)؟ */
export function withinRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min.slice(0, 10)) return false;
  if (max && iso > max.slice(0, 10)) return false;
  return true;
}
