import test from 'node:test';
import assert from 'node:assert/strict';
import {annualDues} from '../public/annual-dues.js';
import {annualWorkbook} from '../public/annual-xlsx.js';
const data=()=>({settings:{name:'Test Apartmanı'},units:[{id:1,label:'Daire 1',exempt:true},{id:2,label:'Dükkân',exempt:false}],charges:[{id:1,unit_id:1,period:'2026-01',amount:35000,paid:10050,kind:'opening',note:'PRIVATE'},{id:2,unit_id:1,period:'2026-02',amount:35000,paid:35000},{id:3,unit_id:2,period:'2026-01',amount:35000,paid:0},{id:4,unit_id:2,period:'2025-12',amount:5000,paid:1000}]});
test('Annual dues retain partial payments and exempt units historical debt with exact kuruş totals, excluding other years',()=>{
 const state=data(),before=JSON.stringify(state),r=annualDues(state,2026,'2026-10');
 assert.equal(r.rows.length,2);assert.equal(r.rows[0].cells.length,12);
 assert.equal(r.rows[0].cells[0].status,'partial');assert.equal(r.rows[0].cells[0].kind,'opening');assert.equal(r.rows[0].cells[1].status,'paid');assert.equal(r.rows[1].cells[0].status,'unpaid');
 assert.equal(r.amount,105000);assert.equal(r.paid,45050);assert.equal(r.remaining,59950);assert.equal(r.months[0].remaining,59950);
 assert.equal(r.rows[0].remaining,24950);assert.equal(r.rows[1].remaining,35000);
 assert.equal(annualDues(state,2025,'2026-10').remaining,4000);assert.equal(JSON.stringify(state),before);
});
test('Missing dues are never marked unpaid and a current exemption is not backdated into missing historical periods',()=>{
 const r=annualDues(data(),2026,'2026-10');
 assert.equal(r.rows[0].cells[8].status,'missing');assert.equal(r.rows[0].cells[9].status,'exempt');assert.equal(r.rows[0].cells[10].status,'exempt');
 assert.equal(r.rows[1].cells[9].status,'missing');assert.equal(r.rows[1].cells[10].status,'future');
 assert.equal(annualDues(data(),2025,'2026-10').rows[0].cells[0].status,'missing');
 for(const year of [1999,2100,2026.5,NaN])assert.throws(()=>annualDues(data(),year,'2026-10'),/yıl/);
 assert.throws(()=>annualDues(data(),2026,'2026-13'),/yıl/);
 assert.equal(annualDues({...data(),units:[],charges:[]},2026,'2026-10').remaining,0);
});
function parts(bytes){
 const view=new DataView(bytes.buffer),decoder=new TextDecoder(),files={};let p=0;
 while(view.getUint32(p,true)===0x04034b50){const size=view.getUint32(p+18,true),n=view.getUint16(p+26,true),extra=view.getUint16(p+28,true),start=p+30+n+extra;
  files[decoder.decode(bytes.slice(p+30,p+30+n))]=decoder.decode(bytes.slice(start,start+size));p=start+size;
 }
 assert.equal(view.getUint32(p,true),0x02014b50);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);return files;
}
test('Excel export has both sheets, numeric money, safe literal text and no private notes or executable formulas',()=>{
 const state=data();state.units[0].label='=1+1 <script>';state.units[0].owner='SECRET_OWNER';state.settings.name='A&B';
 const files=parts(annualWorkbook(state,2026,'2026-10'));
 assert.equal(Object.keys(files).length,7);assert.match(files['xl/workbook.xml'],/Aidat çizelgesi/);assert.match(files['xl/workbook.xml'],/Aidat ayrıntıları/);
 const grid=files['xl/worksheets/sheet1.xml'],detail=files['xl/worksheets/sheet2.xml'];
 assert.match(grid,/A&amp;B/);assert.match(grid,/t="inlineStr"[^>]*><is><t[^>]*>=1\+1 &lt;script&gt;/);
 assert.match(grid,/<pane xSplit="1" ySplit="3"/);assert.match(grid,/<autoFilter ref="A3:P5"/);
 assert.match(grid,/<c r="P6" s="9"><v>599\.5<\/v>/);assert.match(detail,/Devir borcu/);
 assert.doesNotMatch(grid+detail,/<f>|PRIVATE|SECRET_OWNER/);
 assert.match(files['xl/styles.xml'],/numFmtId="164"/);
});
