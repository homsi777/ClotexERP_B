export const yarnOpeningColumns=['itemCode','warehouseCode','lotNo','weightKg','ownerType','ownerCustomerCode','supplierCode','barcode','unitCost','currencyCode','locationCode','colorCode'] as const;
export const yarnOpeningRequired=['itemCode','warehouseCode','weightKg','ownerType'];
export function mappedYarnCsv(rows:string[][],headerRow:number,mapping:Record<string,string>):string {
 if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=rows.length)throw new Error('اختر صف العناوين');
 const columns=yarnOpeningColumns.filter(k=>mapping[k]!==undefined&&mapping[k]!=='');
 if(yarnOpeningRequired.some(k=>!columns.includes(k as typeof columns[number])))throw new Error('اربط الصنف والمستودع والوزن والملكية');
 const indexes=columns.map(k=>Number(mapping[k]));
 if(indexes.some(n=>!Number.isInteger(n)||n<0||n>=rows[headerRow].length)||new Set(indexes).size!==indexes.length)throw new Error('ربط الأعمدة مكرر أو غير صالح');
 const data=rows.slice(headerRow+1).filter(r=>r.some(v=>String(v).trim()));
 if(!data.length||data.length>500)throw new Error('الحد من 1 إلى 500 سطر؛ لن يتم اقتطاع الملف');
 const quote=(s:string)=>'"'+s.replace(/"/g,'""')+'"';
 return [columns,...data.map(r=>indexes.map(i=>String(r[i]??'')))].map(r=>r.map(quote).join(',')).join('\r\n');
}
