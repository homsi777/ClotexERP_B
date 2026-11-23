import assert from 'node:assert/strict';
import {test} from 'node:test';
import {escapeManufacturingPrint,renderManufacturingBeamLabel,renderManufacturingWorkOrder} from './renderManufacturingPrint';
import {renderManufacturingSheets,renderManufacturingIllustrations} from './renderManufacturingWorkbook';

test('escapes every HTML delimiter and preserves zero',()=>{
  assert.equal(escapeManufacturingPrint(`<img src=x onerror="alert('x')">&`),'&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
  assert.equal(escapeManufacturingPrint(0),'0');
});
test('raw and sized labels distinguish actual beam identity and quality',()=>{
  for(const kind of ['WARP','SIZED']){
    const html=renderManufacturingBeamLabel({kind,beam_no:'B-2',barcode:'REAL-BARCODE-2',length_m:0,status:'REJECTED',quality_status:'REJECTED',input_beam_no:'B-1',notes:'<script>alert(1)</script>'});
    assert.ok(html.includes('B-2')&&html.includes('REAL-BARCODE-2')&&html.includes('REJECTED'));
    assert.ok(html.includes(kind==='SIZED'?'مطواة مجهزة':'مطواة سداء'));
    assert.equal(html.includes('مطواة المصدر'),kind==='SIZED');
    assert.ok(html.includes('100mm 150mm')&&html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>'));
  }
});
test('complete work order includes structured warp, weft, draft, allocations and provenance safely',()=>{
  const evil='</td><script>alert(1)</script>';
  const html=renderManufacturingWorkOrder({work_order_no:evil,source_file_name:evil,source_file_sha256:'HASH',notes:evil,
    parsed_data:{technicalFields:{[evil]:evil},warp:{yarnCount:30,pattern:[{sequenceNo:1,colorName:evil,threadOrPickCount:5,repeatCount:2}],requirements:[{colorName:'REF',requiredWeightKg:7}]},weft:{yarnCount:40,pattern:[{colorName:'WEFT',threadOrPickCount:3}]}},
    draft:{cells:[{address:'A1',value:evil,formula:'SUM(B1:B2)'}],limitation:'جدولي'},allocations:[{order_no:'CUSTOMER-1'}],validation_warnings:[{message:evil}]});
  for(const text of ['أمر السداء','أمر اللحمة','التركيب واللقي','WEFT','CUSTOMER-1','لا تُستخدم لحساب استهلاك','&lt;script&gt;'])assert.ok(html.includes(text),text);
  // M-0002: لا تفاصيل فحص Excel الداخلية بالطباعة (تحذيرات، أكواد، عناوين خلايا، معادلات، SHA، وقت الطلب)
  for(const text of ['تحذيرات المواصفة','SUM(B1:B2)','HASH','SHA-256','وقت طلب البيانات','المعادلة الأصلية','خلية المصدر'])assert.ok(!html.includes(text),text);
  assert.ok(!html.includes('<script>'));
  assert.ok(renderManufacturingWorkOrder({}).includes('لا توجد بيانات مسجلة'));
});
test('barcode encoding never truncates or sanitizes a different beam identity',()=>{
  const calls:string[]=[];
  const encoder=(value:string)=>{calls.push(value);return '<svg></svg>';};
  assert.ok(renderManufacturingBeamLabel({barcode:'WARP-42'},encoder).includes('<svg>'));
  for(const barcode of ['x'.repeat(49),'عربي',''])assert.ok(!renderManufacturingBeamLabel({barcode},encoder).includes('<svg>'));
  assert.deepEqual(calls,['WARP-42']);
});
test('workbook grids preserve zero, cell colors, merges, formula text and reject CSS injection',()=>{
  const sheet={name:'<script>sheet</script>',range:'A1:C2',cells:[
    {address:'A1',row:0,col:0,value:0,fill:'#abcdef',fontColor:'#123456',formula:'SUM(B1:C1)'},
    {address:'C2',row:1,col:2,value:'<img onerror=x>',fill:'red; background:url(https://evil)',fontColor:'" onload="x'}],
    merges:[{startRow:0,startCol:0,endRow:0,endCol:1}]};
  const html=renderManufacturingSheets([sheet]);
  for(const text of ['colspan="2"','#abcdef','#123456','>0</td>','&lt;img','&lt;script&gt;'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('SUM(B1:C1)')&&!html.includes('title="A1"')&&!html.includes('A1:C2'),'لا معادلات ولا عناوين خلايا');
  assert.ok(!html.includes('url(')&&!html.includes('onload=')&&!html.includes('<script>'));
  const order=renderManufacturingWorkOrder({parsed_data:{sheets:[sheet]},draft:{cells:[{address:'FALLBACK',value:'old'}]}});
  assert.ok(order.includes('المواصفة والتركيب واللقي')&&!order.includes('FALLBACK'));
  // الرجوع لورقة التركيب واللقي المحفوظة: جدول قيم بترتيبها دون عناوين خلايا ولا معادلات، والأرقام كما هي (0.59)
  const fb=renderManufacturingWorkOrder({draft:{cells:[{address:'B2',value:0.59,formula:'SUM(A1)'},{address:'A2',value:'التركيب'},{address:'D5',value:3}]}});
  assert.ok(fb.includes('>0.59</td>')&&fb.includes('>التركيب</td>')&&fb.includes('>3</td>'));
  assert.ok(!fb.includes('B2')&&!fb.includes('SUM(A1)')&&!fb.includes('الخلية'));
  assert.ok(renderManufacturingSheets([{...sheet,cells:[{address:'A2001',row:2000,col:0,value:1}]}]).includes('حدود الطباعة الآمنة'));
});
test('only bounded inline PNG/JPEG originals enter print HTML, with escaped image names',()=>{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=';
  const images=[{name:'" onerror="bad',mimeType:'image/png',base64:png},{name:'vector',mimeType:'image/svg+xml',base64:'PHN2Zz4='},{name:'url',mimeType:'image/png',base64:'https://example.com'},{name:'injection',mimeType:'image/png',base64:'iVBORw0KGgo" onload="bad'}];
  const html=renderManufacturingIllustrations(images);
  assert.equal((html.match(/<img /g)??[]).length,1);
  assert.ok(html.includes('data:image/png;base64,'+png)&&html.includes('&quot; onerror=&quot;bad'));
  assert.ok(!html.includes('src="https:')&&!html.includes('data:image/svg'));
  assert.ok(renderManufacturingWorkOrder({parsed_data:{illustrations:[images[0]]}}).includes('data:image/png'));
});
