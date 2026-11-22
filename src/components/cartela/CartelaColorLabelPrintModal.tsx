import React, { useMemo, useState } from 'react';
import { Eye, Loader2, Printer, VolumeX, X } from 'lucide-react';
import type { CartelaColorSwatchDto } from '../../lib/api/cartelaColorApi';
import {
  buildCartelaColorLabelsHtml,
  buildCartelaColorLabelsPreviewHtml,
  CARTELA_COLOR_LABEL_HEIGHT_MM,
  CARTELA_COLOR_LABEL_WIDTH_MM,
} from '../../lib/printing/renderCartelaColorLabel50x25';
import { canUseSilentLabelPrinting, getPrintAdapter, isElectronRenderer } from '../../lib/printing/printAdapters';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';
import { useToast } from '../NonBlockingToast';

type Props = {
  colors: CartelaColorSwatchDto[];
  onClose: () => void;
};

/** طباعة ملصقات الألوان الفرعية 5×2.5 سم: كود الخامة + كود اللون + باركود (بلا اسم الخامة). */
export const CartelaColorLabelPrintModal: React.FC<Props> = ({ colors, onClose }) => {
  const { showToast } = useToast();
  const { settings: electronSettings } = useElectronSettings();
  const canSilent = canUseSilentLabelPrinting({
    silentLabelPrintingEnabled: electronSettings?.silentLabelPrintingEnabled,
    defaultLabelPrinterName: electronSettings?.defaultLabelPrinterName,
  });
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState<'dialog' | 'silent' | null>(null);

  const cells = useMemo(
    () => colors.map((c) => ({ materialCode: c.material_code ?? '', colorCode: c.color_code, barcodeCode: c.barcode_code })),
    [colors],
  );
  const preview = useMemo(() => buildCartelaColorLabelsPreviewHtml(cells), [cells]);
  const missingMaterial = cells.filter((c) => !c.materialCode.trim()).length;

  const run = async (mode: 'dialog' | 'silent') => {
    if (!cells.length) return;
    setBusy(mode);
    try {
      const result = await getPrintAdapter().print(buildCartelaColorLabelsHtml(cells, copies), {
        pageSize: 'label',
        widthMm: CARTELA_COLOR_LABEL_WIDTH_MM,
        heightMm: CARTELA_COLOR_LABEL_HEIGHT_MM,
        copies: 1,
        silent: mode === 'silent',
        printerName: mode === 'silent' ? electronSettings?.defaultLabelPrinterName || undefined : undefined,
      });
      showToast({
        type: result.ok ? 'success' : 'error',
        message: result.ok ? `أُرسل ${cells.length * copies} ملصق للطباعة` : result.error || 'فشلت الطباعة',
      });
      if (result.ok) onClose();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'فشلت الطباعة' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" dir="rtl">
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-violet-50 px-5 py-4">
          <div>
            <h4 className="font-bold text-slate-900">طباعة ملصقات الألوان</h4>
            <p className="mt-0.5 text-xs text-slate-500">
              {colors.length} لون — مقاس {CARTELA_COLOR_LABEL_WIDTH_MM / 10}×{CARTELA_COLOR_LABEL_HEIGHT_MM / 10} سم: كود الخامة، كود اللون، باركود
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-600 hover:bg-white/80">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Eye className="h-4 w-4 text-violet-600" /> معاينة {cells.length > 12 ? '(أول 12 ملصقاً)' : ''}
          </div>
          <iframe title="معاينة الملصقات" srcDoc={preview} className="h-[240px] w-full rounded-lg border border-slate-200 bg-white" />
          {missingMaterial > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {missingMaterial} ملصق بلا كود خامة (كود الدسان فارغ في الكارتيلة) — يُطبع السطر الأول فارغاً.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            عدد النسخ لكل لون
            <input
              type="number"
              min={1}
              max={20}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
              dir="ltr"
            />
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">
            إلغاء
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void run('dialog')}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
          >
            {busy === 'dialog' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            طباعة
          </button>
          {canSilent && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run('silent')}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'silent' ? <Loader2 className="h-4 w-4 animate-spin" /> : <VolumeX className="h-4 w-4" />}
              طباعة صامتة
            </button>
          )}
          {!canSilent && isElectronRenderer() && <span className="self-center text-xs text-slate-500">فعّل الطابعة الصامتة من الإعدادات</span>}
        </div>
      </div>
    </div>
  );
};
