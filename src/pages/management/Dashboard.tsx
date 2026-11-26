import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as api from '../../lib/api/managementApi';
import type { Analytics, BranchMetrics, DashPrefs, LiquidityForecast, Money } from '../../lib/api/managementApi';
import { ChartCard, CurrencyTabs, HBars, LineChart, PALETTE } from './charts';
import { LinkCtx, MoneyLines, Section, Tile, deltaOf, nf, when } from './kit';
import type { Tone } from './kit';

/** سجل الأقسام والمؤشرات: مصدر واحد لترتيب الصفحة ولشاشة التخصيص (إخفاء/ترتيب لكل مستخدم — عرض فقط، لا صلاحيات). */
export const REGISTRY: Array<{ id: string; title: string; tiles: Array<{ id: string; label: string }> }> = [
  { id: 'summary', title: '1) الملخص التنفيذي', tiles: [{ id: 'sales', label: 'المبيعات' }, { id: 'salesMeters', label: 'المبيعات بالمتر' }, { id: 'purchases', label: 'المشتريات' }, { id: 'cash', label: 'أرصدة الصناديق' }, { id: 'receipts', label: 'المقبوضات' }, { id: 'payments', label: 'المدفوعات' }, { id: 'cheques', label: 'الشيكات قيد التحصيل' }] },
  { id: 'attention', title: '2) يحتاج تدخلاً إدارياً', tiles: [{ id: 'alertsHigh', label: 'تنبيهات عالية الأهمية' }, { id: 'alertsActive', label: 'تنبيهات نشطة' }, { id: 'decisions', label: 'قرارات وموافقات معلّقة' }, { id: 'lateOrders', label: 'طلبيات متأخرة' }, { id: 'chequesLate', label: 'شيكات متأخرة' }, { id: 'limit', label: 'تجاوز حد الائتمان' }, { id: 'promise', label: 'موعد تحصيل متجاوز' }, { id: 'extLate', label: 'مصنعية خارجية متأخرة' }, { id: 'woLate', label: 'أوامر إنتاج متأخرة' }, { id: 'waiting', label: 'مسودات وتسعير بانتظار' }] },
  { id: 'finance', title: '3) المركز المالي', tiles: [{ id: 'custDebit', label: 'العملاء — مدينون لنا' }, { id: 'custCredit', label: 'العملاء — دائنون' }, { id: 'supDebit', label: 'الموردون — علينا' }, { id: 'supCredit', label: 'الموردون — لنا' }, { id: 'chequePending', label: 'شيكات مقبوضة قيد التحصيل' }, { id: 'custExpected', label: 'رصيد العملاء المتوقع بعد الشيكات' }] },
  { id: 'sales', title: '4) المبيعات والعملاء', tiles: [{ id: 'openOrders', label: 'طلبيات مفتوحة' }, { id: 'prepOrders', label: 'قيد التجهيز' }, { id: 'inactive', label: 'عملاء غير نشطين' }, { id: 'topCust', label: 'أكثر العملاء شراءً' }] },
  { id: 'inventory', title: '5) المخزون', tiles: [{ id: 'avail', label: 'المتاح' }, { id: 'availKg', label: 'الوزن المتاح (كغ)' }, { id: 'reserved', label: 'المحجوز' }, { id: 'quarantine', label: 'المعزول' }, { id: 'noLoc', label: 'أتواب بلا موقع' }, { id: 'slow', label: 'بضاعة راكدة' }, { id: 'transfers', label: 'مناقلات معلّقة' }, { id: 'prep', label: 'طلبيات قيد التجهيز' }, { id: 'ready', label: 'بانتظار التسليم' }] },
  { id: 'external', title: '6) المصنعية الخارجية والإنتاج', tiles: [{ id: 'extOpen', label: 'إرساليات مفتوحة' }, { id: 'extPartial', label: 'مستلمة جزئياً' }, { id: 'extSent', label: 'أمتار مرسلة' }, { id: 'extRecv', label: 'أمتار مستلمة' }, { id: 'extRem', label: 'أمتار متبقية' }, { id: 'woOpen', label: 'أوامر إنتاج مفتوحة' }] },
  { id: 'oversight', title: '7) المستخدمون والرقابة', tiles: [{ id: 'usersActive', label: 'المستخدمون النشطون' }, { id: 'usersOnline', label: 'المتصلون الآن' }] },
];

const money = (rows: Array<{ currency: string; total: number }>) => rows;
const count = (n: number, bad = false): Tone => (n > 0 ? (bad ? 'bad' : 'warn') : 'good');

export interface AttentionCounts { highAlerts: number; activeAlerts: number; decisions: number }

/** يرتّب الأقسام ويطبّق الإخفاء حسب تخصيص المستخدم. */
export function applyPrefs(prefs: DashPrefs | null) {
  const order = prefs?.order ?? [];
  const sections = [...REGISTRY].sort((a, b) => { const ia = order.indexOf(a.id), ib = order.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || REGISTRY.indexOf(a) - REGISTRY.indexOf(b); });
  return { sections, hidden: new Set(prefs?.hidden ?? []) };
}

export function MetricsDashboard({ m, linked, prefs, attention, analytics, liquidity, onTab, branchId, scope }: {
  m: BranchMetrics; linked: boolean; prefs: DashPrefs | null; attention?: AttentionCounts | null; analytics?: Analytics | null; liquidity?: LiquidityForecast | null;
  onTab: (t: string) => void; branchId?: string; scope: api.Scope;
}) {
  const { sections, hidden } = applyPrefs(prefs);
  const show = (id: string) => !hidden.has(id);
  const cust = m.balances.customers, sup = m.balances.suppliers;
  const cmp = analytics?.cashMovement;
  const rcpt = (cmp?.current ?? []).map((r) => ({ currency: r.currency, total: r.receipts })), pay = (cmp?.current ?? []).map((r) => ({ currency: r.currency, total: r.payments }));
  const rcptPrev = (cmp?.previous ?? []).map((r) => ({ currency: r.currency, total: r.receipts })), payPrev = (cmp?.previous ?? []).map((r) => ({ currency: r.currency, total: r.payments }));
  const avKg = analytics?.inventoryByStatus.find((s) => s.status === 'AVAILABLE')?.kg;
  const salesTone = (rows: Money[], prev: Money[]): Tone => { const d = rows.map((r) => deltaOf(rows, prev, r.currency)).filter(Boolean); return d.length && d.every((x) => x!.dir === 'up') ? 'good' : 'neutral'; };
  const hasData = (rows: Money[]) => rows.some((r) => Math.abs(r.total) > 0.004);
  const ccyList = (...lists: Array<Array<{ currency: string }>>) => [...new Set(lists.flatMap((l) => l.map((x) => x.currency)))].sort();
  const bf = (path: string, extra = '') => `${path}${extra}`;

  const body: Record<string, ReactNode[]> = {
    summary: [
      show('sales') && <Tile key="sales" label="المبيعات (الفترة)" href="/invoices/sales" tone={salesTone(m.sales.current, m.sales.previous)} wide={m.sales.current.length > 1} hint={hasData(m.sales.previous) ? 'مقارنة بالفترة السابقة' : 'لا مقارنة: لا مبيعات سابقة'}><MoneyLines rows={m.sales.current} deltaAgainst={m.sales.previous} /></Tile>,
      show('salesMeters') && <Tile key="salesMeters" label="المبيعات بالمتر (الفترة)" href="/invoices/sales" tone={m.sales.quantity.current.meters > m.sales.quantity.previous.meters && m.sales.quantity.previous.meters > 0 ? 'good' : 'neutral'} hint={`${m.sales.quantity.current.invoices} فاتورة${m.sales.quantity.current.kg > 0 ? ` · بالكيلو: ${nf(m.sales.quantity.current.kg, 1)} كغ` : ''}${m.sales.quantity.previous.meters > 0 ? '' : ' · لا مقارنة: لا مبيعات سابقة'}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-2"><span className="num text-[.98rem] font-extrabold">{nf(m.sales.quantity.current.meters, 1)}<span className="u">م</span></span>
          {m.sales.quantity.previous.meters > 0 && (() => { const d = ((m.sales.quantity.current.meters - m.sales.quantity.previous.meters) / m.sales.quantity.previous.meters) * 100; return <span className={`text-[.68rem] font-bold ${d >= 0 ? 'cx-up' : 'cx-down'}`}>{d >= 0 ? '▲' : '▼'} {nf(Math.abs(d), 1)}%</span>; })()}</div>
      </Tile>,
      show('purchases') && <Tile key="purchases" label="المشتريات (الفترة)" href="/invoices/purchases" wide={m.purchases.current.length > 1} hint={hasData(m.purchases.previous) ? 'مقارنة بالفترة السابقة' : undefined}><MoneyLines rows={m.purchases.current} deltaAgainst={m.purchases.previous} /></Tile>,
      show('cash') && <Tile key="cash" label="أرصدة الصناديق (الآن)" href="/treasury/safes" wide={m.cash.length > 1}><MoneyLines rows={m.cash} /></Tile>,
      show('receipts') && <Tile key="receipts" label="المقبوضات (الفترة)" href="/treasury/log" tone="neutral" wide={rcpt.length > 1} hint={analytics ? undefined : 'جارٍ التحميل…'}><MoneyLines rows={money(rcpt)} deltaAgainst={rcptPrev} /></Tile>,
      show('payments') && <Tile key="payments" label="المدفوعات (الفترة)" href="/treasury/log" tone="neutral" wide={pay.length > 1} hint={analytics ? undefined : 'جارٍ التحميل…'}><MoneyLines rows={money(pay)} deltaAgainst={payPrev} /></Tile>,
      show('cheques') && <Tile key="cheques" label={`شيكات قيد التحصيل (${m.cheques.pending})`} href="/treasury/checks-vault" tone={m.cheques.overdue ? 'bad' : 'neutral'} wide={m.cheques.pendingByCurrency.length > 1} hint={m.cheques.overdue ? `منها متأخر: ${m.cheques.overdue}` : undefined}><MoneyLines rows={m.cheques.pendingByCurrency} /></Tile>,
    ],
    attention: [
      show('alertsHigh') && <Tile key="alertsHigh" label="تنبيهات عالية الأهمية" tone={count(attention?.highAlerts ?? 0, true)} value={attention?.highAlerts ?? '—'} hint="مركز التنبيهات" />,
      show('alertsActive') && <Tile key="alertsActive" label="تنبيهات نشطة" tone={count(attention?.activeAlerts ?? 0)} value={attention?.activeAlerts ?? '—'} />,
      show('decisions') && <Tile key="decisions" label="قرارات وموافقات معلّقة" tone={count(attention?.decisions ?? 0)} value={attention?.decisions ?? '—'} hint="تُعتمد من شاشاتها الأصلية" />,
      show('lateOrders') && <Tile key="lateOrders" label="طلبيات متأخرة" href="/orders" tone={count(m.orders.late)} value={m.orders.late} />,
      show('chequesLate') && <Tile key="chequesLate" label="شيكات متأخرة التحصيل" href="/treasury/checks-vault" tone={count(m.cheques.overdue, true)} value={m.cheques.overdue} />,
      show('limit') && <Tile key="limit" label="عملاء تجاوزوا حد الائتمان" href={bf('/customers/balances', '?alerts=1')} tone={count(m.balances.customerAlerts.limitExceeded, true)} value={m.balances.customerAlerts.limitExceeded} />,
      show('promise') && <Tile key="promise" label="تجاوز موعد التحصيل" href={bf('/customers/balances', '?alerts=1')} tone={count(m.balances.customerAlerts.promiseOverdue)} value={m.balances.customerAlerts.promiseOverdue} hint={m.balances.supplierPromiseOverdue ? `موردون: ${m.balances.supplierPromiseOverdue}` : undefined} />,
      show('extLate') && <Tile key="extLate" label={`مصنعية خارجية متأخرة (> ${m.external.lateThresholdDays} يوماً)`} href="/purchases/external-jobs" tone={count(m.external.late)} value={m.external.late} />,
      show('woLate') && <Tile key="woLate" label="أوامر إنتاج متأخرة" href="/manufacturing" tone={count(m.production.late)} value={m.production.late} />,
      show('waiting') && <Tile key="waiting" label="مسودات وتسعير بانتظار الإجراء" href="/approvals-center" tone={count(m.waiting.salesDrafts + m.waiting.purchaseDrafts + m.waiting.pricingQueue + m.waiting.editRequests + m.waiting.wasteDrafts)} value={m.waiting.salesDrafts + m.waiting.purchaseDrafts + m.waiting.pricingQueue + m.waiting.editRequests + m.waiting.wasteDrafts} hint={`بيع ${m.waiting.salesDrafts} · شراء ${m.waiting.purchaseDrafts} · تسعير ${m.waiting.pricingQueue} · إذن ${m.waiting.editRequests} · إهلاك ${m.waiting.wasteDrafts}`} />,
    ],
    finance: [
      show('custDebit') && <Tile key="custDebit" label="العملاء — مدينون لنا (حسب كشف الحساب)" href="/customers/balances" wide={cust.length > 1}><MoneyLines rows={cust.map((r) => ({ currency: r.currency, total: r.owedToUs }))} /></Tile>,
      show('custCredit') && <Tile key="custCredit" label="العملاء — أرصدة دائنة (لهم علينا)" href="/customers/balances" wide={cust.length > 1}><MoneyLines rows={cust.map((r) => ({ currency: r.currency, total: r.weOwe }))} /></Tile>,
      show('supDebit') && <Tile key="supDebit" label="الموردون — علينا لهم" href="/suppliers/balances" wide={sup.length > 1}><MoneyLines rows={sup.map((r) => ({ currency: r.currency, total: r.weOwe }))} /></Tile>,
      show('supCredit') && <Tile key="supCredit" label="الموردون — لنا عندهم" href="/suppliers/balances" wide={sup.length > 1}><MoneyLines rows={sup.map((r) => ({ currency: r.currency, total: r.owedToUs }))} /></Tile>,
      show('chequePending') && <Tile key="chequePending" label="شيكات العملاء قيد التحصيل" href="/customers/balances" wide={cust.length > 1}><MoneyLines rows={cust.map((r) => ({ currency: r.currency, total: r.pendingCheques }))} /></Tile>,
      show('custExpected') && <Tile key="custExpected" label="الرصيد المتوقع بعد التحصيل (مدين − شيكات)" href="/customers/balances" wide={cust.length > 1} hint="تقدير: لا يعني تحصيلاً مؤكداً"><MoneyLines rows={cust.map((r) => ({ currency: r.currency, total: r.owedToUs - r.pendingCheques }))} /></Tile>,
    ],
    sales: [
      show('openOrders') && <Tile key="openOrders" label="طلبيات مفتوحة" href="/orders" value={m.orders.open} hint={m.orders.late ? `متأخرة: ${m.orders.late}` : undefined} tone={m.orders.late ? 'warn' : 'neutral'} />,
      show('prepOrders') && <Tile key="prepOrders" label="طلبيات قيد التجهيز" href="/orders" value={m.orders.inPreparation} />,
      show('inactive') && <Tile key="inactive" label={`عملاء غير نشطين (> ${m.inactiveCustomers.thresholdDays} يوماً)`} href="/customers/balances?all=1" value={m.inactiveCustomers.count} hint="معلوماتي" />,
      show('topCust') && <Tile key="topCust" label="أكثر العملاء شراءً" wide href="/customers/balances" hint={m.sales.topCustomers.length ? undefined : 'لا مبيعات في الفترة'}>{m.sales.topCustomers.slice(0, 3).map((r) => <div key={r.name + r.currency} className="flex justify-between gap-2 text-[.78rem]"><span className="truncate">{r.name}</span><span className="num">{nf(r.total, 2)} {r.currency}</span></div>)}</Tile>,
    ],
    inventory: [
      show('avail') && <Tile key="avail" label="المتاح (أتواب · أمتار + كيلو)" href="/inventory" tone="neutral"><span className="num">{nf(m.inventory.available.rolls)}</span><span className="u">توب</span> <span className="cx-muted">·</span> <span className="num">{nf(m.inventory.available.meters, 1)}</span><span className="u">م</span>{(m.inventory.available.kg ?? 0) > 0 && <><span className="cx-muted"> + </span><span className="num">{nf(m.inventory.available.kg ?? 0, 1)}</span><span className="u">كغ</span></>}</Tile>,
      show('availKg') && <Tile key="availKg" label="الوزن المتاح" href="/inventory" value={avKg === undefined ? '…' : nf(avKg, 1)} unit={avKg === undefined ? undefined : 'كغ'} hint="حسب أوزان الأتواب المسجَّلة" />,
      show('reserved') && <Tile key="reserved" label="محجوز (حالة طبيعية)" href="/inventory" tone="neutral"><span className="num">{nf(m.inventory.reserved.rolls)}</span><span className="u">توب</span> <span className="cx-muted">·</span> <span className="num">{nf(m.inventory.reserved.meters, 1)}</span><span className="u">م</span></Tile>,
      show('quarantine') && <Tile key="quarantine" label="معزول/تالف (حالة تشغيلية)" href="/inventory" tone="neutral"><span className="num">{nf(m.inventory.quarantined.rolls)}</span><span className="u">توب</span> <span className="cx-muted">·</span> <span className="num">{nf(m.inventory.quarantined.meters, 1)}</span><span className="u">م</span></Tile>,
      show('noLoc') && <Tile key="noLoc" label="أتواب بلا موقع تخزين" href="/inventory/zones" tone="neutral" value={m.inventory.withoutLocation} hint="معلوماتي: تحديد المواقع اختياري ولا يمنع البيع أو الحجز أو المناقلة" />,
      show('slow') && <Tile key="slow" label={`بضاعة راكدة (> ${m.inventory.slowMoving.thresholdDays} يوماً)`} href="/inventory" tone="neutral"><span className="num">{nf(m.inventory.slowMoving.rolls)}</span><span className="u">توب</span> <span className="cx-muted">·</span> <span className="num">{nf(m.inventory.slowMoving.meters, 1)}</span><span className="u">م</span></Tile>,
      show('transfers') && <Tile key="transfers" label="مناقلات معلّقة" href="/inventory/transfers" tone={count(m.inventory.pendingTransfers)} value={m.inventory.pendingTransfers} />,
      show('prep') && <Tile key="prep" label="طلبيات قيد التجهيز" href="/orders" value={m.orders.inPreparation} />,
      show('ready') && <Tile key="ready" label="طلبيات بانتظار التسليم" href="/orders" value={m.orders.awaitingDelivery} hint="أذون الخروج كمستند مستقل غير متاحة بالنظام" />,
    ],
    external: [
      show('extOpen') && <Tile key="extOpen" label="إرساليات مفتوحة" href="/purchases/external-jobs" value={m.external.open} hint={m.external.late ? `متأخرة: ${m.external.late}` : undefined} tone={m.external.late ? 'warn' : 'neutral'} />,
      show('extPartial') && <Tile key="extPartial" label="مستلمة جزئياً" href="/purchases/external-jobs" value={m.external.partiallyReceived} />,
      show('extSent') && <Tile key="extSent" label="أمتار مرسلة" href="/purchases/external-jobs" value={m.external.metersSent} decimals={1} unit="م" />,
      show('extRecv') && <Tile key="extRecv" label="أمتار مستلمة" href="/purchases/external-jobs" value={m.external.metersReceived} decimals={1} unit="م" />,
      show('extRem') && <Tile key="extRem" label="أمتار متبقية" href="/purchases/external-jobs" value={m.external.metersRemaining} decimals={1} unit="م" />,
      show('woOpen') && <Tile key="woOpen" label="أوامر إنتاج مفتوحة" href="/manufacturing" value={m.production.open} hint={m.production.late ? `متأخرة: ${m.production.late}` : undefined} tone={m.production.late ? 'warn' : 'neutral'} />,
    ],
    oversight: [
      show('usersActive') && <Tile key="usersActive" label="المستخدمون النشطون" value={m.users.active} />,
      show('usersOnline') && <Tile key="usersOnline" label="المتصلون الآن" value={m.users.onlineNow} tone="neutral" hint="الاتصال وحده ليس مقياس أداء" />,
    ],
  };

  return <LinkCtx.Provider value={linked}><div className="space-y-3">
    {sections.map((sec) => {
      const tiles = (body[sec.id] ?? []).filter(Boolean);
      const extra = sec.id === 'summary' ? <SummaryCharts a={analytics} /> : sec.id === 'finance' ? <FinanceCharts a={analytics} liquidity={liquidity} /> : sec.id === 'sales' ? <SalesCharts m={m} /> : sec.id === 'inventory' ? <InventoryCharts a={analytics} /> : sec.id === 'oversight' ? <button type="button" className="cx-btn cx-noprint mt-2" onClick={() => onTab('users')}>المهام والاستثناءات وسجل الصلاحيات ←</button> : null;
      if (!tiles.length && !extra) return null;
      const attentionBad = sec.id === 'attention' && ((attention?.highAlerts ?? 0) > 0 || m.cheques.overdue > 0);
      return <Section key={sec.id} title={sec.title} badge={sec.id === 'attention' ? (attentionBad ? { text: 'يوجد ما يستحق التدخل', tone: 'bad' } : { text: 'لا مشكلات حرجة', tone: 'good' }) : undefined} defaultOpen={sec.id !== 'oversight'}>
        {tiles.length > 0 && <div className="cx-grid">{tiles}</div>}
        {extra}
        {sec.id === 'external' && m.external.settlementsInPeriod.length > 0 && <p className="cx-muted mt-2 text-xs">تسويات الفترة: {m.external.settlementsInPeriod.map((s) => `${s.category} ${nf(s.meters, 1)} م`).join(' · ')}</p>}
      </Section>;
    })}
    {m.unavailable.length > 0 && <details className="cx-card p-3 text-xs"><summary className="cursor-pointer font-bold">مؤشرات غير متاحة حالياً ({m.unavailable.length}) — السبب والمتطلب الناقص، ولا نعرض أرقاماً بديلة</summary>
      <ul className="mt-2 list-disc space-y-1 pe-5 cx-muted">{m.unavailable.map((u) => <li key={u.key}><b>{u.label}:</b> {u.reason}</li>)}</ul></details>}
    <p className="cx-muted text-[.7rem]">البيانات حتى {when(new Date().toISOString())} · الأرصدة القائمة بتاريخ اليوم، أما مؤشرات الحركة فخلال الفترة المختارة ({m.period.label}: {m.period.from} → {m.period.to}).{scope === 'owner' && branchId ? '' : ''}</p>
  </div></LinkCtx.Provider>;
}

function SummaryCharts({ a }: { a?: Analytics | null }) {
  const ccys = useMemo(() => (a ? [...new Set([...a.sales, ...a.purchases, ...a.receipts, ...a.payments].map((p) => p.currency))].sort() : []), [a]);
  const [ccy, setCcy] = useState('');
  const cur = ccys.includes(ccy) ? ccy : ccys[0] ?? '';
  if (!a) return <p className="cx-muted mt-3 text-xs">جارٍ تحميل الرسوم…</p>;
  const pts = (rows: Analytics['sales']) => rows.filter((r) => r.currency === cur).map((r) => ({ x: r.bucket, y: r.total }));
  const flows = ['receipts', 'payments'].map((k) => a[k as 'receipts' | 'payments'].filter((r) => r.currency === cur));
  const buckets = [...new Set(flows.flat().map((r) => r.bucket))].sort();
  return <div className="cx-charts mt-3">
    <ChartCard title="المبيعات والمشتريات خلال الفترة" empty={!ccys.length ? 'لا حركة بيع أو شراء مسجَّلة في هذه الفترة.' : undefined} right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />} note={`تجميع ${a.bucketUnit === 'day' ? 'يومي' : 'شهري'} — عملة واحدة في كل رسم.`}>
      <LineChart unit={cur} series={[{ name: 'مبيعات', color: PALETTE[0], points: pts(a.sales) }, { name: 'مشتريات', color: PALETTE[1], points: pts(a.purchases) }]} />
    </ChartCard>
    <ChartCard title="المقبوضات والمدفوعات" empty={!buckets.length ? `لا سندات قبض أو دفع معتمدة بعملة ${cur || ''} في هذه الفترة.` : undefined} right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />}>
      <HBars legend={['مقبوضات', 'مدفوعات']} unit={cur} items={buckets.slice(-10).map((b) => ({ label: b, values: [flows[0].find((r) => r.bucket === b)?.total ?? 0, flows[1].find((r) => r.bucket === b)?.total ?? 0] }))} />
    </ChartCard>
  </div>;
}

function FinanceCharts({ a, liquidity }: { a?: Analytics | null; liquidity?: LiquidityForecast | null }) {
  const [ccy, setCcy] = useState('');
  const liqCcys = [...new Set((liquidity?.horizons ?? []).flatMap((h) => h.byCurrency.map((c) => c.currency)))].sort();
  const cur = liqCcys.includes(ccy) ? ccy : liqCcys[0] ?? '';
  return <div className="cx-charts mt-3">
    <ChartCard title="تقادم ديون العملاء" note={a?.agingNote} empty={a && !a.customerAging.length ? 'لا ديون مستحقة على العملاء.' : !a ? 'جارٍ التحميل…' : undefined}>
      {a && <div className="space-y-3">{a.customerAging.map((g) => <div key={g.currency}><div className="mb-1 text-xs font-bold">{g.currency}</div>
        <HBars stacked legend={['0–30', '31–60', '61–90', '+90', 'غير مخصّص']} unit={g.currency} items={[{ label: 'الديون حسب العمر (يوم)', values: [g.d0_30, g.d31_60, g.d61_90, g.d90plus, Math.max(0, g.unallocated)] }]} /></div>)}</div>}
    </ChartCard>
    <ChartCard title="توقعات السيولة (7/30/60/90 يوماً)" right={<CurrencyTabs currencies={liqCcys} value={cur} onChange={setCcy} />} empty={liquidity && !liqCcys.length ? 'لا بيانات سيولة لهذا الفرع.' : !liquidity ? 'جارٍ التحميل…' : undefined} note="المؤكَّد (نقد + شيكات مستحقة) منفصل عن المتوقَّع (تحصيل/دفع) — لا جمع بينهما ولا بين العملات.">
      {liquidity && <HBars legend={['مؤكَّد', 'متوقَّع']} unit={cur} items={liquidity.horizons.map((h) => { const r = h.byCurrency.find((c) => c.currency === cur); return { label: `${h.days} يوماً`, values: [r?.confirmedTotal ?? 0, r?.forecastTotal ?? 0] }; })} />}
    </ChartCard>
  </div>;
}

function SalesCharts({ m }: { m: BranchMetrics }) {
  const ccys = [...new Set([...m.sales.byItem, ...m.sales.byColor, ...m.sales.byCreator].map((r) => r.currency))].sort();
  const [ccy, setCcy] = useState('');
  const cur = ccys.includes(ccy) ? ccy : ccys[0] ?? '';
  const top = <T extends { currency: string; total: number }>(rows: T[]) => rows.filter((r) => r.currency === cur).slice(0, 8);
  const empty = !ccys.length ? 'لا مبيعات معتمدة في الفترة.' : undefined;
  return <div className="cx-charts mt-3">
    <ChartCard title="أكثر الخامات مبيعاً" empty={empty} right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />}><HBars unit={cur} legend={['المبيعات']} items={top(m.sales.byItem).map((r) => ({ label: `${r.name}${r.meters > 0 ? ` · ${nf(r.meters, 0)} م` : ''}`, values: [r.total] }))} /></ChartCard>
    <ChartCard title="أكثر الألوان مبيعاً" empty={empty} right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />}><HBars unit={cur} legend={['المبيعات']} items={top(m.sales.byColor).map((r) => ({ label: r.name, values: [r.total] }))} /></ChartCard>
    <ChartCard title="أداء المندوبين (حسب منشئ الفاتورة)" empty={empty} note="لا حقل «مندوب» في الفاتورة؛ يُعرض منشئها." right={<CurrencyTabs currencies={ccys} value={cur} onChange={setCcy} />}><HBars unit={cur} legend={['المبيعات']} items={top(m.sales.byCreator).map((r) => ({ label: `${r.name} (${r.count})`, values: [r.total] }))} /></ChartCard>
  </div>;
}

function InventoryCharts({ a }: { a?: Analytics | null }) {
  const label: Record<string, string> = { AVAILABLE: 'متاح', RESERVED: 'محجوز', DAMAGED: 'معزول/تالف' };
  return <div className="cx-charts mt-3">
    <ChartCard title="المخزون حسب الحالة (أمتار)" empty={a && !a.inventoryByStatus.length ? 'لا أتواب.' : !a ? 'جارٍ التحميل…' : undefined}>
      {a && <HBars unit="م" legend={['أمتار']} items={a.inventoryByStatus.map((s) => ({ label: `${label[s.status] ?? s.status} (${s.rolls} توب)`, values: [s.meters] }))} />}
    </ChartCard>
    <ChartCard title="توزيع المخزون على المستودعات (أمتار)" empty={a && !a.inventoryByWarehouse.length ? 'لا مخزون متاح.' : !a ? 'جارٍ التحميل…' : undefined}>
      {a && <HBars unit="م" legend={['أمتار']} items={a.inventoryByWarehouse.map((w) => ({ label: `${w.warehouse} (${w.rolls})`, values: [w.meters] }))} />}
    </ChartCard>
  </div>;
}

/** تحميل مشترك للتحليلات والسيولة والتخصيص بعد البيانات الأساسية (لا يؤخر ظهور المؤشرات). */
export function useDashExtras(scope: api.Scope, period: api.PeriodQuery, branchId: string | undefined, enabled: boolean) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [liquidity, setLiquidity] = useState<LiquidityForecast | null>(null);
  const [attention, setAttention] = useState<AttentionCounts | null>(null);
  const key = JSON.stringify([scope, period, branchId]);
  useEffect(() => {
    if (!enabled || (scope === 'owner' && !branchId)) return;
    let live = true;
    setAnalytics(null);
    api.fetchAnalytics(scope, period, branchId).then((r) => { if (live) setAnalytics(r); }).catch(() => { if (live) setAnalytics(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled || (scope === 'owner' && !branchId)) return;
    let live = true;
    const done = (alerts: Array<{ severity: string }>, decisions: number, liq: LiquidityForecast) => { if (!live) return; setAttention({ highAlerts: alerts.filter((a) => a.severity === 'HIGH').length, activeAlerts: alerts.length, decisions }); setLiquidity(liq); };
    if (scope === 'branch') void Promise.all([api.fetchAlerts('ACTIVE'), api.fetchDecisions(), api.fetchLiquidity()]).then(([al, de, li]) => done(al.alerts, de.length, li)).catch(() => undefined);
    else void api.fetchOwnerAlerts().then((all) => { const b = all.find((x) => x.branchId === branchId); if (b) done(b.alerts, b.decisions.length, b.liquidity); }).catch(() => undefined);
    return () => { live = false; };
  }, [scope, branchId, enabled]);
  return { analytics, liquidity, attention };
}
