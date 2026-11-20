import type {SheetGrid} from '../../components/manufacturing/WorkbookSheetGrid';
import {renderManufacturingSheets,renderManufacturingIllustrations} from './renderManufacturingWorkbook';

export interface ManufacturingPrintData {
  [key:string]:unknown;
  parsed_data?:{technicalFields?:Record<string,unknown>;warp?:YarnSection|null;weft?:YarnSection|null;manualRevision?:unknown;sheets?:SheetGrid[];illustrations?:Array<{name:string;mimeType:string;base64:string}>};
  draft?:{sheetName?:string|null;cells:Array<{address:string;value:unknown;formula?:string|null}>;limitation?:string};
  allocations?:Array<Record<string,unknown>>;
  validation_warnings?:unknown[];
}
interface YarnSection {yarnCount?:unknown;pattern?:Array<Record<string,unknown>>;requirements?:Array<Record<string,unknown>>}
export const escapeManufacturingPrint=(v:unknown):string=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const esc=escapeManufacturingPrint;
const display=(v:unknown)=>v!==null&&typeof v==='object'?JSON.stringify(v):v;
function table(headers:string[],rows:unknown[][]){return '<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(display(v))+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+headers.length+'">لا توجد بيانات مسجلة</td></tr>')+'</tbody></table>';}
function document(title:string,body:string,label=false){return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>@page{size:'+(label?'100mm 150mm':'A4')+';margin:'+(label?'5mm':'12mm')+'}*{box-sizing:border-box}body{font:13px Tahoma,Arial;color:#111;margin:0;overflow-wrap:anywhere}h1{font-size:20px}h2{font-size:16px;margin-top:20px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #888;padding:6px;text-align:right;white-space:pre-wrap}thead{display:table-header-group}tr{break-inside:avoid}p{white-space:pre-wrap}.barcode{direction:ltr;text-align:center;font:18px monospace;border:2px solid;padding:10px}small{display:block;margin-top:12px}</style></head><body>'+body+'</body></html>';}
export function renderManufacturingBeamLabel(d:ManufacturingPrintData,encodeBarcode?:(value:string,height:number)=>string){
  const sized=d.kind==='SIZED';
  // Existing encoder supports 48 ASCII characters; never silently encode a truncated identity.
  const barcode=typeof d.barcode==='string'&&/^[\x20-\x7e]{1,48}$/.test(d.barcode)?encodeBarcode?.(d.barcode,48)??'':'';
  return document('ملصق المطواة '+String(d.beam_no??''),'<style>body{font-size:10px}h1{font-size:15px}th,td{padding:3px}table{margin:6px 0}.barcode{padding:3mm;font-size:12px}.barcode svg{width:100%;max-width:78mm;height:14mm;display:block;margin:0 auto}small{font-size:8px;margin-top:5px}</style><h1>CLOTEX — '+(sized?'مطواة مجهزة':'مطواة سداء')+'</h1><div class="barcode">'+barcode+'<div>'+esc(d.barcode)+'</div></div>'+table(['البيان','القيمة'],[
    ['رقم المطواة',d.beam_no],['أمر الإنتاج',d.work_order_no],['أمر التسدية',d.warping_order_no],
    ...(sized?[['أمر التجهيز',d.sizing_order_no],['مطواة المصدر',d.input_beam_no],['الوزن (كغ)',d.weight_kg]]:[]),
    ['المواصفة',d.specification_code],['اسم الصنف',d.specification_name],['إصدار المواصفة',d.specification_version_no],['الطول (م)',d.length_m],['الحالة',d.status],['الجودة',d.quality_status]])+'<p>'+esc(d.notes)+'</p><small>وقت طلب البيانات: '+esc(d.generatedAt)+'</small>',true);
}
function yarn(title:string,s:YarnSection|null|undefined){return '<h2>'+title+'</h2><p>نمرة الخيط: '+esc(s?.yarnCount)+'</p>'+table(['التسلسل','خلية المصدر','اللون','عدد الخيوط / الحدفات','التكرار'],(s?.pattern??[]).map(r=>[r.sequenceNo,r.sourceCell,r.colorName,r.threadOrPickCount,r.repeatCount]))+'<p>الاحتياجات المرجعية من Excel — ليست إذن صرف ولا معادلات معتمدة تلقائياً</p>'+table(['اللون','عدد النمط','كغ / ألف متر','الوزن المرجعي (كغ)'],(s?.requirements??[]).map(r=>[r.colorName,r.patternCount,r.weightPerThousandMeters,r.requiredWeightKg]));}
export function renderManufacturingWorkOrder(d:ManufacturingPrintData){
  return document('أمر الإنتاج '+String(d.work_order_no??''),'<h1>CLOTEX — أمر الإنتاج '+esc(d.work_order_no)+'</h1>'+table(['البيان','القيمة'],[
    ['الحالة',d.status],['الأولوية',d.priority],['الطول المستهدف (م)',d.target_length_m],['بداية مخططة',d.planned_start_date],['نهاية مخططة',d.planned_end_date],['المواصفة',d.specification_code],['اسم المواصفة',d.specification_name],['إصدار المواصفة',d.version_no],['حالة إصدار المواصفة',d.specification_status],['نسخة أمر الإنتاج',d.version]])+
    '<p>'+esc(d.notes)+'</p><h2>البيانات الفنية</h2>'+table(['البيان','القيمة'],Object.entries(d.parsed_data?.technicalFields??{}))+yarn('أمر السداء',d.parsed_data?.warp)+yarn('أمر اللحمة',d.parsed_data?.weft)+
    (d.parsed_data?.sheets?.length?'<h2>أوراق المواصفة والتركيب واللقي</h2><p>قيم وألوان ودمج خلايا محفوظة؛ المعادلات لا يعاد حسابها، ورسومات Excel المتجهة ليست مستنسخة.</p>'+renderManufacturingSheets(d.parsed_data.sheets):'<h2>التركيب واللقي — بيانات منظمة</h2><p>'+esc(d.draft?.limitation)+'</p>'+table(['الخلية','القيمة المحفوظة','المعادلة الأصلية'],(d.draft?.cells??[]).map(c=>[c.address,c.value,c.formula])))+
    renderManufacturingIllustrations(d.parsed_data?.illustrations)+
    '<h2>تخصيصات العملاء</h2>'+table(['الأوردر','السطر','الصنف','اللون','الديسان','الأمتار','ملاحظات'],(d.allocations??[]).map(r=>[r.order_no,r.line_no,r.material_name,r.color_name,r.dsam_number,r.allocated_length_m,r.notes]))+
    '<h2>تحذيرات المواصفة</h2>'+table(['التحذير'],(d.validation_warnings??[]).map(w=>[display(w)]))+
    (d.parsed_data?.manualRevision?'<p>إصدار معدل يدوياً؛ التركيب واللقي من ملف المصدر المحفوظ، والاحتياجات مرجعية فقط.</p>':'')+
    '<small>المصدر: '+esc(d.source_file_name)+'<br>SHA-256: '+esc(d.source_file_sha256)+'<br>وقت طلب البيانات: '+esc(d.generatedAt)+'</small>');
}
