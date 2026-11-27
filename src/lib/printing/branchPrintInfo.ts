/**
 * بيانات ترويسة/تذييل المطبوعات الخاصة بكل فرع (العنوان والهاتف) — تأتي من حساب الفرع الحالي (ترحيل 212).
 * الهوية البصرية واحدة للفروع الثلاثة، وتبقى لكل فرع بياناته؛ عند غياب القيمة تُستخدم القيم الافتراضية الحالية.
 */
export interface BranchPrintInfo { location: string | null; phoneInvoice: string | null; phoneVoucher: string | null }

const KEY = 'clotex_branch_print_info';
let current: BranchPrintInfo | null = null;

function readStored(): BranchPrintInfo | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BranchPrintInfo) : null;
  } catch { return null; }
}

export function setBranchPrintInfo(info: BranchPrintInfo | null | undefined): void {
  current = info ?? null;
  try { if (typeof localStorage !== 'undefined') { if (info) localStorage.setItem(KEY, JSON.stringify(info)); else localStorage.removeItem(KEY); } } catch { /* بلا تخزين */ }
}

export function getBranchPrintInfo(): BranchPrintInfo | null {
  return current ?? readStored();
}
