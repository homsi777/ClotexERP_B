import { useState } from 'react';
import { Download, FileText, Loader2, Printer } from 'lucide-react';
import type { ReceiptView } from '../../lib/api/purchaseReceivingApi';
import { previewRollLabels } from '../../lib/api/labelsApi';
import { printRollLabels } from '../../lib/printing/printRollLabels';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { renderReceiptRollsA4Html, rollMainQty } from '../../lib/printing/renderReceiptRollsA4';

type Action = 'slip' | 'export' | 'print';

/** أزرار «إرسالية / تصدير / طباعة» للأتواب التي أُدخلت في إيصال استلام. */
export function ReceiptRollActions({ receipt }: { receipt: ReceiptView }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [err, setErr] = useState('');
  const rollIds = receipt.lines.flatMap((l) => l.rollIds ?? []);
  if (rollIds.length === 0) return null;

  const run = async (action: Action) => {
    setBusy(action); setErr('');
    try {
      const pv = await previewRollLabels(rollIds);
      if (!pv.data.length) { setErr('لا أتواب متاحة لهذا الإيصال (قد تكون بيعت أو نُقلت).'); return; }
      if (action === 'print') {
        const r = await printRollLabels(pv.data, { template: pv.template });
        if (!r.ok) setErr(r.error ?? 'تعذّرت الطباعة');
      } else if (action === 'slip') {
        const ok = openDocumentPrintWindow(renderReceiptRollsA4Html({ receiptNo: receipt.receiptNo, supplierName: receipt.supplierName, invoiceNo: receipt.invoiceNo, warehouseName: receipt.warehouseName, createdAt: receipt.createdAt, createdBy: receipt.createdBy, rolls: pv.data }), `إرسالية استلام ${receipt.receiptNo}`);
        if (!ok) setErr('المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة.');
      } else {
        const XLSX = await import('xlsx');
        const rows = pv.data.map((r, i) => {
          const q = rollMainQty(r);
          return { '#': i + 1, 'الباركود': r.barcode, 'المادة': r.itemName ?? '', 'كود الخامة': r.internalCode ?? '', 'اللون': r.colorNameAr ?? r.colorNameTr ?? '', 'كود اللون': r.colorCode ?? '', 'الأمتار': q.unit === 'm' ? q.value : null, 'الوزن (كغ)': q.unit === 'kg' ? q.value : (r.actualWeightKg ?? r.calculatedWeightKg), 'المستودع': r.warehouseName ?? '', 'رقم الإيصال': receipt.receiptNo };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'الأتواب');
        XLSX.writeFile(wb, `receipt-${receipt.receiptNo}.xlsx`);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذّر تنفيذ العملية'); } finally { setBusy(null); }
  };

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
  const Ico = ({ a, I }: { a: Action; I: typeof Printer }) => (busy === a ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <I className="h-3.5 w-3.5" />);
  return <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
    <button type="button" disabled={busy !== null} onClick={() => void run('slip')} className={btn}><Ico a="slip" I={FileText} />إرسالية</button>
    <button type="button" disabled={busy !== null} onClick={() => void run('export')} className={btn}><Ico a="export" I={Download} />تصدير</button>
    <button type="button" disabled={busy !== null} onClick={() => void run('print')} className={btn}><Ico a="print" I={Printer} />طباعة ({rollIds.length})</button>
    {err && <span className="text-[11px] font-bold text-rose-700">{err}</span>}
  </span>;
}
