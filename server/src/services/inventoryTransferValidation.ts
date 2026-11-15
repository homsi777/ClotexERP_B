import { z } from 'zod';

export const transferBodySchema = z.object({
  fromWarehouseId: z.string().uuid('معرّف مستودع المصدر غير صالح').toLowerCase(),
  toWarehouseId: z.string().uuid('معرّف مستودع الوجهة غير صالح').toLowerCase(),
  fromLocationId: z.string().uuid().toLowerCase().nullable().optional(),
  toLocationId: z.string().uuid().toLowerCase().nullable().optional(),
  transferDate: z.string().date('تاريخ المناقلة غير صالح').optional(),
  notes: z.string().nullable().optional(),
  clientRequestId: z.string().uuid('معرّف الطلب غير صالح').toLowerCase().optional(),
  lines: z.array(z.object({
    fabricRollId: z.string().uuid('معرّف الرولة غير صالح').toLowerCase(),
    quantity: z.coerce.number().refine((n): boolean => n === 1, 'يجب نقل الرولة كاملة (الكمية = 1)').default(1),
    barcode: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })).min(1, 'اختر رولة واحدة على الأقل'),
}).superRefine((d, ctx) => {
  if (d.fromWarehouseId === d.toWarehouseId) ctx.addIssue({ code: 'custom', message: 'لا يمكن النقل إلى مستودع المصدر نفسه' });
  if (new Set(d.lines.map((l) => l.fabricRollId)).size !== d.lines.length) ctx.addIssue({ code: 'custom', message: 'توجد رولة مكررة في المناقلة' });
});
export type TransferInput = z.infer<typeof transferBodySchema>;
