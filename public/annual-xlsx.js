import {annualDues,annualStatus,MONTHS} from './annual-dues.js?v=annual-1';
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const col=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
const money=n=>new Intl.NumberFormat('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100)+' TL';
// ZIP STORE keeps this small export self-contained: no CDN, executable formulas or dependencies.
function zip(files){
 const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
 const crc=data=>{let n=0xffffffff;for(const b of data){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 for(const [path,source] of Object.entries(files)){
  const name=encoder.encode(path),data=encoder.encode(source),checksum=crc(data),head=new Uint8Array(30+name.length),v=new DataView(head.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,checksum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);head.set(name,30);
  const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);cv.setUint32(16,checksum,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);
  parts.push(head,data);central.push(c);offset+=head.length+data.length;
 }
 const size=central.reduce((s,c)=>s+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
 const result=new Uint8Array(offset+size+22);let pos=0;for(const p of [...parts,...central,end]){result.set(p,pos);pos+=p.length;}return result;
}
const styles=declaration+`<styleSheet xmlns="${main}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;TL&quot;"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF154D43"/><sz val="16"/><name val="Calibri"/></font><font><color rgb="FF63756F"/><sz val="10"/><name val="Calibri"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['154D43','E7F3EA','FFF0CE','FCE5E0','EDE6F5','F1F3F2'].map(c=>'<fill><patternFill patternType="solid"><fgColor rgb="FF'+c+'"/><bgColor indexed="64"/></patternFill></fill>').join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDDE5E0"/></left><right style="thin"><color rgb="FFDDE5E0"/></right><top style="thin"><color rgb="FFDDE5E0"/></top><bottom style="thin"><color rgb="FFDDE5E0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13">`+
 [[0,0,0,0,'left'],[0,2,0,0,'left'],[0,1,2,1,'center'],...[3,4,5,6,7].map(f=>[0,f===7?3:0,f,1,'center']),[164,0,0,1,'right'],[164,1,2,1,'right'],[0,1,2,1,'left'],[0,0,0,1,'left'],[0,3,0,0,'left']].map(([n,font,fill,border,align])=>`<xf numFmtId="${n}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`).join('')+'<\/cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const text=(value,style=11)=>({value,style}),number=(value,style=8)=>({value:value/100,style});
function sheet({rows,widths,filterEnd}){
 const last=col(widths.length-1),cells=rows.map((row,i)=>`<row r="${i+1}" ht="${i===0?28:i===1?34:i===2?34:42}" customHeight="1">`+row.map((cell,j)=>typeof cell.value==='number'?`<c r="${col(j)}${i+1}" s="${cell.style}"><v>${cell.value}</v></c>`:`<c r="${col(j)}${i+1}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`).join('')+'</row>').join('');
 return declaration+`<worksheet xmlns="${main}"><dimension ref="A1:${last}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="3" topLeftCell="B4" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>`+widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')+`</cols><sheetData>${cells}</sheetData><autoFilter ref="A3:${last}${filterEnd}"/><mergeCells count="2"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
export function annualWorkbook(state,year,currentMonth){
 const report=annualDues(state,year,currentMonth),statusStyles={paid:3,partial:4,unpaid:5,exempt:6,missing:7,future:7};
 const title=state.settings.name+' · '+year+' aidat çizelgesi',note='Aidat ayına göre güncel durum. Muaf: güncel karar; geçmişte kayıt olmayan aylar muaf sayılmaz.';
 const rows=[[text(title,1)],[text(note,12)],['Bölüm',...MONTHS,'Borçlandırma (TL)','Ödenen (TL)','Kalan (TL)'].map(v=>text(v,2)),...report.rows.map(r=>[text(r.label),...r.cells.map(c=>text(annualStatus(c.status)+(c.chargeId?'\n'+money(c.remaining>0?c.remaining:c.amount)+(c.remaining>0?' kalan':''):''),statusStyles[c.status])),number(r.amount),number(r.paid),number(r.remaining)]),[text('TOPLAM',10),...report.months.map(c=>number(c.remaining,9)),number(report.amount,9),number(report.paid,9),number(report.remaining,9)]];
 rows.push([text('TOPLAM satırında aylar için kalan borç gösterilir.',12)]);
 const detailRows=[[text(state.settings.name+' · '+year+' aidat ayrıntıları',1)],[text('Ödenen tutar, seçilen aidat ayına işlenmiş ödemelerdir; tahsilat yılı farklı olabilir.',12)],['Bölüm','Aidat ayı','Durum','Tür','Borçlandırma (TL)','Ödenen (TL)','Kalan (TL)'].map(v=>text(v,2))];
 for(const r of report.rows)for(const c of r.cells)if(c.chargeId)detailRows.push([text(r.label),text(c.period),text(annualStatus(c.status),statusStyles[c.status]),text(c.kind==='opening'?'Devir borcu':'Aidat'),number(c.amount),number(c.paid),number(c.remaining)]);
 const filterEnd=detailRows.length;detailRows.push([text('TOPLAM',10),text('',10),text('',10),text('',10),number(report.amount,9),number(report.paid,9),number(report.remaining,9)]);
 const files={
  '[Content_Types].xml':declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+[1,2].map(i=>`<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>',
  '_rels/.rels':declaration+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml':declaration+`<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Aidat çizelgesi" sheetId="1" r:id="rId1"/><sheet name="Aidat ayrıntıları" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+[1,2].map(i=>`<Relationship Id="rId${i}" Type="${rel}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')+`<Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml':styles,
  'xl/worksheets/sheet1.xml':sheet({rows,widths:[23,...MONTHS.map(()=>19),21,20,20],filterEnd:3+report.rows.length}),
  'xl/worksheets/sheet2.xml':sheet({rows:detailRows,widths:[23,16,18,18,24,21,21],filterEnd})
 };
 return zip(files);
}
export function downloadAnnualWorkbook(state,year,currentMonth){
 const bytes=annualWorkbook(state,year,currentMonth),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download='aidat-cizelgesi-'+year+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
