/**
 * TASK 006 — المرحلة الثانية: اختبارات assertVoucherCancellationAllowed.
 *
 * عميل Postgres مزيّف (لا نفق قاعدة بيانات معزولة متاح وقت الكتابة — نفس
 * القيد الموثَّق بـexternalJobProcessing.test.ts) يحاكي استعلام
 * sales_invoices/purchase_invoices اللازم للحارس فقط.
 */
import assert from 'node:assert/strict';
import { assertVoucherCancellationAllowed } from './voucherCashboxService.js';

const COMPANY = 'company-1';

function createFakeClient(invoiceRows: { document_status: string }[]) {
  return {
    query: async () => ({ rows: invoiceRows }),
  };
}

async function testDraftVoucherNeverBlocked() {
  const client = createFakeClient([{ document_status: 'CONFIRMED' }]);
  await assertVoucherCancellationAllowed(client, COMPANY, {
    status: 'DRAFT',
    reference_document_type: 'SALE_INVOICE',
    reference_document_no: 'FB0000142',
  });
}

async function testConfirmedVoucherWithNoReferenceIsAllowed() {
  const client = createFakeClient([]);
  await assertVoucherCancellationAllowed(client, COMPANY, {
    status: 'CONFIRMED',
    reference_document_type: null,
    reference_document_no: null,
  });
}

async function testConfirmedReceiptLinkedToActiveSaleInvoiceIsBlocked() {
  const client = createFakeClient([{ document_status: 'CONFIRMED' }]);
  await assert.rejects(
    assertVoucherCancellationAllowed(client, COMPANY, {
      status: 'CONFIRMED',
      reference_document_type: 'SALE_INVOICE',
      reference_document_no: 'FB0000142',
    }),
    /مرتبط بفاتورة بيع/,
  );
}

async function testConfirmedPaymentLinkedToActivePurchaseInvoiceIsBlocked() {
  const client = createFakeClient([{ document_status: 'CONFIRMED' }]);
  await assert.rejects(
    assertVoucherCancellationAllowed(client, COMPANY, {
      status: 'CONFIRMED',
      reference_document_type: 'PURCHASE_INVOICE',
      reference_document_no: 'PI0000050',
    }),
    /مرتبط بفاتورة شراء/,
  );
}

async function testVoidedLinkedInvoiceIsAllowed() {
  // الفاتورة نفسها أُلغيت بالفعل (ضمن مسار voidSalesInvoice الذي يستدعي
  // cancelConfirmedVoucher مباشرة، لا هذا الحارس) — إلغاء السند بعدها
  // متّسق، لا تعارض.
  const client = createFakeClient([{ document_status: 'VOIDED' }]);
  await assertVoucherCancellationAllowed(client, COMPANY, {
    status: 'CONFIRMED',
    reference_document_type: 'SALE_INVOICE',
    reference_document_no: 'FB0000142',
  });
}

async function testUnmatchedReferenceNoIsAllowed() {
  // لا فاتورة بهذا الرقم فعلياً (مرجع قديم/تجريبي) — لا تعارض ممكناً.
  const client = createFakeClient([]);
  await assertVoucherCancellationAllowed(client, COMPANY, {
    status: 'CONFIRMED',
    reference_document_type: 'SALE_INVOICE',
    reference_document_no: 'DOES-NOT-EXIST',
  });
}

async function main() {
  await testDraftVoucherNeverBlocked();
  await testConfirmedVoucherWithNoReferenceIsAllowed();
  await testConfirmedReceiptLinkedToActiveSaleInvoiceIsBlocked();
  await testConfirmedPaymentLinkedToActivePurchaseInvoiceIsBlocked();
  await testVoidedLinkedInvoiceIsAllowed();
  await testUnmatchedReferenceNoIsAllowed();
  console.log('voucherCashboxService.test.ts OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
