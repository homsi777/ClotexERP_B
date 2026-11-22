/**
 * عرض باركود Code128 المناسب بالمليمتر: عدد الأشرطة × 0.25 مم (شريطان على طابعة 203dpi)، بين 22 و44 مم.
 * أشرطة Code128 = بداية 11 + 11 لكل حرف + فحص 11 + نهاية 13. بهذا لا يتمدد الرمز القصير على عرض الملصق كله.
 */
export function code128WidthMm(value: string): number {
  const n = String(value ?? '').replace(/[^ -~]/g, '').slice(0, 48).length || 1;
  const modules = 11 + 11 * n + 11 + 13;
  return Math.min(44, Math.max(22, Math.round(modules * 0.25 * 10) / 10));
}
