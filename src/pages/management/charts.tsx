import { useState } from 'react';
import type { ReactNode } from 'react';
import { nf } from './kit';

/** رسوم SVG خفيفة بلا مكتبات: كل رسم لعملة واحدة (لا خلط عملات)، وتعرض سبب غياب البيانات بدل أرقام وهمية. */
export const PALETTE = ['#35505f', '#ffb03a', '#4f9d8f', '#b5654a', '#7a8fa0', '#c9a227'];

export function ChartCard({ title, note, empty, children, right }: { title: string; note?: string; empty?: string; children: ReactNode; right?: ReactNode }) {
  return <div className="cx-card p-3">
    <div className="mb-2 flex items-center justify-between gap-2"><b className="text-sm" style={{ color: 'var(--cx-brand)' }}>{title}</b>{right}</div>
    {empty ? <p className="cx-muted py-8 text-center text-xs">{empty}</p> : children}
    {note && <p className="cx-muted mt-2 text-[.68rem]">{note}</p>}
  </div>;
}

export function CurrencyTabs({ currencies, value, onChange }: { currencies: string[]; value: string; onChange: (c: string) => void }) {
  if (currencies.length <= 1) return currencies[0] ? <span className="cx-badge neutral">{currencies[0]}</span> : null;
  return <div className="cx-hscroll">{currencies.map((c) => <button key={c} type="button" aria-pressed={value === c} className="cx-chip" onClick={() => onChange(c)}>{c}</button>)}</div>;
}

type Pt = { x: string; y: number };
export interface LineSeries { name: string; color: string; points: Pt[] }

const W = 320, H = 150, PL = 38, PR = 8, PT = 10, PB = 22;

/** منحنى خطوط (نقاط فعلية فقط). */
export function LineChart({ series, unit }: { series: LineSeries[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y)));
  const sx = (i: number) => PL + (xs.length <= 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (xs.length - 1));
  const sy = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return <div dir="ltr">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 230 }} role="img" aria-label="منحنى">
      {ticks.map((t) => <g key={t}><line x1={PL} x2={W - PR} y1={sy(t)} y2={sy(t)} stroke="#e3e8ec" /><text x={PL - 4} y={sy(t) + 3} fontSize="8" textAnchor="end" fill="#66767f">{nf(t, t >= 100 ? 0 : 1)}</text></g>)}
      {series.map((s) => {
        const pts = xs.map((x, i) => ({ i, p: s.points.find((q) => q.x === x) })).filter((q) => q.p);
        return <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" points={pts.map((q) => `${sx(q.i)},${sy(q.p!.y)}`).join(' ')} />
          {pts.map((q) => <circle key={q.i} cx={sx(q.i)} cy={sy(q.p!.y)} r={hover === q.i ? 3.5 : 2} fill={s.color} />)}
        </g>;
      })}
      {xs.map((x, i) => (xs.length <= 8 || i % Math.ceil(xs.length / 6) === 0) && <text key={x} x={sx(i)} y={H - 6} fontSize="8" textAnchor="middle" fill="#66767f">{x.slice(5)}</text>)}
      {xs.map((x, i) => <rect key={x} x={sx(i) - 8} y={0} width={16} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)} />)}
    </svg>
    <div className="flex flex-wrap items-center gap-3 text-[.7rem]" dir="rtl">
      {series.map((s) => <span key={s.name} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
      {hover !== null && <span className="cx-muted num">{xs[hover]} · {series.map((s) => `${s.name} ${nf(s.points.find((p) => p.x === xs[hover])?.y ?? 0, 2)} ${unit}`).join(' · ')}</span>}
    </div>
  </div>;
}

export interface BarItem { label: string; values: number[]; href?: string }
/** أعمدة أفقية (تجميعية أو متجاورة) بقيم فعلية. */
export function HBars({ items, legend, unit, stacked = false, onPick }: { items: BarItem[]; legend: string[]; unit?: string; stacked?: boolean; onPick?: (it: BarItem) => void }) {
  const max = Math.max(1e-9, ...items.map((i) => (stacked ? i.values.reduce((a, b) => a + b, 0) : Math.max(...i.values))));
  return <div className="space-y-1.5">
    {items.map((it) => <div key={it.label} className={onPick ? 'cursor-pointer' : ''} onClick={() => onPick?.(it)}>
      <div className="flex justify-between gap-2 text-[.72rem]"><span className="truncate">{it.label}</span><span className="num cx-muted">{it.values.map((v) => nf(v, v % 1 ? 2 : 0)).join(' / ')}{unit ? ` ${unit}` : ''}</span></div>
      {stacked
        ? <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--cx-neutral-bg)', direction: 'ltr' }}>{it.values.map((v, i) => <div key={i} style={{ width: `${(v / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} />)}</div>
        : it.values.map((v, i) => <div key={i} className="mt-0.5 h-2 rounded-full" style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, background: PALETTE[i % PALETTE.length] }} />)}
    </div>)}
    {legend.length > 1 && <div className="flex flex-wrap gap-3 pt-1 text-[.68rem]">{legend.map((l, i) => <span key={l} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{l}</span>)}</div>}
  </div>;
}
