import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  savePayrollLineItems,
  type PayrollLineItemKind,
  type PayrollRunLineDto,
} from '../../lib/api/payrollApi';
import { useToast } from '../NonBlockingToast';

const ADDITION_KINDS: PayrollLineItemKind[] = [
  'BONUS',
  'TRANSPORT',
  'ANNUAL_INCREASE',
  'SALARY_ADJUSTMENT',
  'SETTLEMENT_ADD',
];
const DEDUCTION_KINDS: PayrollLineItemKind[] = ['PURCHASE_DEDUCTION', 'SETTLEMENT_DEDUCT'];
const NOTE_REQUIRED = new Set<PayrollLineItemKind>(['SALARY_ADJUSTMENT', 'SETTLEMENT_ADD', 'SETTLEMENT_DEDUCT']);

type Row = { key: string; kind: PayrollLineItemKind; amount: string; note: string };

const isAddition = (k: PayrollLineItemKind) => ADDITION_KINDS.includes(k);
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let seq = 0;
const nextKey = () => `r${++seq}`;

type Props = {
  runId: string;
  line: PayrollRunLineDto;
  onClose: () => void;
  /** يُستدعى بعد حفظ ناجح ليعيد الأب تحميل المسير. */
  onSaved: () => void;
};

/**
 * TASK 011 (بشير): تفصيل بنود راتب موظف داخل مسير مسودة. المبالغ الجديدة تُضاف/تُخصم
 * فوق المستورد؛ والخادم يطرح أثر البنود القديمة قبل إضافة الجديدة فلا تكرار احتساب.
 */
export const PayrollLineItemsModal: React.FC<Props> = ({ runId, line, onClose, onSaved }) => {
  const { t } = useTranslation('salaries');
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>(() =>
    (line.items ?? []).map((it) => ({
      key: nextKey(),
      kind: it.kind,
      amount: String(it.amount),
      note: it.note ?? '',
    })),
  );
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    let add = 0;
    let ded = 0;
    for (const r of rows) {
      const a = Number(r.amount);
      if (!Number.isFinite(a) || a <= 0) continue;
      if (isAddition(r.kind)) add += a;
      else ded += a;
    }
    return { add, ded };
  }, [rows]);

  // الصافي المعروض = الحالي بعد استبدال البنود القديمة بالجديدة (نفس معادلة الخادم).
  const previousTotals = useMemo(() => {
    let add = 0;
    let ded = 0;
    for (const it of line.items ?? []) {
      const a = Number(it.amount);
      if (isAddition(it.kind)) add += a;
      else ded += a;
    }
    return { add, ded };
  }, [line.items]);
  const projectedNet =
    Number(line.net_salary) - previousTotals.add + totals.add + previousTotals.ded - totals.ded;

  const patch = (key: string, p: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const add = (kind: PayrollLineItemKind) =>
    setRows((cur) => [...cur, { key: nextKey(), kind, amount: '', note: '' }]);

  const invalid = rows.some(
    (r) => !(Number(r.amount) > 0) || (NOTE_REQUIRED.has(r.kind) && !r.note.trim()),
  );

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      await savePayrollLineItems(
        runId,
        line.id,
        rows.map((r) => ({ kind: r.kind, amount: Number(r.amount), note: r.note.trim() || null })),
      );
      showToast({ type: 'success', message: t('lineItems.saved') });
      onSaved();
      onClose();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('lineItems.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm';

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/55 p-4" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-black text-slate-900">{t('lineItems.title', { name: line.employee_name })}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-xs text-slate-500">{t('lineItems.hint')}</p>

          <div className="flex flex-wrap gap-2">
            {[...ADDITION_KINDS, ...DEDUCTION_KINDS].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => add(k)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${
                  isAddition(k)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                {t(`lineItems.kind.${k}`)}
              </button>
            ))}
          </div>

          {rows.length === 0 && <p className="text-sm text-slate-400">{t('lineItems.empty')}</p>}

          <ul className="space-y-2">
            {rows.map((r) => {
              const needsNote = NOTE_REQUIRED.has(r.kind);
              const missingNote = needsNote && !r.note.trim();
              return (
                <li
                  key={r.key}
                  className={`grid grid-cols-12 items-start gap-2 rounded-lg border p-2 ${
                    isAddition(r.kind) ? 'border-emerald-100 bg-emerald-50/40' : 'border-rose-100 bg-rose-50/40'
                  }`}
                >
                  <div className="col-span-12 sm:col-span-3 text-xs font-bold text-slate-700 pt-2">
                    {t(`lineItems.kind.${r.kind}`)}
                    <span className="block text-[10px] font-normal text-slate-400">
                      {isAddition(r.kind) ? t('lineItems.groupAdditions') : t('lineItems.groupDeductions')}
                    </span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={r.amount}
                    onChange={(e) => patch(r.key, { amount: e.target.value })}
                    placeholder={t('lineItems.amount')}
                    className={`${inputCls} col-span-5 sm:col-span-3`}
                    dir="ltr"
                  />
                  <div className="col-span-6 sm:col-span-5">
                    <input
                      value={r.note}
                      onChange={(e) => patch(r.key, { note: e.target.value })}
                      placeholder={r.kind === 'SALARY_ADJUSTMENT' ? t('lineItems.notePlaceholder') : t('lineItems.note')}
                      className={`${inputCls} ${missingNote ? 'border-rose-400' : ''}`}
                    />
                    {missingNote && <span className="text-[10px] text-rose-600">{t('lineItems.noteRequired')}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                    title={t('lineItems.remove')}
                    className="col-span-1 mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between"><span>{t('lineItems.totalAdditions')}</span><b className="text-emerald-700">{money(totals.add)}</b></div>
            <div className="flex justify-between"><span>{t('lineItems.totalDeductions')}</span><b className="text-rose-700">{money(totals.ded)}</b></div>
            <div className="flex justify-between border-t border-slate-200 pt-1"><span className="font-bold">{t('lineItems.net')}</span><b className="text-indigo-700">{money(projectedNet)}</b></div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              {t('lineItems.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || invalid}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('lineItems.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
