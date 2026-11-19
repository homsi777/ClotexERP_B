import assert from "node:assert/strict";
import { renderProductionQualityReportHtml } from "./renderProductionQualityReportHtml.js";
const html = renderProductionQualityReportHtml({ batch: { id:"1",batch_no:"B-1",status:"APPROVED",run_no:"R-1",work_order_no:"WO-1",loom_code:"L-1",production_date:"2026-11-19",operator_name:null,shift_name:null,counter_start:0,counter_end:100,produced_length_m:100,clean_length_m:90,rework_length_m:5,rejected_length_m:5,pending_length_m:0,received_roll_length_m:0,inspection_notes:"<script>bad</script>" }, defects: [], rolls: [] });
assert.match(html,/تقرير فحص جودة/); assert.doesNotMatch(html,/<script>bad<\/script>/); assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
console.log("renderProductionQualityReportHtml tests passed");
