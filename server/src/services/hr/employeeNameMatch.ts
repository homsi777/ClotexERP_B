/**
 * مطابقة اسم موظف مكتوب في ملف Excel (غالباً مختصراً: «هويدا»، «محمد عيد») على موظفي النظام.
 * الاستخدام: السلف المقسطة التي بلا أكواد. لا نخمّن عند الالتباس: أكثر من مرشح ⇒ AMBIGUOUS.
 */

export function normalizeArabicName(raw: string): string {
  return String(raw ?? '')
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ذ/g, 'ز') // «ذكريا/زكريا» كتابتان شائعتان لنفس الاسم
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  // «عشيري/عشري»: خطأ إملائي بحرف واحد يُقبل للكلمات الطويلة فقط.
  return a.length >= 4 && b.length >= 4 && editDistanceAtMostOne(a, b);
}

export interface NameCandidate {
  id: string;
  code: string;
  name: string;
}

export type NameMatch =
  | { kind: 'EXACT' | 'PREFIX' | 'TOKENS'; candidate: NameCandidate }
  | { kind: 'AMBIGUOUS'; candidates: NameCandidate[] }
  | { kind: 'NONE' };

/**
 * أولوية: تطابق تام ← الاسم المكتوب بداية اسم الموظف (كلمة بكلمة، بتسامح إملائي) ← كل كلمات الاسم موجودة.
 * في كل مرحلة مرشح واحد فقط يُقبل، وإلا AMBIGUOUS (لا ندمج سلفة على موظف غير مؤكد).
 */
export function matchEmployeeByName(rawName: string, employees: NameCandidate[]): NameMatch {
  const wanted = normalizeArabicName(rawName);
  if (!wanted) return { kind: 'NONE' };
  const wantedTokens = wanted.split(' ');
  const prepared = employees.map((e) => ({ e, norm: normalizeArabicName(e.name) }));

  const exact = prepared.filter((p) => p.norm === wanted);
  if (exact.length === 1) return { kind: 'EXACT', candidate: exact[0].e };
  if (exact.length > 1) return { kind: 'AMBIGUOUS', candidates: exact.map((p) => p.e) };

  const prefix = prepared.filter((p) => {
    const toks = p.norm.split(' ');
    return wantedTokens.length <= toks.length && wantedTokens.every((t, i) => tokenEq(t, toks[i]));
  });
  if (prefix.length === 1) return { kind: 'PREFIX', candidate: prefix[0].e };
  if (prefix.length > 1) return { kind: 'AMBIGUOUS', candidates: prefix.map((p) => p.e) };

  const subset = prepared.filter((p) => {
    const toks = p.norm.split(' ');
    return wantedTokens.every((t) => toks.some((x) => tokenEq(t, x)));
  });
  if (subset.length === 1) return { kind: 'TOKENS', candidate: subset[0].e };
  if (subset.length > 1) return { kind: 'AMBIGUOUS', candidates: subset.map((p) => p.e) };
  return { kind: 'NONE' };
}
