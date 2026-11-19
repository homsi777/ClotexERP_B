/**
 * ملاحظة مدير بشير: «في ملف الموظفين أحتاج فلترة متقدمة لعرض موظفي النسيج فقط مثلاً، أو الأقدم أو الأجدد».
 * دوال صِرفة للفلترة والترتيب على قائمة الموظفين المحمَّلة (بلا أي طلب جديد للخادم).
 */

export type FilterableEmployee = {
  employee_code: string;
  full_name: string;
  factory: string | null;
  department: string | null;
  job_title: string | null;
  category: string | null;
  fingerprint_code: string | null;
  hire_date: string | null;
  base_salary: string | number;
  status: string;
};

export type EmployeeSortKey = 'NAME' | 'CODE' | 'HIRE_OLDEST' | 'HIRE_NEWEST' | 'WAGE_HIGH' | 'WAGE_LOW';

export type EmployeeFilters = {
  factory?: string;
  department?: string;
  jobTitle?: string;
  category?: string;
  status?: string;
  /** with = له رقم بصمة، without = بلا رقم بصمة */
  fingerprint?: '' | 'with' | 'without';
  /** zero = أجره صفر (يحتاج تعبئة) */
  wage?: '' | 'zero' | 'set';
  /** نطاق تاريخ التعيين (YYYY-MM-DD) */
  hiredFrom?: string;
  hiredTo?: string;
  sort?: EmployeeSortKey;
};

const norm = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
const key = (v: string | null | undefined) => norm(v).toLocaleLowerCase();

/** قيم غير فارغة فريدة لحقل (للقوائم المنسدلة) مرتبة أبجدياً. */
export function distinctValues(employees: FilterableEmployee[], field: 'factory' | 'department' | 'job_title' | 'category'): string[] {
  const seen = new Map<string, string>();
  for (const e of employees) {
    const v = norm(e[field]);
    if (v && !seen.has(key(v))) seen.set(key(v), v);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'ar'));
}

const validDate = (d: string | null) => (d && d.slice(0, 10) >= '1990-01-01' ? d.slice(0, 10) : null);

export function filterAndSortEmployees<T extends FilterableEmployee>(employees: T[], f: EmployeeFilters): T[] {
  const out = employees.filter((e) => {
    if (f.factory && key(e.factory) !== key(f.factory)) return false;
    if (f.department && key(e.department) !== key(f.department)) return false;
    if (f.jobTitle && key(e.job_title) !== key(f.jobTitle)) return false;
    if (f.category && key(e.category) !== key(f.category)) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.fingerprint === 'with' && !norm(e.fingerprint_code)) return false;
    if (f.fingerprint === 'without' && norm(e.fingerprint_code)) return false;
    const wage = Number(e.base_salary) || 0;
    if (f.wage === 'zero' && wage > 0) return false;
    if (f.wage === 'set' && !(wage > 0)) return false;
    if (f.hiredFrom || f.hiredTo) {
      const hd = validDate(e.hire_date);
      if (!hd) return false; // من لا تاريخ تعيين صالح له لا يطابق نطاق تواريخ
      if (f.hiredFrom && hd < f.hiredFrom) return false;
      if (f.hiredTo && hd > f.hiredTo) return false;
    }
    return true;
  });

  const sort = f.sort ?? 'NAME';
  const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
  const byHire = (dir: 1 | -1) => (a: T, b: T) => {
    const da = validDate(a.hire_date);
    const db = validDate(b.hire_date);
    // من بلا تاريخ تعيين صالح يذهب دائماً للآخر مهما كان الاتجاه
    if (!da && !db) return collator.compare(a.full_name, b.full_name);
    if (!da) return 1;
    if (!db) return -1;
    return da === db ? collator.compare(a.full_name, b.full_name) : da < db ? -dir : dir;
  };
  switch (sort) {
    case 'CODE':
      return out.sort((a, b) => collator.compare(a.employee_code, b.employee_code));
    case 'HIRE_OLDEST':
      return out.sort(byHire(1));
    case 'HIRE_NEWEST':
      return out.sort(byHire(-1));
    case 'WAGE_HIGH':
      return out.sort((a, b) => (Number(b.base_salary) || 0) - (Number(a.base_salary) || 0));
    case 'WAGE_LOW':
      return out.sort((a, b) => (Number(a.base_salary) || 0) - (Number(b.base_salary) || 0));
    default:
      return out.sort((a, b) => collator.compare(a.full_name, b.full_name));
  }
}
