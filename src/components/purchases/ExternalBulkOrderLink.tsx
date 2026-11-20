import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchExternalOrderLines, type ExternalOrderChoice } from '../../lib/api/externalJobsApi';
import type { FabricRollDto } from '../../lib/api/fabricRollsApi';

type Scope = 'ALL' | 'ITEM' | 'COLOR' | 'CHECKED';
type Target = 'order' | 'stock' | 'inherit';

/** مرجع الربط المطبَّق: null = إزالة (تتبع سابق إن وُجد)، وإلا أوردر/سطر لون أو مخزون عام (customerOrderId=null). */
export type BulkLinkRef = { customerOrderId: string | null; customerOrderLineId: string | null } | null;

/**
 * ربط جماعي للأتواب بأوردر (ملاحظة بشير): اختيار الأتواب كلها أو حسب الخامة أو حسب اللون أو المحددة بالمربعات،
 * ثم ربطها دفعة واحدة بأوردر وسطر لون، أو بالمخزون العام، أو إزالة الربط. يبقى تغيير ثوب بعينه ممكناً من صفه.
 */
export function ExternalBulkOrderLink({ rolls, checkedIds, onApply }: {
  rolls: FabricRollDto[];
  checkedIds: Set<string>;
  onApply: (rollIds: string[], ref: BulkLinkRef, label: string) => void;
}) {
  const { t } = useTranslation('externalJobs');
  const [scope, setScope] = useState<Scope>('ALL');
  const [itemKey, setItemKey] = useState('');
  const [colorKey, setColorKey] = useState('__none__');
  const [target, setTarget] = useState<Target>('order');
  const [search, setSearch] = useState('');
  const [choices, setChoices] = useState<ExternalOrderChoice[]>([]);
  const [lineId, setLineId] = useState('');
  const [error, setError] = useState('');

  const items = useMemo(() => {
    const m = new Map<string, { name: string; count: number; meters: number }>();
    for (const r of rolls) {
      const e = m.get(r.item_id) ?? { name: (r as { item_name?: string }).item_name ?? r.item_id, count: 0, meters: 0 };
      e.count += 1; e.meters += Number(r.length_m) || 0; m.set(r.item_id, e);
    }
    return [...m.entries()];
  }, [rolls]);
  const colors = useMemo(() => {
    const m = new Map<string, { name: string; count: number; meters: number }>();
    for (const r of rolls) {
      const key = r.color_id ?? '';
      const label = [(r as { color_name_ar?: string }).color_name_ar, (r as { color_code?: string }).color_code].filter(Boolean).join(' ') || t('traceability.noColor');
      const e = m.get(key) ?? { name: label, count: 0, meters: 0 };
      e.count += 1; e.meters += Number(r.length_m) || 0; m.set(key, e);
    }
    return [...m.entries()];
  }, [rolls, t]);

  const inScope = useMemo(() => rolls.filter((r) => {
    if (scope === 'ALL') return true;
    if (scope === 'ITEM') return !!itemKey && r.item_id === itemKey;
    if (scope === 'COLOR') return colorKey !== '__none__' && (r.color_id ?? '') === colorKey;
    return checkedIds.has(r.id);
  }), [rolls, scope, itemKey, colorKey, checkedIds]);

  useEffect(() => {
    if (target !== 'order') return;
    let active = true;
    const timer = window.setTimeout(() => {
      searchExternalOrderLines(search).then((r) => { if (active) { setChoices(r.data); setError(''); } })
        .catch((e) => { if (active) { setChoices([]); setError(String(e.message)); } });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, target]);

  const choice = choices.find((c) => c.line_id === lineId);
  const canApply = inScope.length > 0 && (target !== 'order' || !!choice) && (scope !== 'ITEM' || !!itemKey) && (scope !== 'COLOR' || colorKey !== '__none__');

  const apply = () => {
    const ids = inScope.map((r) => r.id);
    if (target === 'order' && choice) {
      onApply(ids, { customerOrderId: choice.order_id, customerOrderLineId: choice.line_id }, `${choice.order_no} / ${choice.color_name} ${choice.color_code}`.trim());
    } else if (target === 'stock') onApply(ids, { customerOrderId: null, customerOrderLineId: null }, t('traceability.stock'));
    else onApply(ids, null, '');
  };

  const field = 'border rounded p-2 text-sm w-full bg-white';
  return (
    <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3" aria-label={t('traceability.bulkTitle')}>
      <h4 className="font-bold text-indigo-900">{t('traceability.bulkTitle')}</h4>
      <p className="text-xs text-slate-600">{t('traceability.bulkHint')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs font-bold text-slate-700">{t('traceability.bulkScope')}
          <select className={field} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="ALL">{t('traceability.scopeAll')}</option>
            <option value="ITEM">{t('traceability.scopeItem')}</option>
            <option value="COLOR">{t('traceability.scopeColor')}</option>
            <option value="CHECKED">{t('traceability.scopeChecked', { count: checkedIds.size })}</option>
          </select>
        </label>
        {scope === 'ITEM' && (
          <label className="text-xs font-bold text-slate-700">{t('traceability.pickItem')}
            <select className={field} value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
              <option value="">—</option>
              {items.map(([k, v]) => <option key={k} value={k}>{v.name} — {v.count} / {v.meters.toFixed(2)}</option>)}
            </select>
          </label>
        )}
        {scope === 'COLOR' && (
          <label className="text-xs font-bold text-slate-700">{t('traceability.pickColor')}
            <select className={field} value={colorKey} onChange={(e) => setColorKey(e.target.value)}>
              <option value="__none__">—</option>
              {colors.map(([k, v]) => <option key={k || 'nocolor'} value={k}>{v.name} — {v.count} / {v.meters.toFixed(2)}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs font-bold text-slate-700">{t('traceability.bulkTarget')}
          <select className={field} value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            <option value="order">{t('traceability.targetOrder')}</option>
            <option value="stock">{t('traceability.targetStock')}</option>
            <option value="inherit">{t('traceability.targetInherit')}</option>
          </select>
        </label>
      </div>
      {target === 'order' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input aria-label={t('traceability.search')} placeholder={t('traceability.search')} className={field} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label={t('traceability.order')} className={field} value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">{t('traceability.chooseOrderLine')}</option>
            {choices.map((c) => <option key={c.line_id} value={c.line_id}>{c.order_no} / {c.customer_name} / {c.line_no} / {c.material_name} / {c.color_name} {c.color_code}</option>)}
          </select>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-600">{t('traceability.inScope', { count: inScope.length })}</span>
        <button type="button" disabled={!canApply} onClick={apply} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {t('traceability.apply')}
        </button>
      </div>
    </section>
  );
}
