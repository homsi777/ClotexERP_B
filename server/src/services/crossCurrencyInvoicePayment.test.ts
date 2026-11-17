/**
 * سياسة العملات (بشير) — اختبارات انتكاس للثغرة المُصحَّحة: سند قبض/دفع
 * بعملة مختلفة عن عملة الفاتورة كان يُخصَم رقمياً مباشرة من المتبقي بلا أي
 * تحويل (validateSaleInvoiceReceiptVoucher/applySaleInvoiceReceiptOnVoucherConfirm
 * وصنوَيهما لفاتورة الشراء). عميل Postgres مزيّف — لا نفق قاعدة بيانات
 * معزولة متاح وقت الكتابة، نفس قيد externalJobProcessing.test.ts.
 */
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import {
  validateSaleInvoiceReceiptVoucher,
  applySaleInvoiceReceiptOnVoucherConfirm,
} from './salesInvoiceService.js';

const COMPANY = 'company-1';
const CUSTOMER = 'customer-1';

/** يحاكي صف فاتورة sales_invoices بعملته الخاصة ومتبقيها، ويسجّل آخر UPDATE. */
function createFakeInvoiceClient(invoiceRow: {
  document_status: string;
  remaining_amount: string;
  payment_status: string;
  customer_id: string;
  currency_code: string;
  exchange_rate_to_usd: string;
  id?: string;
  total_amount?: string;
  paid_amount?: string;
}) {
  let lastUpdateParams: unknown[] | null = null;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('SELECT')) {
        return {
          rows: [
            {
              id: invoiceRow.id ?? 'inv-1',
              document_status: invoiceRow.document_status,
              remaining_amount: invoiceRow.remaining_amount,
              payment_status: invoiceRow.payment_status,
              customer_id: invoiceRow.customer_id,
              currency_code: invoiceRow.currency_code,
              exchange_rate_to_usd: invoiceRow.exchange_rate_to_usd,
              total_amount: invoiceRow.total_amount ?? '1000',
              paid_amount: invoiceRow.paid_amount ?? '0',
            },
          ],
        };
      }
      if (s.startsWith('UPDATE')) {
        lastUpdateParams = params ?? null;
        return { rows: [] };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  return { client, getLastUpdateParams: () => lastUpdateParams };
}

async function testSameCurrencyStillWorksExactlyAsBeforeValidate() {
  const { client } = createFakeInvoiceClient({
    document_status: 'CONFIRMED',
    remaining_amount: '100',
    payment_status: 'partial',
    customer_id: CUSTOMER,
    currency_code: 'USD',
    exchange_rate_to_usd: '1',
  });
  // سند 100 دولار يسدّد فاتورة 100$ متبقية — يجب أن يمر بلا أي خطأ (توافق خلفي).
  await validateSaleInvoiceReceiptVoucher(client, COMPANY, {
    voucherType: 'RECEIPT',
    amount: 100,
    referenceDocumentType: 'SALE_INVOICE',
    referenceDocumentNo: 'FB0001',
    partyType: 'CUSTOMER',
    partyId: CUSTOMER,
    currencyCode: 'USD',
    exchangeRateToUsd: 1,
  });
}

async function testCrossCurrencyReceiptConvertedBeforeValidation() {
  // فاتورة بالجنيه المصري (سعر الصرف 50 ج.م=1$) متبقيها 4000 ج.م (=80$).
  const { client } = createFakeInvoiceClient({
    document_status: 'CONFIRMED',
    remaining_amount: '4000',
    payment_status: 'partial',
    customer_id: CUSTOMER,
    currency_code: 'EGP',
    exchange_rate_to_usd: '50',
  });
  // سند قبض 100 دولار = 5000 ج.م — يتجاوز المتبقي (4000 ج.م) بعد التحويل
  // الصحيح، فيجب أن يُرفَض. بدون التحويل (الثغرة القديمة) كان 100 < 4000
  // رقمياً فيُقبَل خطأً — هذا الاختبار يثبت أن التحويل يُطبَّق فعلياً.
  await assert.rejects(
    validateSaleInvoiceReceiptVoucher(client, COMPANY, {
      voucherType: 'RECEIPT',
      amount: 100,
      referenceDocumentType: 'SALE_INVOICE',
      referenceDocumentNo: 'FB0002',
      partyType: 'CUSTOMER',
      partyId: CUSTOMER,
      currencyCode: 'USD',
      exchangeRateToUsd: 1,
    }),
    /يتجاوز المتبقي/,
  );
}

async function testCrossCurrencyReceiptWithinRemainingIsAccepted() {
  const { client } = createFakeInvoiceClient({
    document_status: 'CONFIRMED',
    remaining_amount: '4000', // ج.م، = 80$
    payment_status: 'partial',
    customer_id: CUSTOMER,
    currency_code: 'EGP',
    exchange_rate_to_usd: '50',
  });
  // سند قبض 50 دولار = 2500 ج.م — أقل من المتبقي (4000 ج.م)، يجب أن يُقبَل.
  await validateSaleInvoiceReceiptVoucher(client, COMPANY, {
    voucherType: 'RECEIPT',
    amount: 50,
    referenceDocumentType: 'SALE_INVOICE',
    referenceDocumentNo: 'FB0003',
    partyType: 'CUSTOMER',
    partyId: CUSTOMER,
    currencyCode: 'USD',
    exchangeRateToUsd: 1,
  });
}

async function testApplyConvertsBeforeDeductingFromInvoiceCurrency() {
  const { client, getLastUpdateParams } = createFakeInvoiceClient({
    document_status: 'CONFIRMED',
    remaining_amount: '4000', // ج.م
    payment_status: 'partial',
    customer_id: CUSTOMER,
    currency_code: 'EGP',
    exchange_rate_to_usd: '50',
    total_amount: '10000',
    paid_amount: '6000',
  });
  // سند قبض 50 دولار = 2500 ج.م يجب أن يُضاف لـpaid_amount بالجنيه، لا 50
  // حرفياً (كانت الثغرة القديمة تخصم 50 رقماً من رصيد بالجنيه مباشرة).
  await applySaleInvoiceReceiptOnVoucherConfirm(client, COMPANY, 'user-1', {
    voucherId: 'v-1',
    voucherType: 'RECEIPT',
    amount: 50,
    referenceDocumentType: 'SALE_INVOICE',
    referenceDocumentNo: 'FB0004',
    partyType: 'CUSTOMER',
    partyId: CUSTOMER,
    currencyCode: 'USD',
    exchangeRateToUsd: 1,
  });
  const params = getLastUpdateParams();
  assert.ok(params, 'expected UPDATE sales_invoices to run');
  // ترتيب params بالدالة الحقيقية: [id, companyId, newPaid, remaining, status, paidUsd, remainingUsd, voucherId, userId]
  const newPaid = Number(params![2]);
  const newRemaining = Number(params![3]);
  assert.equal(newPaid, 8500, `expected newPaid=6000+2500=8500, got ${newPaid}`); // 6000 + 2500
  assert.equal(newRemaining, 1500, `expected newRemaining=4000-2500=1500, got ${newRemaining}`);
}

async function main() {
  await testSameCurrencyStillWorksExactlyAsBeforeValidate();
  await testCrossCurrencyReceiptConvertedBeforeValidation();
  await testCrossCurrencyReceiptWithinRemainingIsAccepted();
  await testApplyConvertsBeforeDeductingFromInvoiceCurrency();
  console.log('crossCurrencyInvoicePayment.test.ts OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
