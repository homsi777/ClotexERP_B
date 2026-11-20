import assert from 'node:assert/strict';
import {buildInvoiceFormLineDraftsFromDbLines} from './invoiceDbMappers';
const [line]=buildInvoiceFormLineDraftsFromDbLines([{quantity:40,unit:'meter',unit_price:7,customer_order_line_id:'order-line',metadata:{materialName:'Cotton',orderReferencePrice:12}}]);
assert.equal(line.price,'7');assert.equal(line.orderReferencePrice,12);assert.equal(line.customerOrderLineId,'order-line');
const [unpriced]=buildInvoiceFormLineDraftsFromDbLines([{quantity:10,unit:'meter',unit_price:0,metadata:{orderReferencePrice:12}}]);
assert.equal(unpriced.price,'');assert.equal(unpriced.orderReferencePrice,12);
console.log('Reopening an invoice preserves manual sale price separately from its order reference');
