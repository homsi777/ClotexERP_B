interface KgLineLike { quantity?: number | null; unitType?: string | null; weightKg?: number | null; weight?: number | null; widthCm?: number | null; gsm?: number | null }

/**
 * كمية البند للعرض في كشف الفاتورة: بند الكيلو يُعرض بالكيلو (الكمية = الوزن)، ولا يُعرض متراً.
 * الطول يُشتق فقط عند توفّر العرض والـgsm (طول = كغ×1000 ÷ (عرض م × gsm))، وإلا يبقى 0 (غير معروف) بدل ادّعاء أنه أمتار.
 */
export function statementQuantity(item: KgLineLike): { meters: number; kg: number } {
  const q = Number(item.quantity ?? 0) || 0;
  if (item.unitType === 'kg') {
    const w = Number(item.widthCm ?? 0), g = Number(item.gsm ?? 0);
    const meters = w > 0 && g > 0 ? Math.round(((q * 1000) / ((w / 100) * g)) * 100) / 100 : 0;
    return { meters, kg: q };
  }
  return { meters: q, kg: Number(item.weightKg ?? item.weight ?? 0) || 0 };
}
