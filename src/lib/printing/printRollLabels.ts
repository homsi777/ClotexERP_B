import type { RollLabelPreviewDto, LabelTemplateDto } from '../api/labelsApi';
import { buildPrintDocument, type LabelConfig } from '../../components/labels/LabelCard';
import { generateQrSvgMap } from './qrGenerator';
import { getPrintAdapter } from './printAdapters';

export type RollLabelPrintResult = { ok: boolean; error?: string };

/**
 * TASK 009: طباعة لصاقات أتواب عبر نفس محرك buildPrintDocument/getPrintAdapter
 * المستخدم في شاشة طباعة اللصاقات — دون تكرار المنطق. يُستخدم لطباعة لصاقتَي
 * القص (المقصوصة + المتبقية) بعدد نسخ مستقل لكل لصاقة عبر تكرار السطور.
 */
export async function printRollLabels(
  rolls: RollLabelPreviewDto[],
  opts: {
    config?: LabelConfig;
    template?: LabelTemplateDto | null;
    widthMm?: number;
    heightMm?: number;
    pageSize?: 'label' | 'A4' | 'A4_SHEET_6';
    silent?: boolean;
    printerName?: string;
  } = {},
): Promise<RollLabelPrintResult> {
  if (!rolls.length) return { ok: false, error: 'لا لصاقات للطباعة' };
  const widthMm = opts.widthMm ?? opts.template?.width_mm ?? 100;
  const heightMm = opts.heightMm ?? opts.template?.height_mm ?? 80;
  const qrSvgs = await generateQrSvgMap(rolls);
  const rollLayout = widthMm > heightMm ? 'auto' : 'normal';
  const html = buildPrintDocument(rolls, {
    config: opts.config,
    widthMm,
    heightMm,
    pageSize: opts.pageSize ?? 'label',
    qrSvgs,
    rollLayout,
  });
  const adapter = getPrintAdapter();
  const result = await adapter.print(html, {
    pageSize: opts.pageSize ?? 'label',
    widthMm,
    heightMm,
    printerName: opts.printerName,
    silent: opts.silent ?? false,
  });
  return { ok: result.ok, error: result.ok ? undefined : result.error };
}

/** تكرار لصاقة توب واحد بعدد النسخ المطلوب (عدد نسخ مستقل لكل ستيكر). */
export function repeatRollLabel(roll: RollLabelPreviewDto, copies: number): RollLabelPreviewDto[] {
  const n = Math.max(0, Math.min(99, Math.round(copies)));
  return Array.from({ length: n }, () => roll);
}
