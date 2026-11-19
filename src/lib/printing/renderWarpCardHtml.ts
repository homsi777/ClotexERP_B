const esc = (value: unknown) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
export function renderWarpCardHtml(input: { cardNo: string; barcode: string; data: Record<string, unknown> }) {
  const d = input.data,
    rows = [
      ["رقم الصنف", d.itemCode],
      ["المرياج", d.mirageCount],
      ["الطول", d.plannedLengthM],
      ["النول", d.loom],
      ["عرض المشط", d.reedWidth],
      ["إجمالي عدد الخيوط", d.totalWarpThreads],
      ["عدد الأربطة", d.tieCount],
      ["نمرة السداء", d.warpYarnCount],
      ["اسم المسدي", d.operatorName],
      ["الوردية", d.shiftName],
    ];
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(input.cardNo)}</title><style>@page{size:A5 landscape;margin:8mm}body{font-family:Arial,sans-serif;color:#111}h1{text-align:center;font-size:20px}.meta{display:flex;justify-content:space-between;margin-bottom:10px;font-weight:bold}table{width:100%;border-collapse:collapse}td{border:1px solid #333;padding:7px}td:first-child{font-weight:bold;background:#f2f2f2;width:34%}.barcode{text-align:center;margin-top:12px;font-family:monospace;font-size:16px}@media print{button{display:none}}</style></head><body><h1>كارت السداء</h1><div class="meta"><span>${esc(input.cardNo)}</span><span>${esc(d.issuedAt)}</span></div><table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</table><div class="barcode">${esc(input.barcode)}</div><script>window.addEventListener('load',()=>window.print())</script></body></html>`;
}
