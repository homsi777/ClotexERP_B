import { useCallback, useEffect, useState } from 'react';
import * as api from '../../lib/api/managementApi';
import type { CostGroup, CostRoll, PeriodQuery, ProfitDimension, Profitability, RateHistoryRow } from '../../lib/api/managementApi';
import { ChartCard, CurrencyTabs, HBars } from './charts';
import { ErrorLine, errMsg, nf } from './kit';

const DIMS: Array<[ProfitDimension, string]> = [['item', 'الخامة'], ['color', 'اللون'], ['roll', 'التوب'], ['customer', 'العميل'], ['invoice', 'الفاتورة'], ['creator', 'المندوب (منشئ الفاتورة)']];
type Sub = 'profit' | 'pricing' | 'delegates';

/** القسم السري: للمالك أو لمن فوّضه صراحةً فقط (يفرضه الخادم). ربحية إدارية تقديرية وليست صافي الربح المحاسبي. */
export function AdminCostSection({ branchId, period, isOwner }: { branchId: string; period: PeriodQuery; isOwner: boolean }) {
  const [sub, setSub] = useState<Sub>('profit');
  return <div className="space-y-3">
    <p className="rounded-lg p-2 text-xs" style={{ background: 'var(--cx-warn-bg)', color: 'var(--cx-warn)' }}>قسم سرّي للمالك: ربحية إدارية تقديرية وليست صافي الربح المحاسبي. لا يؤثر على المحاسبة ولا الذمم ولا تقييم المخزون الرسمي، وتُحفظ التكلفة لحظة اعتماد البيع فلا تتغير أرباح الماضي بتغيّرها لاحقاً.</p>
    <div className="cx-hscroll">{([['profit', 'الربحية'], ['pricing', 'التسعير الإداري'], ...(isOwner ? [['delegates', 'التفويض']] : [])] as Array<[Sub, string]>).map(([k, l]) => <button key={k} type="button" aria-pressed={sub === k} className="cx-chip" onClick={() => setSub(k)}>{l}</button>)}</div>
    {sub === 'profit' && <ProfitView branchId={branchId} period={period} />}
    {sub === 'pricing' && <PricingView branchId={branchId} />}
    {sub === 'delegates' && isOwner && <DelegatesView branchId={branchId} />}
  </div>;
}

function ProfitView({ branchId, period }: { branchId: string; period: PeriodQuery }) {
  const [by, setBy] = useState<ProfitDimension>('item'), [p, setP] = useState<Profitability | null>(null), [err, setErr] = useState(''), [ccy, setCcy] = useState('');
  useEffect(() => { setP(null); api.fetchProfitability(branchId, period, by).then(setP).catch((e) => setErr(errMsg(e))); }, [branchId, period, by]);
  if (err) return <ErrorLine msg={err} />;
  if (!p) return <p className="cx-muted text-sm">جارٍ التحميل…</p>;
  const ccys = [...new Set([...p.byCurrency, ...p.breakdown].map((r) => r.currency))].sort();
  const cur = ccys.includes(ccy) ? ccy : ccys[0] ?? '';
  return <div className="space-y-3">
    <div className="cx-grid">{p.byCurrency.map((r) => <div key={r.currency} className={`cx-tile cx-wide ${r.profit < 0 ? 'bad' : 'good'}`}><div className="l">صافي الربح الإداري التقديري — {r.currency}</div><div className="v num">{nf(r.profit, 2)}{r.marginPct != null && <span className="u">({nf(r.marginPct, 1)}%)</span>}</div><div className="h num">إيراد {nf(r.revenue, 2)} − تكلفة {nf(r.cost, 2)} · {r.pricedLines} سطر مُسعَّر</div></div>)}
      {!p.byCurrency.length && <p className="cx-muted cx-wide text-sm">لا مبيعات مُسعَّرة إدارياً في الفترة، فلا ربحية تُعرض (لا نفترض تكلفة صفرية).</p>}
      {p.belowCost.map((b) => <div key={b.currency} className={`cx-tile ${b.lines ? 'bad' : 'good'}`}><div className="l">مبيعات تحت التكلفة الإدارية — {b.currency}</div><div className="v num">{b.lines} <span className="u">سطر</span></div><div className="h num">خسارة تقديرية {nf(b.loss, 2)}</div></div>)}
      {p.unpriced.map((u) => <div key={u.currency} className="cx-tile warn"><div className="l">مبيعات بلا تكلفة إدارية (مستبعدة) — {u.currency}</div><div className="v num">{nf(u.revenue, 2)}</div><div className="h num">{u.lines} سطر · {u.sharePct != null ? `${nf(u.sharePct, 1)}% من مبيعات الفترة` : ''}</div></div>)}</div>
    {(p.returns.counted.length > 0 || p.returns.excluded > 0 || p.currencyMismatch > 0) && <p className="cx-muted text-xs">
      {p.returns.counted.length > 0 && <>مرتجعات محسومة: {p.returns.counted.map((r) => `${nf(r.revenue, 2)} ${r.currency} (تكلفتها ${nf(r.cost, 2)})`).join(' · ')}. </>}
      {p.returns.excluded > 0 && <>{p.returns.excluded} سطر مرتجع بلا لقطة تكلفة مطابقة — مستبعد. </>}
      {p.currencyMismatch > 0 && <>{p.currencyMismatch} سطراً بعملة تكلفة تخالف عملة البيع — مستبعد (لا تحويل بين العملات).</>}</p>}
    <div className="cx-hscroll">{DIMS.map(([k, l]) => <button key={k} type="button" aria-pressed={by === k} className="cx-chip" onClick={() => setBy(k)}>حسب {l}</button>)}</div>
    <ChartCard title={`الربحية حسب ${DIMS.find((d) => d[0] === by)![1]}`} right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />} empty={!ccys.length ? 'لا بيانات مُسعَّرة.' : undefined}>
      <HBars unit={cur} legend={['الربح']} items={p.breakdown.filter((r) => r.currency === cur).slice(0, 12).map((r) => ({ label: `${r.label}${r.marginPct != null ? ` (${nf(r.marginPct, 0)}%)` : ''}`, values: [r.profit] }))} />
      <div className="mt-3 overflow-x-auto"><table className="cx-tbl"><thead><tr><th>{DIMS.find((d) => d[0] === by)![1]}</th><th>إيراد</th><th>تكلفة</th><th>ربح</th><th>هامش</th></tr></thead><tbody>
        {p.breakdown.filter((r) => r.currency === cur).map((r) => <tr key={r.label} className="num"><td dir="rtl">{r.label}</td><td>{nf(r.revenue, 2)}</td><td>{nf(r.cost, 2)}</td><td style={{ color: r.profit < 0 ? 'var(--cx-bad)' : undefined, fontWeight: 700 }}>{nf(r.profit, 2)}</td><td>{r.marginPct != null ? `${nf(r.marginPct, 1)}%` : '—'}</td></tr>)}</tbody></table></div>
    </ChartCard>
    <ul className="cx-muted list-disc pe-5 text-xs">{p.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
  </div>;
}

function PricingView({ branchId }: { branchId: string }) {
  const [groups, setGroups] = useState<CostGroup[]>([]), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true), [search, setSearch] = useState('');
  const [cur, setCur] = useState('USD'), [basis, setBasis] = useState<'METER' | 'KG'>('METER'), [edit, setEdit] = useState<Record<string, string>>({}), [sel, setSel] = useState<Set<string>>(new Set()), [bulk, setBulk] = useState('');
  const [drill, setDrill] = useState<CostGroup | null>(null);
  const gk = (g: CostGroup) => `${g.itemId}|${g.colorId ?? ''}`;
  const load = useCallback(async () => { setErr(''); try { setGroups(await api.fetchCostGroups(branchId, { onlyMissing, search })); } catch (e) { setErr(errMsg(e)); } }, [branchId, onlyMissing, search]);
  useEffect(() => { void load(); }, [load]);
  const apply = async (items: Array<{ g: CostGroup; v: number }>, level: 'ITEM' | 'ITEM_COLOR') => {
    if (!items.length) return;
    try {
      const rates = items.map(({ g, v }) => ({ scope: level, itemId: g.itemId, colorId: level === 'ITEM_COLOR' ? g.colorId : null, unitCostPerMeter: v, basis, currency: cur }));
      await api.saveCostRates(branchId, rates); setOk(`تم حفظ ${rates.length} سعراً (يسري من الآن، ولا يغيّر مبيعات سابقة)`); setEdit({}); setSel(new Set()); setBulk(''); await load();
    } catch (e) { setErr(errMsg(e)); }
  };
  return <div className="space-y-3">
    <ErrorLine msg={err} />{ok && <p className="text-sm font-bold" style={{ color: 'var(--cx-good)' }}>{ok}</p>}
    <div className="cx-card flex flex-wrap items-center gap-2 p-2 text-sm">
      <label className="flex items-center gap-1"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> غير المسعَّر فقط</label>
      <input placeholder="بحث خامة/كود" value={search} onChange={(e) => setSearch(e.target.value)} className="cx-input" />
      <select value={basis} onChange={(e) => setBasis(e.target.value as 'METER' | 'KG')} className="cx-input"><option value="METER">بالمتر</option><option value="KG">بالكيلو</option></select>
      <input value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} className="cx-input w-20 num" aria-label="العملة" />
      <span className="cx-muted text-xs">التكلفة سارية من لحظة الحفظ. الأولوية: التوب ثم اللون ثم الخامة.</span>
    </div>
    <div className="cx-card flex flex-wrap items-center gap-2 p-2 text-sm">
      <b className="text-xs">تسعير دفعة واحدة للمحدَّد ({sel.size})</b>
      <input type="number" min="0" step="0.0001" placeholder={basis === 'KG' ? 'سعر الكيلو' : 'سعر المتر'} value={bulk} onChange={(e) => setBulk(e.target.value)} className="cx-input num w-28" />
      <button type="button" className="cx-btn cx-btn-primary" disabled={!sel.size || !(Number(bulk) > 0)} onClick={() => void apply(groups.filter((g) => sel.has(gk(g))).map((g) => ({ g, v: Number(bulk) })), 'ITEM_COLOR')}>تطبيق على الألوان المحدَّدة</button>
      <button type="button" className="cx-btn" disabled={!sel.size || !(Number(bulk) > 0)} onClick={() => { const seen = new Set<string>(); void apply(groups.filter((g) => sel.has(gk(g)) && !seen.has(g.itemId) && seen.add(g.itemId)).map((g) => ({ g, v: Number(bulk) })), 'ITEM'); }}>تطبيق على الخامات كاملة</button>
      <button type="button" className="cx-btn" onClick={() => setSel(new Set(groups.map(gk)))}>تحديد الكل</button>
    </div>
    <div className="cx-card max-h-[28rem] overflow-auto p-2"><table className="cx-tbl"><thead><tr><th /><th>الخامة</th><th>اللون</th><th>أتواب</th><th>أمتار</th><th>التكلفة الحالية</th><th>سعر خامة/لون جديد</th><th /></tr></thead><tbody>
      {groups.map((g) => <tr key={gk(g)}>
        <td><input type="checkbox" checked={sel.has(gk(g))} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(gk(g))) n.delete(gk(g)); else n.add(gk(g)); return n; })} /></td>
        <td>{g.itemName}</td><td>{g.colorName ?? '—'}</td><td className="num">{g.rolls}</td><td className="num">{nf(g.meters, 1)}</td>
        <td className="num">{g.adminRate ? `${nf(g.adminRate.unitCostPerMeter, 4)} ${g.adminRate.currency}/${g.adminRate.basis === 'KG' ? 'كغ' : 'م'} (${g.adminRate.scope === 'ITEM' ? 'خامة' : g.adminRate.scope === 'ITEM_COLOR' ? 'لون' : 'توب'})` : <span style={{ color: 'var(--cx-warn)' }}>غير مُسعَّر{g.officialPricedRolls === 0 ? ' (رصيد افتتاحي)' : ''}</span>}</td>
        <td><input type="number" min="0" step="0.0001" value={edit[gk(g)] ?? ''} onChange={(e) => setEdit({ ...edit, [gk(g)]: e.target.value })} className="cx-input num w-24" /></td>
        <td className="whitespace-nowrap"><button type="button" className="cx-btn" onClick={() => void apply([{ g, v: Number(edit[gk(g)]) }].filter((x) => x.v > 0), g.colorId ? 'ITEM_COLOR' : 'ITEM')}>حفظ</button> <button type="button" className="cx-btn" onClick={() => setDrill(g)}>أتواب / سجل</button></td></tr>)}
      {!groups.length && <tr><td colSpan={8} className="cx-muted p-4 text-center">لا نتائج.</td></tr>}</tbody></table></div>
    {drill && <RollDrill branchId={branchId} g={drill} basis={basis} cur={cur} onClose={() => { setDrill(null); void load(); }} />}
  </div>;
}

function RollDrill({ branchId, g, basis, cur, onClose }: { branchId: string; g: CostGroup; basis: 'METER' | 'KG'; cur: string; onClose: () => void }) {
  const [rolls, setRolls] = useState<CostRoll[]>([]), [hist, setHist] = useState<RateHistoryRow[]>([]), [only, setOnly] = useState(false), [vals, setVals] = useState<Record<string, string>>({}), [err, setErr] = useState('');
  const load = useCallback(async () => { try { setRolls(await api.fetchCostRolls(branchId, g.itemId, g.colorId, only)); setHist(await api.fetchRateHistory(branchId, g.itemId)); } catch (e) { setErr(errMsg(e)); } }, [branchId, g, only]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    const rates = rolls.filter((r) => Number(vals[r.rollId]) > 0).map((r) => ({ scope: 'ROLL' as const, rollId: r.rollId, unitCostPerMeter: Number(vals[r.rollId]), basis, currency: cur }));
    if (!rates.length) return;
    try { await api.saveCostRates(branchId, rates); setVals({}); await load(); } catch (e) { setErr(errMsg(e)); }
  };
  return <div className="cx-card space-y-3 p-3">
    <div className="flex items-center justify-between"><b style={{ color: 'var(--cx-brand)' }}>{g.itemName}{g.colorName ? ` — ${g.colorName}` : ''}: تسعير أتواب منفردة وسجل التعديلات</b><button type="button" className="cx-btn" onClick={onClose}>إغلاق</button></div>
    <ErrorLine msg={err} />
    <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> غير المسعَّرة فقط</label>
    <div className="max-h-64 overflow-auto"><table className="cx-tbl"><thead><tr><th>الباركود</th><th>أمتار</th><th>وزن (كغ)</th><th>التكلفة الحالية</th><th>سعر التوب ({basis === 'KG' ? 'للكيلو' : 'للمتر'})</th></tr></thead><tbody>
      {rolls.map((r) => <tr key={r.rollId}><td className="num">{r.barcode}</td><td className="num">{nf(r.meters, 2)}</td><td className="num">{r.kg != null ? nf(r.kg, 1) : '—'}</td><td className="num">{r.rate ? `${nf(r.rate.cost, 4)} ${r.rate.currency}/${r.rate.basis === 'KG' ? 'كغ' : 'م'}` : '—'}</td><td><input type="number" min="0" step="0.0001" className="cx-input num w-24" value={vals[r.rollId] ?? ''} onChange={(e) => setVals({ ...vals, [r.rollId]: e.target.value })} /></td></tr>)}</tbody></table></div>
    <button type="button" className="cx-btn cx-btn-primary" onClick={() => void save()}>حفظ أسعار الأتواب</button>
    <details><summary className="cursor-pointer text-sm font-bold">سجل تعديلات التكلفة ({hist.length})</summary>
      <table className="cx-tbl mt-2"><thead><tr><th>التاريخ</th><th>النطاق</th><th>القيمة</th><th>بواسطة</th></tr></thead><tbody>{hist.map((h, i) => <tr key={i}><td className="num">{h.since.slice(0, 16)}</td><td>{h.scope === 'ITEM' ? 'خامة' : h.scope === 'ITEM_COLOR' ? `لون ${h.color ?? ''}` : `توب ${h.barcode ?? ''}`}</td><td className="num">{nf(h.cost, 4)} {h.currency}/{h.basis === 'KG' ? 'كغ' : 'م'}</td><td>{h.by ?? '—'}</td></tr>)}</tbody></table></details>
  </div>;
}

function DelegatesView({ branchId }: { branchId: string }) {
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]), [sel, setSel] = useState<Set<string>>(new Set()), [err, setErr] = useState(''), [ok, setOk] = useState('');
  useEffect(() => { void Promise.all([api.fetchBranchUsers(branchId), api.fetchDelegates(branchId)]).then(([u, d]) => { setUsers(u); setSel(new Set(d.map((x) => x.user_id))); }).catch((e) => setErr(errMsg(e))); }, [branchId]);
  const save = async () => { try { await api.saveDelegates(branchId, [...sel]); setOk('تم حفظ التفويض'); } catch (e) { setErr(errMsg(e)); } };
  return <div className="space-y-2">
    <p className="rounded-lg p-2 text-xs" style={{ background: 'var(--cx-bad-bg)', color: 'var(--cx-bad)' }}>لا يحصل أي مستخدم (مدير فرع/مدير نظام/محاسب/مدير مبيعات) على التكلفة أو الربحية تلقائياً. التفويض صريح، لفرع واحد، ولا يمنح لوحة المالك. اتركه فارغاً ما لم توافق بنفسك.</p>
    <ErrorLine msg={err} />{ok && <p className="text-sm font-bold" style={{ color: 'var(--cx-good)' }}>{ok}</p>}
    <div className="cx-card p-2">{users.map((u) => <label key={u.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" checked={sel.has(u.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; })} />{u.name}</label>)}</div>
    <button type="button" className="cx-btn cx-btn-primary" onClick={() => void save()}>حفظ التفويض</button>
  </div>;
}
