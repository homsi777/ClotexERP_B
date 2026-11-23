import type {SheetGrid} from '../../components/manufacturing/WorkbookSheetGrid';
import {renderManufacturingSheets,renderManufacturingIllustrations} from './renderManufacturingWorkbook';

/** بطاقة مواصفات مرجعية للطباعة/PDF: بيانات التعريف ثم الأوراق بترتيبها ودمج خلاياها وألوانها. الأرقام تُعرض كما هي ولا تُحسب. */
export interface SpecCardPrintData {
  material_name: string;
  material_code: string;
  fabric_item_name?: string|null;
  fabric_item_code?: string|null;
  notes?: string|null;
  sheets?: SheetGrid[];
  illustrations?: Array<{name:string;mimeType:string;base64:string}>;
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function renderSpecCardHtml(card:SpecCardPrintData):string{
  const linked=card.fabric_item_name?esc(card.fabric_item_name)+(card.fabric_item_code?' ('+esc(card.fabric_item_code)+')':''):'—';
  const css='@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:13px Tahoma,Arial;color:#111;margin:0;overflow-wrap:anywhere}h1{font-size:20px}h2{font-size:16px;margin-top:20px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #888;padding:6px;text-align:right;white-space:pre-wrap}.sheet-grid td{padding:3px 5px;font-size:11px;text-align:center}p{white-space:pre-wrap}section.sheet{break-inside:auto}';
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+esc('بطاقة مواصفات '+card.material_name)+'</title><style>'+css+'</style></head><body>'
    +'<h1>CLOTEX — بطاقة مواصفات</h1>'
    +'<table><tbody><tr><th>الخامة</th><td>'+esc(card.material_name)+'</td><th>كود الخامة</th><td dir="ltr">'+esc(card.material_code)+'</td></tr>'
    +'<tr><th>الخامة المرتبطة من الدليل</th><td colspan="3">'+linked+'</td></tr></tbody></table>'
    +(card.notes?.trim()?'<p>'+esc(card.notes)+'</p>':'')
    +renderManufacturingSheets(card.sheets??[])
    +renderManufacturingIllustrations(card.illustrations)
    +'</body></html>';
}
