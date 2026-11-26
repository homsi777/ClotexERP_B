import { useEffect, useMemo, useState } from 'react';
import { FileText, Minus, Plus, Printer, RotateCcw, Tag, X } from 'lucide-react';
import type { FabricRollDto } from '../../lib/api/fabricRollsApi';
import { renderInventoryRollsAuditA4Html } from '../../lib/printing/renderInventoryRollsAuditA4';
import { groupRollsByColor, renderInventoryRollsThermal78 } from '../../lib/printing/renderInventoryRollsThermal78';
import { renderInventoryAuditSticker, type AuditStickerColor } from '../../lib/printing/renderInventoryAuditSticker';
import { clampFontScale, FONT_SCALE_STEP, loadInventoryPrintSettings, saveInventoryPrintSettings, type InventoryPrintSettings } from '../../lib/printing/inventoryPrintSettings';
import { getPrintAdapter, isElectronRenderer } from '../../lib/printing/printAdapters';
import { getRollLengthMeters } from '../../lib/inventory/rollAvailability';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { BRAND } from '../../branding';

export interface InventoryPrintContext {
  rolls: FabricRollDto[];
  searchQuery: string;
  warehouseLabel: string;
  scopeLabel: string;
  /** نطاق النتيجة: خامة/كارتيلة كاملة أو لون واحد. */
  scope: 'cartela' | 'color';
  materialName: string;
  baseCode: string;
  cartelaCode: string;
  /** لنطاق اللون: يجلب أتواب كل ألوان الكارتيلة لستيكر يجمعها. */
  loadAllColorRolls?: () => Promise<FabricRollDto[]>;
}

const stickerColors = (rolls: FabricRollDto[]): AuditStickerColor[] =>
  groupRollsByColor(rolls).map((g) => ({ name: g.colorName, code: g.colorCode, meters: g.rows.reduce((a, r) => a + r.meters, 0) }));

/** خيارات الطباعة في شاشة واحدة: «الكشف التفصيلي» (A4 أو حراري مباشرة) و«الستيكر». الإعدادات تُحفظ لكل جهاز وطابعة. */
export function InventoryPrintOptionsModal({ ctx, onClose }: { ctx: InventoryPrintContext; onClose: () => void }) {
  const [s, setS] = useState<InventoryPrintSettings>(() => loadInventoryPrintSettings());
  const [printers, setPrinters] = useState<string[]>([]), [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const electron = isElectronRenderer();
  useEffect(() => { if (electron) void window.fabricApp?.listPrinters?.().then((p) => setPrinters(p.map((x) => x.name))).catch(() => undefined); }, [electron]);
  const update = (patch: Partial<InventoryPrintSettings>) => setS((cur) => { const next = { ...cur, ...patch }; saveInventoryPrintSettings(next); return next; });
  const changePrinter = (name: string) => { const loaded = loadInventoryPrintSettings(name); setS(loaded); saveInventoryPrintSettings(loaded); };

  const thermal = useMemo(() => renderInventoryRollsThermal78({ rolls: ctx.rolls, title: 'كشف جرد الأتواب', searchQuery: ctx.searchQuery, warehouseLabel: ctx.warehouseLabel, fontScale: s.thermalFontScale, rollWidthMm: s.rollWidthMm, logoSrc: BRAND.logoInline, brandName: BRAND.name }), [ctx, s.thermalFontScale, s.rollWidthMm]);
  const thermalSummary = useMemo(() => renderInventoryRollsThermal78({ rolls: ctx.rolls, summary: true, searchQuery: ctx.searchQuery, warehouseLabel: ctx.warehouseLabel, fontScale: s.thermalFontScale, rollWidthMm: s.rollWidthMm, logoSrc: BRAND.logoInline, brandName: BRAND.name }), [ctx, s.thermalFontScale, s.rollWidthMm]);
  const [thermalKind, setThermalKind] = useState<'detail' | 'summary'>('detail');
  const totalM = ctx.rolls.reduce((a, r) => a + getRollLengthMeters(r), 0);

  /** طباعة مباشرة: بالتطبيق المكتبي مع اسم طابعة تُرسَل صامتة؛ وإلا نافذة الطباعة (حفظ PDF ممكن منها). */
  const send = async (html: string, title: string, page: { widthMm: number; heightMm: number } | null) => {
    setBusy(true); setMsg('');
    try {
      if (electron && s.printerName && page) {
        const r = await getPrintAdapter().print(html, { pageSize: 'label', widthMm: page.widthMm, heightMm: page.heightMm, printerName: s.printerName, silent: true });
        setMsg(r.ok ? 'أُرسلت الطباعة' : r.error || 'تعذرت الطباعة');
      } else if (!openDocumentPrintWindow(html, title)) setMsg('منع المتصفح نافذة الطباعة: اسمح بالنوافذ المنبثقة');
    } finally { setBusy(false); }
  };
  const printA4 = () => { update({ mode: 'A4' }); void send(renderInventoryRollsAuditA4Html({ rolls: ctx.rolls, searchQuery: ctx.searchQuery, scopeLabel: ctx.scopeLabel, warehouseLabel: ctx.warehouseLabel, printedAt: new Date(), orientation: s.a4Orientation }), ctx.scopeLabel, null); };
  const printThermal = (kind: 'detail' | 'summary') => { update({ mode: 'THERMAL' }); setThermalKind(kind); const t = kind === 'summary' ? thermalSummary : thermal; void send(t.html, ctx.scopeLabel, { widthMm: s.rollWidthMm, heightMm: t.heightMm }); };
  const printSticker = async (colors: AuditStickerColor[]) => {
    const st = renderInventoryAuditSticker({ materialName: ctx.materialName, baseCode: ctx.baseCode, cartelaCode: ctx.cartelaCode, colors, widthMm: s.stickerWidthMm });
    await send(st.html, 'ستيكر جرد', { widthMm: st.widthMm, heightMm: st.heightMm });
  };
  const printAllCartelaSticker = async () => { const rolls = ctx.loadAllColorRolls ? await ctx.loadAllColorRolls() : ctx.rolls; await printSticker(stickerColors(rolls)); };

  const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black disabled:opacity-50';
  return <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" dir="rtl" onClick={onClose}>
    <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b px-4 py-3"><div><b className="text-lg">خيارات الطباعة</b><p className="text-xs text-slate-500">{ctx.rolls.length.toLocaleString('en')} توب · {totalM.toLocaleString('en', { maximumFractionDigits: 2 })} م — حسب البحث والمستودع المختارين</p></div><button type="button" onClick={onClose} className="rounded-lg border p-2" aria-label="إغلاق"><X className="h-4 w-4" /></button></div>

      <div className="grid gap-0 md:grid-cols-2">
        <section className="space-y-3 border-b p-4 md:border-b-0 md:border-l">
          <h3 className="flex items-center gap-2 font-black text-slate-900"><FileText className="h-4 w-4" />الكشف التفصيلي</h3>
          <button type="button" disabled={busy || !ctx.rolls.length} onClick={printA4} className={`${btn} w-full bg-slate-900 text-white`}><Printer className="h-4 w-4" />طباعة A4 عادي</button>
          <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600">اتجاه A4
            <select value={s.a4Orientation} onChange={(e) => update({ a4Orientation: e.target.value as 'landscape' | 'portrait' })} className="rounded-lg border px-2 py-1 font-normal"><option value="landscape">أفقي (الافتراضي)</option><option value="portrait">عمودي</option></select></label>
          <button type="button" disabled={busy || !ctx.rolls.length} onClick={() => printThermal('detail')} className={`${btn} w-full bg-emerald-700 text-white`}><Printer className="h-4 w-4" />طباعة حراري 7.8 سم — تفصيلي</button>
          <button type="button" disabled={busy || !ctx.rolls.length} onClick={() => printThermal('summary')} className={`${btn} w-full border border-emerald-700 bg-white text-emerald-800`}><Printer className="h-4 w-4" />طباعة حراري 7.8 سم — ملخص (لكل لون سطر)</button>
          <div className="flex rounded-lg border text-xs font-bold" role="group" aria-label="نوع المعاينة"><button type="button" onClick={() => setThermalKind('detail')} className={`flex-1 rounded-r-lg px-2 py-1 ${thermalKind === 'detail' ? 'bg-slate-800 text-white' : 'bg-white'}`}>معاينة التفصيلي</button><button type="button" onClick={() => setThermalKind('summary')} className={`flex-1 rounded-l-lg px-2 py-1 ${thermalKind === 'summary' ? 'bg-slate-800 text-white' : 'bg-white'}`}>معاينة الملخص</button></div>

          <div className="rounded-xl border bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700"><span>حجم الخط الحراري ({Math.round(s.thermalFontScale * 100)}%)</span>
              <span className="flex gap-1">
                <button type="button" aria-label="تصغير الخط" onClick={() => update({ thermalFontScale: clampFontScale(s.thermalFontScale - FONT_SCALE_STEP) })} className="rounded-lg border bg-white px-2 py-1"><Minus className="inline h-3.5 w-3.5" />A</button>
                <button type="button" aria-label="تكبير الخط" onClick={() => update({ thermalFontScale: clampFontScale(s.thermalFontScale + FONT_SCALE_STEP) })} className="rounded-lg border bg-white px-2 py-1"><Plus className="inline h-3.5 w-3.5" />A</button>
                <button type="button" aria-label="الحجم الافتراضي" onClick={() => update({ thermalFontScale: 1 })} className="rounded-lg border bg-white px-2 py-1"><RotateCcw className="inline h-3.5 w-3.5" /></button></span></div>
            <div className="max-h-64 overflow-auto rounded-lg border bg-white"><iframe title="معاينة الكشف الحراري" srcDoc={(thermalKind === 'summary' ? thermalSummary : thermal).html} sandbox="" className="mx-auto block border-0" style={{ width: `${s.rollWidthMm}mm`, height: `${Math.min((thermalKind === 'summary' ? thermalSummary : thermal).heightMm, 400)}mm` }} /></div>
            <p className="mt-1 text-[11px] text-slate-500">المعاينة هي نفس المطبوع (الحجم الأدنى 80% والأقصى 160%؛ الصفوف تتسع تلقائياً). عرض الطباعة الفعلي 72 مم على رول 78 مم.</p>
          </div>
        </section>

        <section className="space-y-3 p-4">
          <h3 className="flex items-center gap-2 font-black text-slate-900"><Tag className="h-4 w-4" />الستيكر</h3>
          {ctx.scope === 'cartela'
            ? <button type="button" disabled={busy || !ctx.rolls.length} onClick={() => void printSticker(stickerColors(ctx.rolls))} className={`${btn} w-full bg-indigo-700 text-white`}><Tag className="h-4 w-4" />ستيكر الكارتيلة (ألوانها مجمعة)</button>
            : <>
              <button type="button" disabled={busy || !ctx.rolls.length} onClick={() => void printSticker(stickerColors(ctx.rolls))} className={`${btn} w-full bg-indigo-700 text-white`}><Tag className="h-4 w-4" />ستيكر هذا اللون</button>
              <button type="button" disabled={busy} onClick={() => void printAllCartelaSticker()} className={`${btn} w-full border border-indigo-300 bg-white text-indigo-800`}><Tag className="h-4 w-4" />ستيكر يجمع ألوان الكارتيلة كلها</button></>}
          <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600">عرض الستيكر (مم)<input type="number" min={40} max={72} value={s.stickerWidthMm} onChange={(e) => update({ stickerWidthMm: Math.min(72, Math.max(40, Number(e.target.value) || 72)) })} className="w-24 rounded-lg border px-2 py-1 font-normal" dir="ltr" /></label>
          <p className="text-[11px] text-slate-500">يحتوي: اسم الخامة، كودها الأساسي، كود الكارتيلة، تاريخ الجرد، ثم لكل لون اسمه وجزؤه المتغير من الكود وإجمالي أمتاره. الطول يتبع عدد الألوان.</p>

          <div className="space-y-2 rounded-xl border bg-slate-50 p-3 text-xs">
            <b className="text-slate-700">الطابعة (تُحفظ إعداداتها لهذا الجهاز)</b>
            {electron
              ? <select value={s.printerName} onChange={(e) => changePrinter(e.target.value)} className="w-full rounded-lg border px-2 py-1.5"><option value="">نافذة الطباعة (اختيار يدوي)</option>{printers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
              : <input value={s.printerName} onChange={(e) => changePrinter(e.target.value)} placeholder="اسم الطابعة للتذكير مثل XP-323B (اختياري)" className="w-full rounded-lg border px-2 py-1.5" />}
            <p className="text-slate-500">الكمبيوتر (USB): تطبيق سطح المكتب يطبع صامتاً على الطابعة المختارة. الموبايل (Bluetooth): تُفتح نافذة طباعة النظام فاختر الطابعة المقترنة أو احفظ PDF.</p>
          </div>
        </section>
      </div>
      {msg && <p role="status" className="border-t bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900">{msg}</p>}
    </div>
  </div>;
}
