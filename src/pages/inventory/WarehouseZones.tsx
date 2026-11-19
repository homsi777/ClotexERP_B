import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import {
  addZone, assignZoneRolls, getZoneContents, getZoneSummary, pickZoneRolls, renameZone, setZonesEnabled,
  type ZoneContents, type ZoneRoll, type ZoneScope, type ZoneSummary,
} from '../../lib/api/warehouseZonesApi';
import { useToast } from '../../components/NonBlockingToast';

const n2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
type Source = { kind: 'PENDING' } | { kind: 'ZONE'; zoneId: string };
type Mode = 'ITEM' | 'COLOR' | 'ROLLS';

export const WarehouseZones: React.FC = () => {
  const { t } = useTranslation('warehouseZones');
  const { showToast } = useToast();
  const [params] = useSearchParams();
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') ?? '');
  const [summary, setSummary] = useState<ZoneSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<Source>({ kind: 'PENDING' });
  const [contents, setContents] = useState<ZoneContents | null>(null);
  const [mode, setMode] = useState<Mode>('ITEM');
  const [itemId, setItemId] = useState('');
  const [colorKey, setColorKey] = useState('');
  const [scan, setScan] = useState('');
  const [selected, setSelected] = useState<Record<string, ZoneRoll>>({});
  const [dest, setDest] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listWarehouses({ status: 'active' }).then((w) => {
      setWarehouses(w);
      setWarehouseId((cur) => cur || w[0]?.id || '');
    }).catch(() => undefined);
  }, []);

  const scope: ZoneScope = source.kind === 'PENDING' ? { type: 'PENDING' } : { type: 'ZONE', zoneId: source.zoneId };
  const expectedFrom = source.kind === 'PENDING' ? 'PENDING' : source.zoneId;

  const reload = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    try {
      const s = await getZoneSummary(warehouseId);
      setSummary(s);
      if (s.zonesEnabled) setContents(await getZoneContents(warehouseId, source.kind === 'ZONE' ? source.zoneId : null));
      else setContents(null);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [warehouseId, source, showToast, t]);

  useEffect(() => { void reload(); setSelected({}); setItemId(''); setColorKey(''); }, [reload]);

  const items = useMemo(() => {
    const m = new Map<string, string>();
    contents?.groups.forEach((g) => m.set(g.itemId, g.itemName));
    return [...m.entries()];
  }, [contents]);
  const colors = useMemo(
    () => (contents?.groups ?? []).filter((g) => g.itemId === itemId).map((g) => ({ key: g.colorId ?? 'none', id: g.colorId, name: g.colorName || g.colorCode || t('noColor'), count: g.rolls.length })),
    [contents, itemId, t],
  );

  const mergeRolls = (rolls: ZoneRoll[]) => setSelected((p) => ({ ...p, ...Object.fromEntries(rolls.map((r) => [r.id, r])) }));

  const pickByMode = async () => {
    try {
      if (mode === 'ITEM' && itemId) {
        const r = await pickZoneRolls(warehouseId, scope, { mode: 'ITEM', itemId });
        mergeRolls(r.rolls);
      } else if (mode === 'COLOR' && itemId && colorKey) {
        const r = await pickZoneRolls(warehouseId, scope, { mode: 'COLOR', itemId, colorId: colorKey === 'none' ? null : colorKey });
        mergeRolls(r.rolls);
      }
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('pickFailed') });
    }
  };
  const addBarcode = async () => {
    const code = scan.trim();
    if (!code) return;
    try {
      const r = await pickZoneRolls(warehouseId, scope, { mode: 'ROLLS', barcodes: [code] });
      if (r.rolls.length) mergeRolls(r.rolls); else showToast({ type: 'warning', message: t('notInScope', { barcode: code }) });
      setScan('');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('pickFailed') });
    }
  };

  const picked = Object.values(selected);
  const totals = { count: picked.length, meters: picked.reduce((s, r) => s + r.length_m, 0), weight: picked.reduce((s, r) => s + (r.weight_kg ?? 0), 0) };

  const confirm = async () => {
    if (!dest || !picked.length) return;
    setSaving(true);
    try {
      const r = await assignZoneRolls({ warehouseId, toZoneId: dest, rollIds: picked.map((p) => p.id), expectedFrom });
      showToast({ type: 'success', message: t('assigned', { count: r.movedCount, zone: r.toZone }) });
      setSelected({});
      await reload();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('assignFailed') });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async () => {
    if (!summary) return;
    try {
      await setZonesEnabled(warehouseId, !summary.zonesEnabled);
      await reload();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('loadFailed') });
    }
  };
  const createZone = async () => {
    if (!newName.trim()) return;
    try {
      await addZone(warehouseId, newName.trim());
      setNewName('');
      await reload();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('addFailed') });
    }
  };
  const rename = async (z: ZoneSummary['zones'][number]) => {
    const name = window.prompt(t('renamePrompt'), z.name)?.trim();
    if (!name || name === z.name) return;
    try { await renameZone(z.id, z.code, name); await reload(); } catch (e) { showToast({ type: 'error', message: e instanceof Error ? e.message : t('addFailed') }); }
  };

  const cardCls = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm';
  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setSource({ kind: 'PENDING' }); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-[12rem]">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        </div>
      </div>

      {summary && (
        <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <p className="font-bold text-slate-900">{t('enableTitle')}</p>
            <p className="text-xs text-slate-500">{t('enableHelp')}</p>
          </div>
          <button type="button" onClick={() => void toggleEnabled()}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${summary.zonesEnabled ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>
            {summary.zonesEnabled ? t('enabled') : t('disabled')}
          </button>
        </div>
      )}

      {summary?.zonesEnabled && (
        <>
          {summary.unassigned.rolls > 0 && (
            <button type="button" onClick={() => setSource({ kind: 'PENDING' })}
              className="flex w-full items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-right text-amber-900">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-bold">{t('pendingAlert', { count: summary.unassigned.rolls })}</span>
              <span className="text-xs">({n2(summary.unassigned.meters)} {t('meter')}) — {t('pendingHint')}</span>
            </button>
          )}

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button type="button" onClick={() => setSource({ kind: 'PENDING' })}
              className={`${cardCls} text-right ${source.kind === 'PENDING' ? 'ring-2 ring-amber-400' : ''}`}>
              <p className="text-xs font-bold text-amber-700">{t('unassigned')}</p>
              <p className="text-2xl font-black">{summary.unassigned.rolls}</p><p className="text-xs text-slate-500">{n2(summary.unassigned.meters)} {t('meter')}</p>
            </button>
            {summary.zones.map((z) => (
              <div key={z.id} className={`${cardCls} ${source.kind === 'ZONE' && source.zoneId === z.id ? 'ring-2 ring-indigo-400' : ''}`}>
                <button type="button" onClick={() => setSource({ kind: 'ZONE', zoneId: z.id })} className="w-full text-right">
                  <p className="text-xs font-bold text-indigo-700">{z.name}</p>
                  <p className="text-2xl font-black">{z.rolls}</p><p className="text-xs text-slate-500">{n2(z.meters)} {t('meter')}</p>
                </button>
                <button type="button" onClick={() => void rename(z)} className="mt-1 text-xs text-slate-500 underline">{t('rename')}</button>
              </div>
            ))}
            <div className={`${cardCls} flex items-center gap-2`}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void createZone()} placeholder={t('newZonePlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <button type="button" onClick={() => void createZone()} className="rounded-lg bg-slate-900 p-2 text-white"><Plus className="h-4 w-4" /></button>
            </div>
          </section>

          <section className={`${cardCls} space-y-4`}>
            <h2 className="font-bold text-slate-900">
              {source.kind === 'PENDING' ? t('assignTitle') : t('moveTitle', { zone: summary.zones.find((z) => z.id === (source as { zoneId: string }).zoneId)?.name ?? '' })}
            </h2>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold">
              {(['ITEM', 'COLOR', 'ROLLS'] as Mode[]).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={`px-4 py-2 ${mode === m ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{t(`mode.${m}`)}</button>
              ))}
            </div>

            {(mode === 'ITEM' || mode === 'COLOR') && (
              <div className="flex flex-wrap items-end gap-2">
                <select value={itemId} onChange={(e) => { setItemId(e.target.value); setColorKey(''); }} className="rounded-lg border border-slate-300 px-2 py-2 text-sm min-w-[12rem]">
                  <option value="">{t('chooseItem')}</option>
                  {items.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                {mode === 'COLOR' && (
                  <select value={colorKey} onChange={(e) => setColorKey(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm min-w-[10rem]">
                    <option value="">{t('chooseColor')}</option>
                    {colors.map((c) => <option key={c.key} value={c.key}>{c.name} ({c.count})</option>)}
                  </select>
                )}
                <button type="button" onClick={() => void pickByMode()} disabled={!itemId || (mode === 'COLOR' && !colorKey)}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t('addToSelection')}</button>
              </div>
            )}
            {mode === 'ROLLS' && (
              <div className="flex gap-2">
                <input value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addBarcode()} placeholder={t('scanPlaceholder')}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" dir="ltr" />
                <button type="button" onClick={() => void addBarcode()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">{t('add')}</button>
              </div>
            )}

            <div className="rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 p-3 text-sm">
                <span className="font-bold">{t('selected', { count: totals.count })} — {n2(totals.meters)} {t('meter')} — {n2(totals.weight)} {t('kg')}</span>
                {picked.length > 0 && <button type="button" onClick={() => setSelected({})} className="text-xs text-rose-600 underline">{t('clear')}</button>}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {picked.length === 0 && <p className="p-4 text-center text-sm text-slate-500">{t('nothingSelected')}</p>}
                {picked.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5 text-sm first:border-0">
                    <span className="font-mono" dir="ltr">{r.barcode}</span>
                    <span>{r.item_name} — {r.color_name || r.color_code || t('noColor')}</span>
                    <span className="text-xs text-slate-500">{n2(r.length_m)} {t('meter')} / {r.weight_kg != null ? n2(r.weight_kg) : '—'} {t('kg')}</span>
                    <button type="button" onClick={() => setSelected((p) => { const { [r.id]: _x, ...rest } = p; return rest; })} className="text-rose-600">×</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="text-xs font-bold text-slate-600">{t('destination')}</span>
                <select value={dest} onChange={(e) => setDest(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-2 text-sm min-w-[12rem]">
                  <option value="">—</option>
                  {summary.zones.filter((z) => z.is_active && !(source.kind === 'ZONE' && source.zoneId === z.id)).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select></label>
              <button type="button" onClick={() => void confirm()} disabled={!dest || !picked.length || saving}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}{t('confirm', { count: totals.count })}
              </button>
            </div>
          </section>

          <section className={cardCls}>
            <h2 className="mb-2 font-bold text-slate-900">{t('contents')} — {contents ? `${contents.totals.count} ${t('rolls')} / ${n2(contents.totals.meters)} ${t('meter')}` : ''}</h2>
            <div className="space-y-2">
              {contents?.groups.length === 0 && <p className="text-sm text-slate-500">{t('emptyZone')}</p>}
              {contents?.groups.map((g) => (
                <details key={`${g.itemId}-${g.colorId}`} className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer p-2.5 text-sm font-bold">
                    {g.itemName} — {g.colorName || g.colorCode || t('noColor')} <span className="font-normal text-slate-500">({g.totals.count} {t('rolls')}, {n2(g.totals.meters)} {t('meter')}, {n2(g.totals.weightKg)} {t('kg')})</span>
                  </summary>
                  <div className="border-t border-slate-100 p-2 text-xs">
                    {g.rolls.map((r) => <span key={r.id} className="m-1 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono" dir="ltr">{r.barcode} · {n2(r.length_m)}m</span>)}
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
