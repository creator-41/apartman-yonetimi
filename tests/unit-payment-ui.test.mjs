import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { unitPaymentPlan } from '../public/unit-payments.js';
import { noticePayload, sendPaymentNotice, waitingNotices, noticeStatus } from '../public/payment-notices.js';

async function fixture(){
 const elements=new Map(),requests=[];
 const element=selector=>{
  if(!elements.has(selector))elements.set(selector,{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});
  return elements.get(selector);
 };
 const context=vm.createContext({Intl,Date,Set,Number,String,Math,Error,JSON,console,unitPaymentPlan,noticePayload,sendPaymentNotice,waitingNotices,noticeStatus,
  crypto:{randomUUID:()=> 'test-stable-request'},window:{},document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){}},
  config:{},createApi:()=>async(...args)=>{requests.push(args);return {ok:true,allocations:[],id:'test-notice',status:'pending'};},initPwa:()=>()=>{},setTimeout:()=>0,clearTimeout(){},setInterval(){}});
 let source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 source=source.replace(/^import .*;\n/gm,'').replace(/^refresh\(\)\.catch\(error\);$/m,'');
 vm.runInContext(source,context);
 vm.runInContext(`state={admin:true,units:[{id:1,label:'Daire 1'}],charges:[{id:2,unit_id:1,period:'2026-02',amount:10000,paid:0},{id:1,unit_id:1,period:'2026-01',amount:10000,paid:2500}],payments:[]};`,context);
 return {context,element,requests,run:code=>vm.runInContext(code,context)};
}
test('total payment dialog previews oldest debt, rejects excess and reuses one request identity',async()=>{
 const f=await fixture();f.run('openUnitPayment(1)');
 const html=f.element('#dialogFields').innerHTML;
 assert.ok(html.indexOf('Ocak')<html.indexOf('Şubat'));
 assert.match(html,/En eski borçtan/);
 f.element('#f-amount').value='200';f.run('updateUnitPaymentPreview()');assert.equal(f.element('#dialogSubmit').disabled,true);
 f.element('#f-amount').value='100';f.run('updateUnitPaymentPreview()');assert.equal(f.element('#dialogSubmit').disabled,false);
 assert.match(f.element('#unitPaymentPreview').innerHTML,/25,00/);
 f.context.form=new Map([['amount','100'],['date','2026-10-21'],['note','test']]);
 await f.run('dialogAction(form)');await f.run('dialogAction(form)');
 assert.equal(f.requests[0][0],'payments/unit');assert.equal(f.requests[0][2].requestId,f.requests[1][2].requestId);
 assert.deepEqual(Array.from(f.requests[0][2].expected,x=>x.id),[1,2]);
 f.element('#dialogSubmit').disabled=true;f.run("openDialog('Başka işlem','',()=>{})");assert.equal(f.element('#dialogSubmit').disabled,false);
});
test('group result offers monthly receipts and hides group undo after a cancellation',async()=>{
 const f=await fixture();f.run(`state.payments=[{id:10,charge_id:1,amount:7500,date:'2026-10-21'},{id:11,charge_id:2,amount:2500,date:'2026-10-21'}];`);
 const group={batchId:'test-group',unitId:1,amount:10000,date:'2026-10-21',allocations:[{paymentId:10,chargeId:1,period:'2026-01',amount:7500},{paymentId:11,chargeId:2,period:'2026-02',amount:2500}]};
 f.context.group=group;f.run('showPaymentGroup(group)');let html=f.element('#dialogFields').innerHTML;
 assert.equal((html.match(/data-action="receipt"/g)||[]).length,2);assert.match(html,/Tüm ödemeyi geri al/);
 f.run('state.payments.pop();showPaymentGroup(group)');html=f.element('#dialogFields').innerHTML;
 assert.match(html,/İptal edilmiş/);assert.doesNotMatch(html,/data-action="undo-payment-batch"/);
 f.run('state.admin=false');assert.throws(()=>f.run('openUnitPayment(1)'),/Yönetici girişi/);
});

test('resident notice form sends a claim only, preserves retry identity and freezes uncertain submissions',async()=>{
 const f=await fixture();f.run('state.admin=false;openPaymentNotice(1)');
 assert.match(f.element('#dialogFields').innerHTML,/Ödediğiniz tutar/);
 assert.match(f.element('#dialogFields').innerHTML,/yalnızca yönetime/);
 f.context.form=new Map([['unitId','1'],['amount','10'],['date','2026-01-01'],['note','<test>']]);
 await f.run('dialogAction(form)');await f.run('dialogAction(form)');
 assert.equal(f.requests.length,2);assert.equal(f.requests[0][0],'payment-notices/submit');
 assert.equal(f.requests[0][2].requestId,f.requests[1][2].requestId);
 f.context.form.set('amount','20');await assert.rejects(()=>f.run('dialogAction(form)'),/Bilgileri değiştirmeden/);
 assert.equal(f.requests.length,2);
});
test('admin notice review previews allocation, requires bank confirmation and escapes private text',async()=>{
 const f=await fixture();f.run(`paymentNotices=[{id:'notice-1',unit_id:1,amount:10000,date:'2026-01-01',status:'pending',note:'<script>bad</script>',created_at:'2026-01-01T00:00:00Z'}];showNoticeDetail('notice-1')`);
 assert.match(f.element('#dialogFields').innerHTML,/&lt;script&gt;/);assert.doesNotMatch(f.element('#dialogFields').innerHTML,/<script>/);
 f.run("reviewNotice('notice-1',true)");assert.match(f.element('#dialogFields').innerHTML,/name="confirmed" required/);
 assert.match(f.element('#dialogFields').innerHTML,/Ocak/);
 f.context.form=new Map([['confirmed','on'],['note','checked']]);await f.run('dialogAction(form)');
 assert.equal(f.requests[0][0],'payment-notices/review');assert.equal(f.requests[0][2].operation,'approve');assert.equal(f.requests[0][2].confirmed,true);
 assert.deepEqual(Array.from(f.requests[0][2].expected,x=>x.id),[1,2]);
 f.run("reviewNotice('notice-1',false)");f.context.form=new Map([['note','no transfer']]);await f.run('dialogAction(form)');
 assert.equal(f.requests[1][2].operation,'reject');assert.equal(f.requests[1][2].expected,undefined);
 f.run('state.admin=false');assert.throws(()=>f.run("showNoticeDetail('notice-1')"),/Yönetici girişi/);
 assert.equal(f.run('noticeQueueCard()'),'');
});
