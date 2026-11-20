export type Stage='WARPING'|'SIZING'|'WEAVING';
export type ReportValue=string|number|boolean|null|undefined;
export type ReportRow=Record<string,unknown>;
export interface AllStageOperationsReport {
  rows:ReportRow[];activities:ReportRow[];yarn:ReportRow[];stageSummary:ReportRow[];yarnSummary:ReportRow[];
  counts:{rows:number;activities:number;yarn:number};runtimeRecorded:boolean;generatedAt:string;
}
export const stageLabels:Record<string,string>={ALL:'كل المراحل',WARPING:'التسدية',SIZING:'التجهيز',WEAVING:'النسيج'};
export const operationColumns=[['stage','المرحلة'],['operation_no','أمر المرحلة'],['work_order_no','أمر الإنتاج'],['customer_orders','أوردرات العملاء'],['specification_code','المواصفة'],['machine_code','الماكينة'],['status','الحالة'],['planned_m','المخطط م'],['actual_m','المخرج الفعلي التراكمي م'],['remaining_m','المتبقي للمخرج م'],['overproduction_m','زيادة المخرج م'],['recorded_m','الإنتاج المسجل بالفترة م'],['worker_minutes','دقائق العمال بالفترة'],['downtime_minutes','التوقف بالفترة دقائق'],['started_at','بدء مسجل'],['completed_at','انتهاء مسجل']] as const;
export const activityColumns=[['stage','المرحلة'],['operation_no','أمر المرحلة'],['work_order_no','أمر الإنتاج'],['production_date','تاريخ الإنتاج'],['recorded_at','وقت إدخال السجل'],['machine_code','الماكينة'],['shift_name','الوردية'],['operator_name','المشغل'],['workers','العمال ودقائقهم'],['produced_m','الإنتاج م'],['worker_minutes','دقائق العمال'],['downtime_minutes','دقائق التوقف'],['downtimes','تفاصيل التوقف']] as const;
export const yarnColumns=[['stage','المرحلة'],['operation_no','أمر المرحلة'],['work_order_no','أمر الإنتاج'],['source_no','سند المصدر'],['lot_no','اللوط'],['lot_barcode','باركود اللوط'],['item_name','الخيط / المادة'],['color_name','اللون'],['issued_kg','المصروف كغ'],['returned_kg','المرتجع كغ'],['net_issued_kg','صافي الصرف كغ'],['consumed_kg','الاستهلاك المسجل كغ'],['waste_kg','الهالك كغ'],['difference_kg','فرق معتمد كغ'],['custody_kg','عهدة معلومة كغ'],['consumption_basis','أساس الاستهلاك'],['issued_at','وقت الصرف'],['settled_at','وقت إغلاق التسوية']] as const;
export const stageSummaryColumns=[['stage','المرحلة'],['count','عدد الأوامر'],['planned_m','المخطط م'],['actual_m','المخرج الفعلي التراكمي م'],['remaining_m','المتبقي للمخرج م'],['overproduction_m','زيادة المخرج م'],['recorded_m','الإنتاج المسجل بالفترة م'],['worker_minutes','دقائق العمال بالفترة'],['downtime_minutes','التوقف بالفترة دقائق']] as const;
export const yarnSummaryColumns=[['stage','المرحلة'],['count','عدد سطور الصرف'],['issued_kg','المصروف كغ'],['returned_kg','المرتجع كغ'],['net_issued_kg','صافي الصرف كغ'],['consumed_kg','الاستهلاك المعلوم كغ'],['waste_kg','الهالك كغ'],['difference_kg','فرق معتمد كغ'],['custody_kg','العهدة المعلومة كغ'],['unrecorded_count','سطور استهلاك غير مسجل']] as const;
export type Columns=readonly(readonly[string,string])[];
export const reportNotes='المخطط والمخرج والمتبقي وأرصدة المواد تراكمية للأوامر المختارة حتى وقت الطلب. التاريخ يحدد أنشطة الإنتاج والأوامر المنشأة خلال الفترة؛ فلاتر العامل والماكينة والوردية تختار الأوامر والأنشطة المطابقة ولا توزع الإنتاج على العمال. مخرج التسدية والتجهيز من المطاوي الفعلية، ومخرج النسيج من إجمالي التشغيلة؛ المتبقي ليس وعداً بإنتاج صالح. لا تجمع أمتار المراحل المختلفة. إنتاج اليوميات يعرض منفصلاً ولا يضاف للمخرج مرة أخرى. الصافي ليس استهلاكاً؛ المجهول يبقى غير مسجل. دقائق العمال وقت بشري وليست ساعات ماكينة، ولا يستنتج وقت تشغيل من الحضور أو فرق تاريخي البدء والانتهاء.';
export const escReport=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reportDisplay(key:string,value:unknown):string{
  if(value==null)return '—';
  if(key==='stage')return stageLabels[String(value)]??String(value);
  if(key==='workers'&&Array.isArray(value))return value.map(w=>`${w.name}: ${w.minutes} دقيقة`).join(' / ');
  if(key==='downtimes'&&Array.isArray(value))return value.map(d=>`${d.reason}: ${d.minutes} دقيقة${d.notes?' — '+d.notes:''}`).join(' / ');
  return typeof value==='object'?JSON.stringify(value):String(value);
}
export function csvReportCell(value:unknown):string{
  let text=String(value??'');
  // Include leading whitespace/control chars: Excel may strip them before interpreting formulas.
  if(/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function reportIsTruncated(r:AllStageOperationsReport){return Object.entries(r.counts).some(([k,n])=>n>r[k as 'rows'|'activities'|'yarn'].length);}
function sections(r:AllStageOperationsReport):Array<{title:string;columns:Columns;rows:ReportRow[]}>{return [
  {title:'ملخص الأوامر حسب المرحلة',columns:stageSummaryColumns,rows:r.stageSummary},
  {title:'ملخص المواد حسب المرحلة',columns:yarnSummaryColumns,rows:r.yarnSummary},
  {title:'تفاصيل الأوامر',columns:operationColumns,rows:r.rows},
  {title:'أنشطة الإنتاج المسجلة',columns:activityColumns,rows:r.activities},
  {title:'أرصدة سطور الصرف واللوطات',columns:yarnColumns,rows:r.yarn},
];}
export function renderAllStageReport(r:AllStageOperationsReport,filterDescription:string){
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير مراحل التصنيع</title><style>@page{size:A4 landscape;margin:8mm}body{font:10px Tahoma,Arial}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #aaa;padding:3px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>تقرير مراحل التصنيع</h1><p>'+escReport(filterDescription)+'</p><p>'+escReport(reportNotes)+'</p><p>وقت الطلب: '+escReport(r.generatedAt)+'</p>'+(reportIsTruncated(r)?'<p>تنبيه: التفاصيل محددة بأول 500 سجل لكل قسم؛ الملخص يشمل كل النتائج. ضيق الفلاتر لطباعة التفاصيل كاملة.</p>':'')+sections(r).map(s=>'<h2>'+s.title+'</h2><table><thead><tr>'+s.columns.map(([,l])=>'<th>'+escReport(l)+'</th>').join('')+'</tr></thead><tbody>'+s.rows.map(row=>'<tr>'+s.columns.map(([k])=>'<td>'+escReport(reportDisplay(k,row[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table>').join('')+'</body></html>';
}
/** Sections have separate headers; no synthetic all-stage metre total or repeated issue lines. */
export function exportAllStageReportCsv(r:AllStageOperationsReport,filterDescription:string){
  const rows:unknown[][]=[['تقرير مراحل التصنيع',filterDescription],['وقت الطلب',r.generatedAt],['نطاق الأرقام',reportNotes]];
  if(reportIsTruncated(r))rows.push(['تنبيه','التفاصيل محددة بأول 500 سجل لكل قسم؛ الملخص يشمل كل النتائج']);
  for(const s of sections(r)){rows.push([], [s.title],s.columns.map(([,l])=>l));for(const row of s.rows)rows.push(s.columns.map(([k])=>row[k]==null?'':reportDisplay(k,row[k])));}
  return '\uFEFF'+rows.map(row=>row.map(csvReportCell).join(',')).join('\r\n');
}
