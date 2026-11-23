import {apiFetch} from './client';
import type {SheetGrid} from '../../components/manufacturing/WorkbookSheetGrid';

export type SpecIllustration={name:string;mimeType:'image/png'|'image/jpeg';base64:string};
export interface SpecCardSummary{
  id:string;material_name:string;material_code:string;fabric_item_id:string|null;
  fabric_item_name:string|null;fabric_item_code:string|null;source_file_name:string|null;
  updated_at:string;created_at:string;sheet_count:number;
}
export interface SpecCard extends Omit<SpecCardSummary,'sheet_count'>{
  notes:string|null;sheets:SheetGrid[];illustrations:SpecIllustration[];
}
export interface SpecCardInput{
  materialName:string;materialCode:string;fabricItemId?:string|null;notes?:string|null;
  sheets?:SheetGrid[];illustrations?:SpecIllustration[];sourceFileName?:string|null;
}
const base='/api/manufacturing/spec-cards';

export async function listSpecCards(p:{search?:string;sort?:string;dir?:'asc'|'desc'}={}){
  const q=new URLSearchParams();
  if(p.search)q.set('search',p.search);if(p.sort)q.set('sort',p.sort);if(p.dir)q.set('dir',p.dir);
  return (await apiFetch<{ok:boolean;data:SpecCardSummary[]}>(`${base}${q.toString()?`?${q}`:''}`)).data;
}
export async function getSpecCard(id:string){return (await apiFetch<{ok:boolean;data:SpecCard}>(`${base}/${id}`)).data;}
export async function parseSpecWorkbook(contentBase64:string){
  return (await apiFetch<{ok:boolean;data:{sheets:SheetGrid[];illustrations:SpecIllustration[]}}>(`${base}/parse-workbook`,{method:'POST',body:JSON.stringify({contentBase64})})).data;
}
export async function createSpecCard(input:SpecCardInput){return (await apiFetch<{ok:boolean;data:SpecCard}>(base,{method:'POST',body:JSON.stringify(input)})).data;}
export async function updateSpecCard(id:string,input:Partial<SpecCardInput>){return (await apiFetch<{ok:boolean;data:SpecCard}>(`${base}/${id}`,{method:'PUT',body:JSON.stringify(input)})).data;}
export async function archiveSpecCard(id:string){return apiFetch<{ok:boolean}>(`${base}/${id}`,{method:'DELETE'});}
