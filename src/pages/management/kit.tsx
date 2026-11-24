import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { Money as MoneyT, PeriodKind, PeriodQuery } from '../../lib/api/managementApi';
import './dash.css';

export const nf = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'تعذر التنفيذ');

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** روابط البطاقات تعمل داخل الفرع الحالي فقط؛ تُعطَّل عند عرض فرع آخر (لا نخلط الفروع). */
export const LinkCtx = createContext(true);

/** الفرق عن الفترة السابقة لعملة واحدة: يعاد null إن لم تتوفر مقارنة. */
export function deltaOf(cur: MoneyT[], prev: MoneyT[], currency: string): { pct: number; dir: 'up' | 'down' | 'flat' } | null {
  const c = cur.find((x) => x.currency === currency)?.total ?? 0;
  const p = prev.find((x) => x.currency === currency)?.total ?? 0;
  if (!p) return null;
  const pct = ((c - p) / Math.abs(p)) * 100;
  return { pct, dir: Math.abs(pct) < 0.05 ? 'flat' : pct > 0 ? 'up' : 'down' };
}

/** مبالغ لكل عملة على حدة؛ لا جمع ولا تحويل بين العملات. */
export function MoneyLines({ rows, deltaAgainst }: { rows: MoneyT[]; deltaAgainst?: MoneyT[] }) {
  const shown = rows.filter((r) => Math.abs(r.total) > 0.004);
  if (!shown.length) return <span className="cx-muted">—</span>;
  return <div className="flex flex-col gap-0.5">{shown.map((r) => {
    const d = deltaAgainst ? deltaOf(rows, deltaAgainst, r.currency) : null;
    return <div key={r.currency} className="flex flex-wrap items-baseline justify-between gap-x-2">
      <span className="num text-[.98rem] font-extrabold">{nf(r.total, 2)}<span className="u">{r.currency}</span></span>
      {d && <span className={`text-[.68rem] font-bold ${d.dir === 'up' ? 'cx-up' : d.dir === 'down' ? 'cx-down' : 'cx-flat'}`}>{d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '■'} {nf(Math.abs(d.pct), 1)}%</span>}
    </div>;
  })}</div>;
}

interface TileProps { label: string; href?: string; tone?: Tone; hint?: string; wide?: boolean; unit?: string; value?: number | string; decimals?: number; children?: ReactNode }
/** بطاقة مؤشر مختصرة: قيمة بارزة + وحدة + (اختياري) تلميح، وتنقل لشاشتها الأصلية عند الضغط. */
export function Tile({ label, href, tone = 'neutral', hint, wide, unit, value, decimals = 0, children }: TileProps) {
  const linked = useContext(LinkCtx);
  const body = <>
    <div className="l">{label}</div>
    <div className="v">{children ?? <span className="num">{typeof value === 'number' ? nf(value, decimals) : value ?? '—'}{unit && <span className="u">{unit}</span>}</span>}</div>
    {hint && <div className="h">{hint}</div>}
  </>;
  const cls = `cx-tile ${tone} ${wide ? 'cx-wide' : ''}`;
  return href && linked ? <Link to={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** قسم قابل للطي. */
export function Section({ title, badge, defaultOpen = true, actions, children }: { title: string; badge?: { text: string; tone: Tone }; defaultOpen?: boolean; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="cx-card">
    <div className="flex items-center">
      <button type="button" className="cx-sec-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2"><b>{title}</b>{badge && <span className={`cx-badge ${badge.tone}`}>{badge.text}</span>}</span>
        <ChevronDown className={`h-4 w-4 cx-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {actions && <div className="cx-noprint pe-3">{actions}</div>}
    </div>
    {open && <div className="px-3 pb-3">{children}</div>}
  </section>;
}

export function PeriodBar({ value, onChange }: { value: PeriodQuery; onChange: (p: PeriodQuery) => void }) {
  const opts: Array<[PeriodKind, string]> = [['today', 'اليوم'], ['yesterday', 'أمس'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة'], ['custom', 'مخصّص']];
  return <div className="space-y-1.5">
    <div className="cx-hscroll">{opts.map(([k, l]) => <button key={k} type="button" aria-pressed={value.period === k} className="cx-chip" onClick={() => onChange({ ...value, period: k })}>{l}</button>)}</div>
    {value.period === 'custom' && <div className="flex flex-wrap items-center gap-2 text-sm">
      <input type="date" aria-label="من" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} className="cx-input" />
      <span className="cx-muted">→</span>
      <input type="date" aria-label="إلى" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} className="cx-input" />
    </div>}
  </div>;
}

export function ErrorLine({ msg }: { msg: string }) { return msg ? <p role="alert" className="rounded-lg px-3 py-2 text-sm font-bold" style={{ background: 'var(--cx-bad-bg)', color: 'var(--cx-bad)' }}>{msg}</p> : null; }
