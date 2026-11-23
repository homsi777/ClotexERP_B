import { DateInput } from '../components/common/DateInput';
import React, { useEffect, useMemo, useState } from 'react';
import { useCurrencyWithBranchDefault } from '../hooks/useDefaultCurrency';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Printer, FileText, Search, CreditCard, Loader2, Plus, Trash2 } from 'lucide-react';
import { createVoucher, confirmVoucher, getVoucher, type VoucherLineInput, type VoucherLinePaymentMethod, type VoucherRow } from '../lib/api/vouchersApi';
import { listCashboxes, type CashboxAccountKind, type CashboxDto } from '../lib/api/cashboxesApi';
import { listCustomers, type ApiCustomer } from '../lib/api/customersApi';
import { listSuppliers, type ApiSupplier } from '../lib/api/suppliersApi';
import { ApiRequestError } from '../lib/api/client';
import { sendTelegramVoucherFromRow } from '../lib/telegramVoucher';
import { focusNextFormControl } from '../lib/forms/enterNavigation';
import { listExchangeRates, type ExchangeRateDto } from '../lib/api/exchangeRatesApi';
import { convertToUsd, getCurrencyLabel, normalizeExchangeRate, round2 } from '../lib/currency';
import { useToast } from '../components/NonBlockingToast';
import { VoucherPrintModal } from '../components/VoucherPrintModal';
import { ExchangeRateField, resolveExchangeRate } from '../components/ExchangeRateField';
import { ConvertCurrencyField, NO_CONVERSION, conversionPayload, type CurrencyConversion } from '../components/ConvertCurrencyField';
import { CheckEntryFields, emptyCheckDraft, isCheckDraftComplete, type CheckDraft } from '../components/treasury/CheckEntryFields';
import {
  getReceiptPurposeOptions,
  type VoucherPurpose,
} from '../lib/voucherPurpose';
import { todayYmd } from '../lib/businessDate';

type PartyKind = 'CUSTOMER' | 'SUPPLIER' | 'OTHER';

type SplitLine = { localId: string; cashboxId: string; amount: string; transactionRef: string; transactionDate: string; check: CheckDraft };

/** قيمة خاصة في قائمة صندوق البند: «شيك» بلا اختيار خزينة (تُحدَّد تلقائياً بعملة السند). */
const CHECK_SENTINEL = '__CHECK__';

let splitLineSeq = 0;
const nextSplitLineId = () => `sl-${++splitLineSeq}`;

const accountKindToPaymentMethod = (kind: CashboxAccountKind): VoucherLinePaymentMethod => {
  if (kind === 'BANK') return 'BANK';
  if (kind === 'WALLET') return 'WALLET';
  if (kind === 'CHECKS') return 'CHECK';
  return 'CASH';
};

export const CollectionBonds = () => {
  const { t, i18n } = useTranslation('collectionBonds');
  const { showToast } = useToast();
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voucherNo, setVoucherNo] = useState<string | null>(null);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [currentVoucher, setCurrentVoucher] = useState<VoucherRow | null>(null);

  const [amount, setAmount] = useState('');
  const [voucherDate, setVoucherDate] = useState(() => todayYmd());
  const [cashboxId, setCashboxId] = useState('');
  const [partyKind, setPartyKind] = useState<PartyKind>('CUSTOMER');
  const [partyId, setPartyId] = useState('');
  const [customerOrderNo,setCustomerOrderNo]=useState('');
  useEffect(()=>setCustomerOrderNo(''),[partyId,partyKind]);
  const [partyName, setPartyName] = useState('');
  const [purpose, setPurpose] = useState<VoucherPurpose>('INVOICE_PAYMENT');
  const [description, setDescription] = useState('');
  const [currencyCode, setCurrencyCode] = useCurrencyWithBranchDefault<'USD' | 'SYP' | 'TRY' | 'EGP'>(['USD', 'SYP', 'TRY', 'EGP'] as const);
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('1');
  const [manualRate, setManualRate] = useState(false);
  const [conversion, setConversion] = useState<CurrencyConversion>(NO_CONVERSION);
  const storedRate = useMemo(() => {
    const row = exchangeRates.find((r) => r.currency_code === currencyCode);
    const n = row ? Number(row.exchange_rate_to_usd) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [exchangeRates, currencyCode]);
  const [searchParams] = useSearchParams();
  /** طريقة القبض بالسند الأحادي: صندوق/بنك أو شيك (من زر «استلام شيك» بخزينة الشيكات تُفتح على شيك). */
  const [singleMethod, setSingleMethod] = useState<'CASHBOX' | 'CHECK'>(() => (searchParams.get('method') === 'check' ? 'CHECK' : 'CASHBOX'));
  const [splitMode, setSplitMode] = useState(false);
  const [splitLines, setSplitLines] = useState<SplitLine[]>([]);
  /** بيانات الشيك عند اختيار خزينة الشيكات بالسند الأحادي. */
  const [singleCheck, setSingleCheck] = useState<CheckDraft>(emptyCheckDraft());

  /** حسابات غير خزينة الشيكات فقط — ربط الشيكات يتم من خزينة الشيكات مباشرة. */
  const splittableCashboxes = useMemo(() => cashboxes.filter((c) => c.account_kind !== 'CHECKS'), [cashboxes]);

  const splitLinesSum = useMemo(
    () => round2(splitLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)),
    [splitLines],
  );
  const splitMismatch = splitMode && splitLines.length > 0 && Math.abs(splitLinesSum - (Number(amount) || 0)) > 0.01;

  const addSplitLine = () => {
    setSplitLines((prev) => [
      ...prev,
      { localId: nextSplitLineId(), cashboxId: splittableCashboxes[0]?.id || '', amount: '', transactionRef: '', transactionDate: '', check: emptyCheckDraft() },
    ]);
  };
  const removeSplitLine = (localId: string) => {
    setSplitLines((prev) => prev.filter((l) => l.localId !== localId));
  };
  const updateSplitLine = (localId: string, patch: Partial<SplitLine>) => {
    setSplitLines((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)));
  };

  const selectedCashbox = useMemo(
    () => cashboxes.find((c) => c.id === cashboxId) ?? null,
    [cashboxes, cashboxId],
  );

  /** السند الأحادي على خزينة الشيكات ⇒ شيك جديد يُستلَم (يُنشأ سجله عند الحفظ). */
  const singleIsCheck = !splitMode && (singleMethod === 'CHECK' || selectedCashbox?.account_kind === 'CHECKS');
  const isCheckLine = (l: SplitLine) => l.cashboxId === CHECK_SENTINEL || cashboxes.find((c) => c.id === l.cashboxId)?.account_kind === 'CHECKS';
  /** العملة تُختار يدوياً عند القبض بشيك لعدم وجود صندوق يحددها. */
  const currencyEditable = (!splitMode && singleMethod === 'CHECK') || (splitMode && splitLines.some((l) => l.cashboxId === CHECK_SENTINEL));

  const purposeHint = useMemo(
    () => getReceiptPurposeOptions().find((o) => o.value === purpose)?.hint ?? '',
    [purpose, i18n.language],
  );

  useEffect(() => {
    void (async () => {
      setLoadingMeta(true);
      try {
        const [c, cust, sup, r] = await Promise.all([
          listCashboxes({ active: true }),
          listCustomers({ pageSize: 500 }),
          listSuppliers({ pageSize: 500 }),
          listExchangeRates(),
        ]);
        setCashboxes(c.data);
        setCustomers(cust.data);
        setSuppliers(sup.data);
        setExchangeRates(r.data);
        if (c.data.length && !cashboxId) setCashboxId(c.data[0].id);
      } catch {
        showToast({ type: 'error', message: t('errors.loadMetaFailed') });
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  useEffect(() => {
    setPartyId('');
    setPartyName('');
  }, [partyKind]);

  useEffect(() => {
    if (singleMethod === 'CHECK') return;
    const box = cashboxes.find((c) => c.id === cashboxId);
    if (!box) return;
    const code = String(box.currency_code || 'USD').trim().toUpperCase() as any;
    if (code === 'USD' || code === 'SYP' || code === 'TRY' || code === 'EGP') {
      setCurrencyCode(code);
      const rateRow = exchangeRates.find((r) => r.currency_code === code);
      setExchangeRateToUsd(code === 'USD' ? '1' : String(rateRow?.exchange_rate_to_usd ?? '1'));
    }
  }, [cashboxId, cashboxes, exchangeRates, singleMethod]);

  useEffect(() => {
    if (currencyCode === 'USD') {
      setExchangeRateToUsd('1');
      return;
    }
    const rateRow = exchangeRates.find((r) => r.currency_code === currencyCode);
    setExchangeRateToUsd(String(rateRow?.exchange_rate_to_usd ?? exchangeRateToUsd));
  }, [currencyCode, exchangeRates]);

  const resolveParty = () => {
    if (partyKind === 'CUSTOMER') {
      const cust = customers.find((x) => x.id === partyId);
      return {
        partyType: partyId ? ('CUSTOMER' as const) : ('OTHER' as const),
        partyId: partyId || null,
        partyName: cust?.name || partyName.trim() || t('defaultPartyName'),
      };
    }
    if (partyKind === 'SUPPLIER') {
      const sup = suppliers.find((x) => x.id === partyId);
      return {
        partyType: partyId ? ('SUPPLIER' as const) : ('OTHER' as const),
        partyId: partyId || null,
        partyName: sup?.name || partyName.trim() || t('defaultPartyName'),
      };
    }
    return {
      partyType: 'OTHER' as const,
      partyId: null,
      partyName: partyName.trim() || t('defaultPartyName'),
    };
  };

  const saveAndConfirm = async () => {
    if (!splitMode && !singleIsCheck && !cashboxId) {
      showToast({ type: 'warning', message: t('errors.chooseCashbox') });
      return;
    }
    if (singleIsCheck && !isCheckDraftComplete(singleCheck)) {
      showToast({ type: 'warning', message: t('check.incomplete') });
      return;
    }
    if (splitMode) {
      if (splitLines.some((l) => isCheckLine(l) && !isCheckDraftComplete(l.check))) {
        showToast({ type: 'warning', message: t('check.incomplete') });
        return;
      }
      if (splitLines.length === 0) {
        showToast({ type: 'warning', message: t('split.noLinesWarning') });
        return;
      }
      if (splitLines.some((l) => !l.cashboxId || !(Number(l.amount) > 0))) {
        showToast({ type: 'warning', message: t('split.incompleteLineWarning') });
        return;
      }
      if (splitMismatch) {
        showToast({ type: 'warning', message: t('split.sumMismatchWarning', { sum: splitLinesSum, total: Number(amount) || 0 }) });
        return;
      }
    }
    setSaving(true);
    try {
      if (!splitMode && !singleIsCheck) {
        const boxCurrency = cashboxes.find((c) => c.id === (cashboxId || ''))?.currency_code;
        if (boxCurrency && String(boxCurrency).trim().toUpperCase() !== String(currencyCode).trim().toUpperCase()) {
          showToast({ type: 'error', message: t('errors.currencyMismatch') });
          return;
        }
      } else if (splitMode) {
        const mismatchedLine = splitLines.find((l) => {
          const box = cashboxes.find((c) => c.id === l.cashboxId);
          return box && String(box.currency_code).trim().toUpperCase() !== String(currencyCode).trim().toUpperCase();
        });
        if (mismatchedLine) {
          showToast({ type: 'error', message: t('errors.currencyMismatch') });
          return;
        }
      }
      const party = resolveParty();
      const rate = (currencyCode !== 'USD' && !manualRate ? 1 : resolveExchangeRate({ currencyCode, manual: manualRate, manualValue: exchangeRateToUsd, storedRate, normalize: normalizeExchangeRate }));
      if (!rate) {
        showToast({ type: 'error', message: t('errors.invalidExchangeRate') });
        return;
      }
      const amountOriginal = Number(amount) || 0;
      const amountUsd = currencyCode !== 'USD' && !manualRate ? 0 : round2(convertToUsd(amountOriginal, rate));
      const checkPayload = (d: CheckDraft) => ({
        checkNo: d.checkNo.trim(),
        bankName: d.bankName.trim(),
        accountHolderName: d.accountHolderName.trim() || null,
        dueDate: d.dueDate,
        imageData: d.imageData,
      });
      const lines: VoucherLineInput[] | undefined = splitMode
        ? splitLines.map((l) => {
            const box = cashboxes.find((c) => c.id === l.cashboxId);
            const chk = isCheckLine(l);
            return {
              cashboxId: l.cashboxId === CHECK_SENTINEL ? null : l.cashboxId,
              paymentMethod: chk ? ('CHECK' as VoucherLinePaymentMethod) : accountKindToPaymentMethod(box?.account_kind ?? 'CASH'),
              amount: Number(l.amount) || 0,
              transactionRef: l.transactionRef.trim() || null,
              transactionDate: l.transactionDate || null,
              ...(chk ? { checkDetails: checkPayload(l.check) } : {}),
            };
          })
        : singleIsCheck
          ? [{ cashboxId: selectedCashbox?.account_kind === 'CHECKS' ? cashboxId : null, paymentMethod: 'CHECK' as VoucherLinePaymentMethod, amount: amountOriginal, checkDetails: checkPayload(singleCheck) }]
          : undefined;
      const created = await createVoucher({
        voucherType: 'RECEIPT',
        voucherDate,
        cashboxId: splitMode || singleIsCheck ? null : cashboxId,
        partyType: party.partyType,
        partyId: party.partyId,
        partyName: party.partyName,
        amount: amountOriginal,
        currencyCode,
        exchangeRateToUsd: rate,
        convertToUsd: currencyCode === 'USD' || manualRate,
        amountUsd,
        ...conversionPayload(conversion),
        purpose,
        description: description || null,
        referenceDocumentType:customerOrderNo.trim()?'CUSTOMER_ORDER':null,
        referenceDocumentNo:customerOrderNo.trim()||null,
        lines,
      });
      setVoucherNo(created.data.voucher_no);
      await confirmVoucher(created.data.id);
      const saved = await getVoucher(created.data.id);
      const voucherSnapshot: VoucherRow = {
        ...saved.data,
        cashbox_name:
          saved.data.cashbox_name || selectedCashbox?.name || cashboxes.find((cashbox) => cashbox.id === cashboxId)?.name || null,
      };
      setCurrentVoucher(voucherSnapshot);
      setPrintModalOpen(true);
      showToast({ type: 'success', message: t('success.saved', { voucherNo: created.data.voucher_no }) });

      setAmount('');
      setSingleCheck(emptyCheckDraft());
      setDescription('');
      setPartyId('');
      setPartyName('');
      setPurpose('INVOICE_PAYMENT');
      setSplitMode(false);
      setSplitLines([]);

      try {
        await sendTelegramVoucherFromRow(voucherSnapshot);
      } catch (error) {
        console.warn('Telegram receipt voucher failed', error);
      }
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : t('errors.saveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">
            {t('pageSubtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="bg-white border px-4 py-2 rounded-lg opacity-60 cursor-not-allowed" disabled>
            <Search className="w-4 h-4 inline ml-1" />
            {t('searchButton')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-500" />
            {t('voucherDataLabel')}{' '}
            <span className="text-emerald-600 font-mono">{voucherNo || (loadingMeta ? '...' : t('voucherNoPending'))}</span>
          </h3>
          <div className="text-sm text-slate-500">{t('dateLabel')} {new Date().toLocaleDateString(i18n.language === 'ar' ? 'ar-SA' : 'tr-TR')}</div>
        </div>

        <div className="p-6 space-y-6" data-enter-scope>
          {loadingMeta ? (
            <div className="flex text-slate-500 items-center">
              <Loader2 className="w-5 h-5 animate-spin ml-2" />
              {t('loading')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 relative">
                  <label className="block text-sm font-medium text-slate-700">{t('amountLabel')}</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 pr-12 bg-slate-50 border border-slate-200 rounded-lg font-bold text-emerald-600 text-lg"
                  />
                  <span className="absolute right-3 top-9 text-slate-400 text-sm">{currencyCode}</span>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-600">{t('currencyLabel')}</label>
                      {currencyEditable ? (
                        <select
                          value={currencyCode}
                          onChange={(e) => setCurrencyCode(e.target.value as 'USD' | 'SYP' | 'TRY' | 'EGP')}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-700"
                        >
                          {(['EGP', 'USD', 'SYP', 'TRY'] as const).map((c) => (
                            <option key={c} value={c}>{getCurrencyLabel(c)}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          readOnly
                          value={getCurrencyLabel(currencyCode)}
                          className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-slate-700"
                        />
                      )}
                    </div>
                    <ExchangeRateField
                      currencyCode={currencyCode}
                      storedRate={storedRate}
                      manual={manualRate}
                      noConversionWhenOff
                      onManualChange={setManualRate}
                      value={exchangeRateToUsd}
                      onValueChange={setExchangeRateToUsd}
                      onKeyDown={focusNextFormControl}
                    />
                    <ConvertCurrencyField amount={Number(amount) || 0} currencyCode={currencyCode} rates={exchangeRates} value={conversion} onChange={setConversion} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">{t('dateFieldLabel')}</label>
                  <DateInput
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="text-sm font-bold text-slate-900">{t('cashboxSectionTitle')}</h4>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={splitMode}
                      onChange={(e) => {
                        setSplitMode(e.target.checked);
                        if (e.target.checked && splitLines.length === 0) addSplitLine();
                      }}
                    />
                    {t('split.enableToggle')}
                  </label>
                </div>

                {!splitMode ? (
                  <div className="space-y-2">
                    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-sm">
                      <button type="button" onClick={() => setSingleMethod('CASHBOX')} className={`px-4 py-2 font-bold ${singleMethod === 'CASHBOX' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>
                        {t('check.methodCashbox')}
                      </button>
                      <button type="button" onClick={() => setSingleMethod('CHECK')} className={`px-4 py-2 font-bold ${singleMethod === 'CHECK' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>
                        {t('check.methodCheck')}
                      </button>
                    </div>
                    {singleMethod === 'CASHBOX' && (
                    <>
                    <label className="block text-sm font-medium text-slate-700">{t('cashboxLabel')}</label>
                    <div className="relative">
                      <CreditCard className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
                      <select
                        value={cashboxId}
                        onChange={(e) => setCashboxId(e.target.value)}
                        onKeyDown={focusNextFormControl}
                        className="w-full p-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <option value="">{t('chooseOption')}</option>
                        {cashboxes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({String(c.currency_code || 'USD').toUpperCase()})
                          </option>
                        ))}
                      </select>
                    </div>
                    </>
                    )}
                    {singleIsCheck && (
                      <div className="space-y-2 pt-1">
                        <h5 className="text-sm font-bold text-slate-800">{t('check.sectionTitle')}</h5>
                        <CheckEntryFields value={singleCheck} onChange={setSingleCheck} />
                        <p className="text-xs text-slate-500">{t('check.singleHint')}</p>
                        {singleMethod === 'CHECK' && <p className="text-xs text-indigo-700">{t('check.autoBoxHint')}</p>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {splitLines.map((line) => (
                      <div key={line.localId} className="space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-center bg-slate-50 border border-slate-200 rounded-lg p-2">
                        <select
                          value={line.cashboxId}
                          onChange={(e) => updateSplitLine(line.localId, { cashboxId: e.target.value })}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm"
                        >
                          <option value="">{t('chooseOption')}</option>
                          <option value={CHECK_SENTINEL}>{t('check.lineLabel')}</option>
                          {cashboxes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({t(`split.kind.${c.account_kind}`)})
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={line.amount}
                          onChange={(e) => updateSplitLine(line.localId, { amount: e.target.value })}
                          placeholder={t('amountLabel')}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-mono"
                        />
                        <input
                          value={line.transactionRef}
                          onChange={(e) => updateSplitLine(line.localId, { transactionRef: e.target.value })}
                          placeholder={t('split.transactionRefPlaceholder')}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm"
                        />
                        <DateInput
                          value={line.transactionDate}
                          onChange={(e) => updateSplitLine(line.localId, { transactionDate: e.target.value })}
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeSplitLine(line.localId)}
                          className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg justify-self-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {isCheckLine(line) && (
                        <CheckEntryFields value={line.check} onChange={(check) => updateSplitLine(line.localId, { check })} />
                      )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addSplitLine}
                      className="flex items-center gap-1 text-sm font-bold text-emerald-700 hover:text-emerald-800"
                    >
                      <Plus className="w-4 h-4" /> {t('split.addLineButton')}
                    </button>
                    <div className={`text-sm font-bold flex justify-between px-1 ${splitMismatch ? 'text-rose-600' : 'text-slate-600'}`}>
                      <span>{t('split.sumLabel')}: {splitLinesSum.toLocaleString()} {currencyCode}</span>
                      <span>{t('split.totalLabel')}: {(Number(amount) || 0).toLocaleString()} {currencyCode}</span>
                    </div>
                    {splitMismatch && (
                      <p className="text-xs text-rose-600">{t('split.sumMismatchHint')}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 border-b pb-2">{t('partySectionTitle')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">{t('partyTypeLabel')}</label>
                    <select
                      value={partyKind}
                      onChange={(e) => setPartyKind(e.target.value as PartyKind)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <option value="CUSTOMER">{t('partyTypeCustomer')}</option>
                      <option value="SUPPLIER">{t('partyTypeSupplier')}</option>
                      <option value="OTHER">{t('partyTypeOther')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">{t('purposeLabel')}</label>
                    <select
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value as VoucherPurpose)}
                      onKeyDown={focusNextFormControl}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      {getReceiptPurposeOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {purposeHint ? <p className="text-xs text-slate-500">{purposeHint}</p> : null}
                  </div>
                </div>

                {partyKind==='CUSTOMER'&&partyId&&<label className="block text-sm">رقم أوردر العميل (اختياري)<input aria-label="رقم الأوردر المرتبط بسند القبض" value={customerOrderNo} onChange={e=>setCustomerOrderNo(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5"/></label>}
                {partyKind === 'CUSTOMER' ? (
                  <select
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="">{t('registeredCustomerOption')}</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                {partyKind === 'SUPPLIER' ? (
                  <select
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    onKeyDown={focusNextFormControl}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="">{t('registeredSupplierOption')}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                <input
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  onKeyDown={focusNextFormControl}
                  placeholder={partyKind === 'OTHER' ? t('payerNamePlaceholder') : t('manualNamePlaceholder')}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                />
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={focusNextFormControl}
                  placeholder={t('descriptionPlaceholder')}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                />
                {purpose === 'ADVANCE' ? (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    {t('advanceHint')}
                  </p>
                ) : null}
              </div>

              <div className="flex justify-end pt-4 border-t">
                <button
                  type="button"
                  disabled={saving || !cashboxes.length || splitMismatch}
                  onClick={() => void saveAndConfirm()}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" />
                  {t('saveButton')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <VoucherPrintModal
        isOpen={printModalOpen}
        voucher={currentVoucher}
        onClose={() => setPrintModalOpen(false)}
      />
    </div>
  );
};
