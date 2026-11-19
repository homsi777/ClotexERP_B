import assert from "node:assert/strict";
import { renderWarpCardHtml } from "./renderWarpCardHtml.js";
const html = renderWarpCardHtml({
  cardNo: "WC0000001",
  barcode: "WARP-1",
  data: { itemCode: "<FAB&1>", plannedLengthM: 100 },
});
assert.match(html, /WC0000001/);
assert.match(html, /&lt;FAB&amp;1&gt;/);
assert.doesNotMatch(html, /<FAB&1>/);
assert.match(html, /window\.print/);
console.log("renderWarpCardHtml tests passed");
