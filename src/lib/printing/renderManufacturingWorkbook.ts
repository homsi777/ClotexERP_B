import type {SheetGrid} from '../../components/manufacturing/WorkbookSheetGrid';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const safeColor=(v:unknown)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:'';

export function renderManufacturingSheets(sheets:SheetGrid[]=[]):string{
  return sheets.map(sheet=>{
    const cells=sheet.cells.filter(c=>Number.isInteger(c.row)&&Number.isInteger(c.col)&&c.row>=0&&c.col>=0&&c.row<2000&&c.col<256);
    const merges=sheet.merges.filter(m=>[m.startRow,m.endRow,m.startCol,m.endCol].every(Number.isInteger)&&m.startRow>=0&&m.startCol>=0&&m.endRow>=m.startRow&&m.endCol>=m.startCol&&m.endRow<2000&&m.endCol<256);
    const maxRow=cells.reduce((n,c)=>Math.max(n,c.row),merges.reduce((n,m)=>Math.max(n,m.endRow),0));
    const maxCol=cells.reduce((n,c)=>Math.max(n,c.col),merges.reduce((n,m)=>Math.max(n,m.endCol),0));
    if((maxRow+1)*(maxCol+1)>50000||cells.length!==sheet.cells.length||merges.length!==sheet.merges.length)
      return '<h2>'+esc(sheet.name)+'</h2><p>تعذر عرض هذه الورقة ضمن حدود الطباعة الآمنة.</p>';
    const byPosition=new Map(cells.map(c=>[c.row+':'+c.col,c])),covered=new Set<string>(),starts=new Map<string,typeof merges[number]>();
    let expanded=0;
    for(const m of merges){
      expanded+=(m.endRow-m.startRow+1)*(m.endCol-m.startCol+1);
      if(expanded>100000)break;
      let overlap=false;
      for(let r=m.startRow;r<=m.endRow;r++)for(let c=m.startCol;c<=m.endCol;c++)if(covered.has(r+':'+c))overlap=true;
      if(overlap)continue;
      starts.set(m.startRow+':'+m.startCol,m);
      for(let r=m.startRow;r<=m.endRow;r++)for(let c=m.startCol;c<=m.endCol;c++)covered.add(r+':'+c);
    }
    let rows='';
    for(let r=0;r<=maxRow;r++){
      rows+='<tr>';
      for(let c=0;c<=maxCol;c++){
        const key=r+':'+c,m=starts.get(key),cell=byPosition.get(key);
        if(covered.has(key)&&!m)continue;
        rows+='<td'+(m?' rowspan="'+(m.endRow-m.startRow+1)+'" colspan="'+(m.endCol-m.startCol+1)+'"':'')+' style="background-color:'+safeColor(cell?.fill)+';color:'+safeColor(cell?.fontColor)+'">'+esc(cell?.value)+'</td>';
      }
      rows+='</tr>';
    }
    return '<section class="sheet"><h2>'+esc(sheet.name)+'</h2><table dir="ltr" class="sheet-grid"><tbody>'+rows+'</tbody></table></section>';
  }).join('');
}
export function renderManufacturingIllustrations(items:Array<{name:string;mimeType:string;base64:string}>=[]):string{
  let total=0;
  return items.map(i=>{
    total+=i.base64.length;
    const safe=total<=12*1024*1024&&['image/png','image/jpeg'].includes(i.mimeType)&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(i.base64)&&
      (i.mimeType==='image/png'?i.base64.startsWith('iVBORw0KGgo'):i.base64.startsWith('/9j/'));
    return safe?'<figure><img style="max-width:100%;max-height:240mm" alt="'+esc(i.name)+'" src="data:'+i.mimeType+';base64,'+i.base64+'"><figcaption>'+esc(i.name)+'</figcaption></figure>':'<p>صورة غير مدعومة: '+esc(i.name)+'</p>';
  }).join('');
}
