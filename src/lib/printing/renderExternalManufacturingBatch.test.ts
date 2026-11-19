import assert from 'node:assert/strict';
import { renderExternalManufacturingBatch } from './renderExternalManufacturingBatch';
import type { ManufacturingOverview } from '../api/externalManufacturingApi';
const data={job:{job_no:'EJ0000001',supplier_name:'A&B'}} as ManufacturingOverview;
const batch={id:'b',dye_paper_no:'DYE-1',received_at:'2026-11-19',notes:'<script>bad()</script>',attachments:[],service_ids:[],lines:[{id:'r',source_line_id:'l',original_barcode:'0000001',barcode:'0000002',length_m:35.125,weight_kg:null,defective:true,defect_reason:'DYE_HOUSE',responsible_party:'<img src=x>',notes:'Check shade',resolution:null,resolution_notes:null,resolved_at:null,status:'RESERVED'}]} as ManufacturingOverview['batches'][number];
const html=renderExternalManufacturingBatch(data,batch);
assert.ok(html.includes('EJ0000001'));assert.ok(html.includes('DYE-1'));assert.ok(html.includes('A&amp;B'));assert.ok(html.includes('35.125'));
assert.ok(html.includes('0000001'));assert.ok(html.includes('0000002'));assert.ok(html.includes('بانتظار القرار'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));
console.log('External manufacturing receipt print: traceability, precision, quality and safe HTML passed');
