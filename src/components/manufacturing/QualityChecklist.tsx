export type ChecklistRow = { key: 'VISUAL'|'DIMENSIONS'|'QUANTITY'|'TRACEABILITY'; result: 'PASS'|'FAIL'|'NA'; notes: string };
const labels = {VISUAL:'الفحص البصري',DIMENSIONS:'الأبعاد والمواصفات',QUANTITY:'مطابقة الكمية',TRACEABILITY:'المصدر ومراجع الأوامر'};
export function QualityChecklist({value,onChange,disabled=false}:{value:ChecklistRow[];onChange:(rows:ChecklistRow[])=>void;disabled?:boolean}) {
  return <fieldset disabled={disabled} className="space-y-2 rounded border p-3"><legend>قائمة الفحص</legend>
    {(Object.keys(labels) as ChecklistRow['key'][]).map(key=>{const row=value.find(r=>r.key===key);return <div key={key} className="grid gap-2 sm:grid-cols-3">
      <label>{labels[key]}<select aria-label={labels[key]} className="w-full rounded border p-2" value={row?.result??''} onChange={e=>onChange([...value.filter(r=>r.key!==key),...(e.target.value?[{key,result:e.target.value as ChecklistRow['result'],notes:row?.notes??''}]:[])])}>
        <option value="">لم يفحص</option><option value="PASS">مطابق</option><option value="FAIL">غير مطابق</option><option value="NA">لا ينطبق</option>
      </select></label><input aria-label={`ملاحظات ${labels[key]}`} disabled={!row} className="rounded border p-2 sm:col-span-2" value={row?.notes??''} onChange={e=>onChange(value.map(r=>r.key===key?{...r,notes:e.target.value}:r))}/>
    </div>})}
  </fieldset>;
}
