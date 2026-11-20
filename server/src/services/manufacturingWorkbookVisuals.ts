import * as XLSX from 'xlsx';
import {z} from 'zod';
const hex=z.string().regex(/^#[0-9a-f]{6}$/i).optional();
const sheetCellSchema=z.object({address:z.string().regex(/^[A-Z]+[1-9]\d*$/),row:z.number().int().min(0).max(1999),col:z.number().int().min(0).max(255),value:z.union([z.string().max(1000),z.number().finite(),z.boolean(),z.null()]),formula:z.string().max(4000).optional(),fill:hex,fontColor:hex}).strict().refine(c=>XLSX.utils.encode_cell({r:c.row,c:c.col})===c.address);
export const workbookSheetsSchema=z.array(z.object({name:z.string().min(1).max(100),range:z.string().regex(/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/),cells:z.array(sheetCellSchema).max(200000),merges:z.array(z.object({startRow:z.number().int().min(0).max(1999),startCol:z.number().int().min(0).max(255),endRow:z.number().int().min(0).max(1999),endCol:z.number().int().min(0).max(255)}).strict().refine(m=>m.endRow>=m.startRow&&m.endCol>=m.startCol)).max(2000)}).strict().refine(s=>new Set(s.cells.map(c=>c.address)).size===s.cells.length&&s.cells.every(c=>(c.row+1)*(c.col+1)<=200000))).max(30).refine(sheets=>new Set(sheets.map(s=>s.name)).size===sheets.length);
export type WorkbookCell={address:string;row:number;col:number;value:string|number|boolean|null;formula?:string;fill?:string;fontColor?:string};
export type WorkbookSheetGrid={name:string;range:string;cells:WorkbookCell[];merges:Array<{startRow:number;startCol:number;endRow:number;endCol:number}>};
const color=(value:unknown):string|undefined=>typeof value==='string'&&/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)?`#${value.slice(-6)}`:undefined;
export function extractWorkbookSheets(workbook:XLSX.WorkBook):WorkbookSheetGrid[]{
  return workbook.SheetNames.map(name=>{
    const sheet=workbook.Sheets[name],range=sheet['!ref']??'A1';
    const bounds=XLSX.utils.decode_range(range);
    if(bounds.e.r>1999||bounds.e.c>255||(bounds.e.r+1)*(bounds.e.c+1)>200000)throw new Error('ورقة المواصفة تتجاوز حد المعاينة المنظمة: 200000 خلية');
    const cells:WorkbookCell[]=[];
    for(const [address,raw] of Object.entries(sheet)){
      if(!/^[A-Z]+[1-9]\d*$/.test(address))continue;
      const cell=raw as XLSX.CellObject,position=XLSX.utils.decode_cell(address),style=cell.s as {fgColor?:{rgb?:string};fill?:{fgColor?:{rgb?:string}};font?:{color?:{rgb?:string}}}|undefined;
      const fill=color(style?.fgColor?.rgb??style?.fill?.fgColor?.rgb),fontColor=color(style?.font?.color?.rgb);
      if(cell.v==null&&!fill&&!cell.f)continue;
      const value=typeof cell.v==='number'||typeof cell.v==='boolean'||typeof cell.v==='string'?cell.v:cell.v==null?null:String(cell.v);
      cells.push({address,row:position.r,col:position.c,value, ...(cell.f?{formula:cell.f}:{}),...(fill?{fill}:{}),...(fontColor?{fontColor}:{})});
    }
    return {name,range,cells,merges:(sheet['!merges']??[]).map(m=>({startRow:m.s.r,startCol:m.s.c,endRow:m.e.r,endCol:m.e.c}))};
  });
}
export function extractWorkbookIllustrations(workbook:XLSX.WorkBook):Array<{name:string;mimeType:string;base64:string}>{
  const files=(workbook as XLSX.WorkBook&{files?:Record<string,{content?:Uint8Array}>}).files??{};
  let total=0;
  return Object.entries(files).filter(([name])=>/^xl\/media\//.test(name)).flatMap(([name,file])=>{
    if(!file.content)return [];const data=Buffer.from(file.content);
    const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=data[0]===255&&data[1]===216&&data[2]===255;
    if(!png&&!jpeg)return [];total+=data.length;if(total>8*1024*1024)throw new Error('صور المواصفة تتجاوز الحجم المسموح');
    return [{name,mimeType:png?'image/png':'image/jpeg',base64:data.toString('base64')}];
  });
}
