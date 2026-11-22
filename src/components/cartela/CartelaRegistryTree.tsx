import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, Loader2, Pencil, Printer, Tags } from 'lucide-react';
import type { CartelaLabelListItem } from '../../lib/api/cartelaApi';
import {
  cartelaColorDisplayName,
  listCartelaColors,
  type CartelaColorSwatchDto,
} from '../../lib/api/cartelaColorApi';
import { groupCartelasByFabric } from '../../lib/cartela/cartelaTree';
import { CartelaColorLabelPrintModal } from './CartelaColorLabelPrintModal';
import { useToast } from '../NonBlockingToast';

type Props = {
  items: CartelaLabelListItem[];
  /** عند وجود بحث نشط تُفتح كل العقد تلقائياً ليظهر ما طابق كود الدسان. */
  searchActive: boolean;
  printingId: string | null;
  onEdit: (cartelaId: string) => void;
  /** طباعة ستيكر الكارتيلة نفسه (80×50) عبر مسار الطباعة الحالي. */
  onPrintCartela: (cartelaId: string) => void;
  /** معاينة ستيكر الكارتيلة قبل الطباعة (ملاحظة بشير). */
  onPreviewCartela?: (cartelaId: string) => void;
};

/**
 * TASK 010 (بشير): عرض مختصر شجري — الخامة ← كود الدسان ← الألوان،
 * مع زر لطباعة الألوان 2.5×5 (لون واحد أو عدة ألوان) وزر لستيكر الكارتيلة 80×50.
 * الألوان تُحمَّل عند فتح الكارتيلة فقط عبر listCartelaColors الحالية.
 */
export const CartelaRegistryTree: React.FC<Props> = ({
  items,
  searchActive,
  printingId,
  onEdit,
  onPrintCartela,
  onPreviewCartela,
}) => {
  const { t } = useTranslation('cartelaLabels');
  const { showToast } = useToast();
  const tree = useMemo(() => groupCartelasByFabric(items), [items]);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [colorsByCartela, setColorsByCartela] = useState<Record<string, CartelaColorSwatchDto[]>>({});
  const [loadingColors, setLoadingColors] = useState<Set<string>>(new Set());
  const [pickedColorIds, setPickedColorIds] = useState<Set<string>>(new Set());
  const [printColors, setPrintColors] = useState<CartelaColorSwatchDto[] | null>(null);

  const isOpen = (key: string) => searchActive || openKeys.has(key);

  const toggle = (key: string) =>
    setOpenKeys((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const ensureColors = useCallback(
    async (cartelaId: string): Promise<CartelaColorSwatchDto[]> => {
      if (colorsByCartela[cartelaId]) return colorsByCartela[cartelaId];
      setLoadingColors((cur) => new Set(cur).add(cartelaId));
      try {
        const rows = await listCartelaColors(cartelaId);
        setColorsByCartela((cur) => ({ ...cur, [cartelaId]: rows }));
        return rows;
      } catch (e) {
        showToast({ type: 'error', message: e instanceof Error ? e.message : t('tree.loadColorsFailed') });
        return [];
      } finally {
        setLoadingColors((cur) => {
          const next = new Set(cur);
          next.delete(cartelaId);
          return next;
        });
      }
    },
    [colorsByCartela, showToast, t],
  );

  const toggleCartela = (cartelaId: string) => {
    const key = `c:${cartelaId}`;
    const willOpen = !openKeys.has(key);
    toggle(key);
    if (willOpen) void ensureColors(cartelaId);
  };

  const togglePicked = (colorId: string) =>
    setPickedColorIds((cur) => {
      const next = new Set(cur);
      if (next.has(colorId)) next.delete(colorId);
      else next.add(colorId);
      return next;
    });

  const printPickedOf = (cartelaId: string) => {
    const colors = (colorsByCartela[cartelaId] ?? []).filter((c) => pickedColorIds.has(c.id));
    if (!colors.length) {
      showToast({ type: 'warning', message: t('tree.pickColorsFirst') });
      return;
    }
    setPrintColors(colors);
  };

  if (!tree.length) return null;

  return (
    <div className="p-3 space-y-2" data-testid="cartela-tree">
      {tree.map((fabric) => {
        const fKey = `f:${fabric.key}`;
        return (
          <div key={fKey} className="rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => toggle(fKey)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-right hover:bg-slate-50"
              aria-expanded={isOpen(fKey)}
            >
              {isOpen(fKey) ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              <span className="font-bold text-slate-900">{fabric.title || t('tree.noFabricName')}</span>
              <span className="text-xs text-slate-500">
                {t('tree.fabricSummary', { designs: fabric.designs.length, cartelas: fabric.cartelaCount })}
              </span>
            </button>

            {isOpen(fKey) && (
              <div className="border-t border-slate-100 px-3 py-2 space-y-2">
                {fabric.designs.map((design) => {
                  const dKey = `d:${fabric.key}|${design.key}`;
                  return (
                    <div key={dKey} className="rounded-md border border-slate-100 bg-slate-50/60">
                      <button
                        type="button"
                        onClick={() => toggle(dKey)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-right hover:bg-slate-100/70"
                        aria-expanded={isOpen(dKey)}
                      >
                        {isOpen(dKey) ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                        <span className="text-xs font-bold text-slate-500">{t('tree.designCodeLabel')}</span>
                        <span className="font-mono font-bold text-slate-800" dir="ltr">
                          {design.artCode || '—'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {t('tree.designSummary', { count: design.cartelas.length })}
                        </span>
                      </button>

                      {isOpen(dKey) && (
                        <div className="px-3 pb-3 space-y-2">
                          {design.cartelas.map((cartela) => {
                            const cKey = `c:${cartela.id}`;
                            const colors = colorsByCartela[cartela.id];
                            return (
                              <div key={cartela.id} className="rounded-md border border-slate-200 bg-white">
                                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleCartela(cartela.id)}
                                    className="inline-flex items-center gap-2 text-right"
                                    aria-expanded={isOpen(cKey)}
                                  >
                                    {isOpen(cKey) ? (
                                      <ChevronDown className="w-4 h-4" />
                                    ) : (
                                      <ChevronLeft className="w-4 h-4" />
                                    )}
                                    <span className="font-mono font-bold text-slate-900" dir="ltr">
                                      {cartela.serial_no || '—'}
                                    </span>
                                    <span className="text-xs text-slate-600">{cartela.design_no || ''}</span>
                                    <span className="text-xs rounded-full bg-violet-100 text-violet-800 px-2 py-0.5 font-bold">
                                      {t('registry.colorCount', { count: cartela.color_count ?? 0 })}
                                    </span>
                                  </button>
                                  <span className="flex-1" />
                                  <button
                                    type="button"
                                    onClick={() => onEdit(cartela.id)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    {t('registry.edit')}
                                  </button>
                                  {onPreviewCartela && (
                                    <button
                                      type="button"
                                      onClick={() => onPreviewCartela(cartela.id)}
                                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                    >
                                      {t('tree.previewCartelaSticker')}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={printingId === cartela.id}
                                    onClick={() => onPrintCartela(cartela.id)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
                                  >
                                    {printingId === cartela.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Printer className="w-3.5 h-3.5" />
                                    )}
                                    {t('tree.printCartelaSticker')}
                                  </button>
                                </div>

                                {isOpen(cKey) && (
                                  <div className="border-t border-slate-100 px-3 py-2">
                                    {loadingColors.has(cartela.id) && (
                                      <p className="text-xs text-slate-500 flex items-center gap-1">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        {t('registry.loading')}
                                      </p>
                                    )}
                                    {colors && colors.length === 0 && (
                                      <p className="text-xs text-slate-500">{t('tree.noColors')}</p>
                                    )}
                                    {colors && colors.length > 0 && (
                                      <>
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setPickedColorIds((cur) => {
                                                const next = new Set(cur);
                                                const allPicked = colors.every((c) => next.has(c.id));
                                                colors.forEach((c) => (allPicked ? next.delete(c.id) : next.add(c.id)));
                                                return next;
                                              })
                                            }
                                            className="text-xs font-bold text-indigo-700 hover:underline"
                                          >
                                            {colors.every((c) => pickedColorIds.has(c.id))
                                              ? t('tree.clearColors')
                                              : t('tree.selectAllColors')}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => printPickedOf(cartela.id)}
                                            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                                          >
                                            <Tags className="w-3.5 h-3.5" />
                                            {t('tree.printColors25x5')}
                                          </button>
                                        </div>
                                        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                          {colors.map((color) => (
                                            <li
                                              key={color.id}
                                              className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-xs"
                                            >
                                              <input
                                                type="checkbox"
                                                className="accent-violet-600"
                                                checked={pickedColorIds.has(color.id)}
                                                onChange={() => togglePicked(color.id)}
                                                aria-label={cartelaColorDisplayName(color)}
                                              />
                                              <span className="font-mono font-bold" dir="ltr">
                                                {color.color_code}
                                              </span>
                                              <span className="text-slate-600 truncate flex-1">
                                                {cartelaColorDisplayName(color)}
                                              </span>
                                              <button
                                                type="button"
                                                title={t('tree.printColors25x5')}
                                                onClick={() => setPrintColors([color])}
                                                className="p-1 rounded hover:bg-violet-50 text-violet-700"
                                              >
                                                <Printer className="w-3.5 h-3.5" />
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {printColors && (
        <CartelaColorLabelPrintModal colors={printColors} onClose={() => setPrintColors(null)} />
      )}
    </div>
  );
};
