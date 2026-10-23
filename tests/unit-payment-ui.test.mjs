import {annualDues,filterAnnualDues,annualStatus,MONTHS} from '../public/annual-dues.js';
import {createNoticeBook,NOTICE_TRACKING_KEY,ownNoticeStatus} from '../public/notice-tracking.js';
import {createUnitPreference,MY_UNIT_KEY} from '../public/my-unit.js';
import {unitStatement} from '../public/reports.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {decisionReadPayload} from '../public/decision-reads.js';
import {sessionStorageFor,SESSION_KEY} from '../public/session-storage.js';
import {adminRequestFromHash} from '../public/notification-links.js';
import { unitPaymentPlan } from '../public/unit-payments.js';
import { noticePayload, sendPaymentNotice, waitingNotices, noticeStatus } from '../public/payment-notices.js';
import {requestPayload,sendRequest,requestStatus,requestLink,requestFromHash,requestChange} from '../public/requests.js';

async function fixture(apiImpl){
 const elements=new Map(),requests=[],listeners={};
 const element=selector=>{
  if(!elements.has(selector))elements.set(selector,{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});
  return elements.get(selector);
 };
 const context=vm.createContext({Intl,Date,Set,Number,String,Math,Error,JSON,console,annualDues,filterAnnualDues,annualStatus,MONTHS,downloadAnnualWorkbook:()=>{},createNoticeBook,NOTICE_TRACKING_KEY,ownNoticeStatus,createUnitPreference,MY_UNIT_KEY,unitStatement,decisionReadPayload,sessionStorageFor,SESSION_KEY,adminRequestFromHash,createPush:()=>({sync:async()=>false}),requestPayload,sendRequest,requestStatus,requestLink,requestFromHash,requestChange,location:{href:"https://example.test/apartman/",hash:""},history:{replaceState(){}},unitPaymentPlan,noticePayload,sendPaymentNotice,waitingNotices,noticeStatus,
  crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},window:{},document:{querySelector:element,querySelectorAll:()=>[],addEventListener(type,fn){(listeners[type]??=[]).push(fn);}},
  config:{},createApi:()=>async(...args)=>{requests.push(args);if(apiImpl)return apiImpl(...args);return {ok:true,allocations:[],id:'test-notice',status:'pending'};},initPwa:()=>()=>{},setTimeout:()=>0,clearTimeout(){},setInterval(){}});
 let source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 source=source.replace(/^import .*;\n/gm,'').replace(/^refresh\(\)\.(?:then|catch).*$/m,'');
 vm.runInContext(source,context);
 vm.runInContext(`state={admin:true,units:[{id:1,label:'Daire 1'}],charges:[{id:2,unit_id:1,period:'2026-02',amount:10000,paid:0},{id:1,unit_id:1,period:'2026-01',amount:10000,paid:2500}],payments:[]};`,context);
 return {context,element,requests,listeners,run:code=>vm.runInContext(code,context)};
}
test('Administrator notification waits for login then opens its request and consumes the target',async()=>{
 const f=await fixture(),id='95f4f474-56fe-4e6f-8d5c-a1753341fd91';
 f.context.testId=id;
 f.run("state.admin=false;location.hash='#yonetim-talep='+testId;location.href='https://example.test/apartman/'+location.hash;");
 assert.equal(await f.run('followNotification()'),false);
 assert.equal(f.element('#dialogTitle').textContent,'Yönetici girişi');
 assert.equal(f.requests.length,0);
 f.run("state.admin=true;residentRequests=[{id:testId,unit_id:1,title:'Bildirimden açılan arıza',body:'TEST RECORD',created_at:'2026-10-22T12:00:00Z',status:'received'}];refresh=async()=>{};history.replaceState=(a,b,url)=>history.target=url;");
 assert.equal(await f.run('followNotification()'),true);
 assert.equal(f.element('#dialogTitle').textContent,'Bildirimden açılan arıza');assert.match(f.element('#dialogFields').innerHTML,/TEST RECORD/);
 assert.equal(f.run('tab'),'requests');assert.equal(f.context.history.target,'https://example.test/apartman/');
});
test('Decision detail separates resident declaration from administrator unit tracking and stale-safe removal',async()=>{
 let summary={decisionId:1,version:'v1',total:2,read:1};
 const f=await fixture(()=>summary);
 f.run("state.admin=false;state.decisions=[{id:1,title:'Karar <script>',body:'Karar metni',date:'2026-10-22',version:'v1',archived:false,files:[]}];");
 await f.run('showDecisionDetail(1)');let html=f.element('#dialogFields').innerHTML;
 assert.match(html,/Okudum bildir/);assert.doesNotMatch(html,/Bildirimi kaldır/);
 f.run('openDecisionRead(1)');html=f.element('#dialogFields').innerHTML;assert.match(html,/Karar &lt;script&gt;/);assert.match(html,/name="confirmed" required/);
 f.context.form=new Map([['unitId','1'],['confirmed','on']]);await f.run('dialogAction(form)');
 assert.equal(f.requests.at(-1)[2].unitId,1);assert.equal(f.requests.at(-1)[2].version,'v1');
 f.run('state.admin=true');summary={...summary,units:[{unitId:1,label:'Daire <1>',read:true,readAt:'2026-10-22T12:00:00Z'},{unitId:2,label:'Daire 2',read:false}]};
 await f.run('showDecisionDetail(1)');html=f.element('#dialogFields').innerHTML;assert.match(html,/Daire &lt;1&gt;/);assert.match(html,/Henüz bildirmedi/);assert.match(html,/Bildirimi kaldır/);
 await f.run('removeDecisionRead(1,1)');f.context.form=new Map([['confirmed','on']]);await f.run('dialogAction(form)');
 assert.equal(f.requests.at(-1)[2].operation,'remove');assert.equal(f.requests.at(-1)[2].readAt,'2026-10-22T12:00:00Z');
 summary={...summary,version:'v2'};await assert.rejects(()=>f.run('showDecisionDetail(1)'),/Karar değişmiş/);
});
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

test('resident can correct a server-rejected notice while an uncertain network write stays frozen',async()=>{
 let attempt=0;
 const f=await fixture(async()=>{if(attempt++===0)throw Object.assign(new Error('borcu aşıyor'),{status:400,code:'P0001'});return {id:'test',status:'pending'};});
 f.run('state.admin=false;openPaymentNotice(1)');f.context.form=new Map([['unitId','1'],['amount','351'],['date','2026-01-01']]);
 await assert.rejects(()=>f.run('dialogAction(form)'),/borcu aşıyor/);
 f.context.form.set('amount','1');await f.run('dialogAction(form)');
 assert.equal(f.requests.length,2);assert.equal(f.requests[1][2].amount,1);assert.equal(f.requests[0][2].requestId,f.requests[1][2].requestId);
 const uncertain=await fixture(async()=>{throw new Error('network disconnected');});uncertain.run('state.admin=false;openPaymentNotice(1)');uncertain.context.form=new Map([['unitId','1'],['amount','1'],['date','2026-01-01']]);
 await assert.rejects(()=>uncertain.run('dialogAction(form)'),/network disconnected/);
 uncertain.context.form.set('amount','2');await assert.rejects(()=>uncertain.run('dialogAction(form)'),/Bilgileri değiştirmeden/);assert.equal(uncertain.requests.length,1);
});

test('resident request form submits private text and allows correcting definite rejections',async()=>{
 let count=0;const f=await fixture(async()=>{if(count++===0)throw Object.assign(new Error('rejected'),{status:400,code:'P0001'});return {id:'test',token:'token',path:null};});
 f.run('state.admin=false;openResidentRequest()');assert.match(f.element('#dialogFields').innerHTML,/yönetime özeldir/);
 f.context.form=new Map([['unitId','1'],['title','Lamba arızası'],['body','Merdivendeki lamba yanmıyor.']]);
 await assert.rejects(()=>f.run('dialogAction(form)'),/rejected/);f.context.form.set('title','Lamba onarımı');await f.run('dialogAction(form)');
 assert.equal(f.requests[0][0],'requests/submit');assert.equal(f.requests[0][2].requestId,f.requests[1][2].requestId);
});
test('task conversion previews public fields without copying private complaint or photo',async()=>{
 const f=await fixture();f.run(`residentRequests=[{id:'req',unit_id:1,title:'Lamba',body:'SECRET_ISSUE_BODY',location:'SECRET_LOCATION',status:'received',reply:'',version:'r1',task_version:null,task_id:null,has_photo:true,uploaded:true,path:'SECRET_PHOTO'}];createRequestTask('req')`);
 const html=f.element('#dialogFields').innerHTML;assert.match(html,/ortak ekranda/);assert.match(html,/name="confirmed" required/);assert.doesNotMatch(html,/SECRET_/);
 f.context.form=new Map([['title','Lamba onarımı'],['notes','Ortak açıklama'],['confirmed','on']]);await f.run('dialogAction(form)');
 const call=f.requests[0];assert.equal(call[0],'requests/manage');assert.equal(call[2].operation,'task');assert.equal(call[2].confirmed,true);assert.equal(call[2].version,'r1');
 f.run('state.admin=false');assert.throws(()=>f.run("showRequestDetail('req')"),/Yönetici/);assert.equal(f.run('requestQueueCard()'),'');
});
test('own tracking escapes complaint/reply and updates carry both stale guards',async()=>{
 const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
 const f=await fixture(async()=>({id,title:'<title>',body:'<script>private</script>',reply:'<img>',status:'in_progress',created_at:'2026-10-22T00:00:00Z',location:'',has_photo:true,uploaded:true}));
 f.context.access={id,token};await f.run('showOwnRequest(access)');assert.match(f.element('#dialogFields').innerHTML,/&lt;script&gt;/);assert.match(f.element('#dialogFields').innerHTML,/Yapılıyor/);assert.doesNotMatch(f.element('#dialogFields').innerHTML,/<script>/);
 f.run(`residentRequests=[{id:'req',unit_id:1,title:'Lamba',status:'in_progress',reply:'',version:'r1',task_version:'t1'}];editRequestStatus('req')`);
 f.context.form=new Map([['status','done'],['reply','Onarıldı']]);await f.run('dialogAction(form)');const call=f.requests[1];assert.equal(call[2].taskVersion,'t1');assert.equal(call[2].version,'r1');assert.equal(call[2].status,'done');
});

test('My unit screen isolates balances and receipts, keeps old debt for exempt units, and prefills payment notice',async()=>{
 const f=await fixture();
 f.run(`state.admin=false;state.settings={iban:'',accountHolder:''};state.units=[{id:1,label:'Daire <1>',exempt:true},{id:2,label:'Daire 2'}];
 const current=today().slice(0,7);state.charges=[{id:1,unit_id:1,period:'2000-01',amount:10000,paid:2500,kind:'opening',date:'2000-01-01'},{id:2,unit_id:1,period:current,amount:5000,paid:0},{id:3,unit_id:2,period:current,amount:999999,paid:0}];state.payments=[{id:10,charge_id:1,date:'2026-10-01',amount:2500},{id:20,charge_id:3,date:'2026-10-02',amount:999999}];`);
 let html=f.run('myUnitHTML()');assert.match(html,/Dairemi göster/);
 f.run('unitPreference.set(1,state.units)');html=f.run('myUnitHTML()');
 assert.match(html,/Daire &lt;1&gt;/);assert.match(html,/Yönetim kararı ile muaf/);
 assert.match(html,/125,00/);assert.match(html,/75,00/);assert.match(html,/50,00/);assert.match(html,/data-action="payment-notice" data-id="1"/);
 assert.match(html,/data-action="receipt" data-id="10"/);assert.doesNotMatch(html,/data-id="20"|999\.999|Daire 2/);
 f.run('openPaymentNotice(unitPreference.get(state.units))');assert.match(f.element('#dialogFields').innerHTML,/<option value="1" selected>/);
 f.run('unitChooser=true');assert.match(f.run('myUnitHTML()'),/Vazgeç/);
 f.run('unitChooser=false;unitPreference.set(2,state.units)');html=f.run('myUnitHTML()');assert.match(html,/Daire 2/);assert.doesNotMatch(html,/data-id="10"/);
 f.run('state.units=[]');assert.match(f.run('myUnitHTML()'),/Dairemi göster/);
});
test('A remembered unit opens on resident startup while administrator startup keeps the overview',async()=>{
 const base={admin:false,settings:{name:'Test',iban:''},units:[{id:1,label:'Daire 1'}],charges:[],payments:[],expenses:[],tasks:[],decisions:[],notices:[],totals:{cash:0,receivable:0}};
 const f=await fixture(path=>path==='state'?base:[]);
 f.run('unitPreference.set(1,state.units);overviewHTML=()=>"OVERVIEW";syncChargeSelection=()=>{};');await f.run('refresh()');assert.equal(f.run('tab'),'my-unit');
 base.admin=true;f.run("initialView=true;tab='overview';");await f.run('refresh()');assert.equal(f.run('tab'),'overview');
});

test('Own notices escape review text, hide other units and revoked receipts, and clear stale status on network failure',async()=>{
 const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';let fail=false;
 const f=await fixture(()=>{if(fail)throw new Error('offline');return [{id,unit_id:1,date:'2026-10-23',amount:5000,status:'approved',review_note:'<script>private</script>',payments:[{id:10,period:'2026-10',active:true},{id:11,period:'2026-09',active:false}]},{id:token,unit_id:2,date:'2026-10-23',amount:999999,status:'rejected',review_note:'OTHER UNIT',payments:[]}];});
 f.context.access={id,token,unitId:1};f.run('noticeBook.remember(access);unitPreference.set(1,state.units)');await f.run('loadOwnNotices()');
 let html=f.run('ownNoticesHTML(1)');assert.match(html,/Onaylandı/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|OTHER UNIT|data-id="11"/);assert.match(html,/data-id="10"/);assert.match(html,/sonradan geri alınmış/);
 assert.deepEqual(Object.keys(f.requests.at(-1)[2][0]).sort(),['id','token']);
 f.run("ownNotices[0].status='pending'");html=f.run('ownNoticesHTML(1)');assert.match(html,/İnceleniyor/);assert.doesNotMatch(html,/data-action="receipt"/);
 f.run("ownNotices[0].status='rejected'");assert.match(f.run('ownNoticesHTML(1)'),/Reddedildi/);
 fail=true;await f.run('loadOwnNotices()');html=f.run('ownNoticesHTML(1)');assert.match(html,/alınamadı/);assert.doesNotMatch(html,/Onaylandı|Reddedildi|private/);
});
test('Notice tracking credentials survive uncertain submission but are removed on a definite validation rejection',async()=>{
 let uncertain=true;const f=await fixture(()=>{throw Object.assign(new Error('failed'),uncertain?{}:{status:400,code:'P0001'});});
 f.run('openPaymentNotice(1)');f.context.form=new Map([['unitId','1'],['amount','1'],['date','2026-01-01'],['note','']]);
 await assert.rejects(()=>f.run('dialogAction(form)'));assert.equal(f.run('noticeBook.entries(1).length'),1);
 uncertain=false;await assert.rejects(()=>f.run('dialogAction(form)'));assert.equal(f.run('noticeBook.entries(1).length'),0);
});


test('Acknowledgement tracking button closes the dialog and opens the submitted unit without another submission',async()=>{
 const f=await fixture();f.run("showNoticeAcknowledgement({id:'11111111-1111-4111-8111-111111111111',status:'pending',unitId:1,trackingSaved:true});refresh=async()=>{};");
 assert.equal(f.element('#modal').open,true);
 const btn={dataset:{action:'own-notices',id:'1'}};
 await f.listeners.click[0]({target:{closest:selector=>selector==='[data-action]'?btn:null},preventDefault(){}});
 assert.equal(f.element('#modal').open,false);assert.equal(f.run('tab'),'my-unit');assert.equal(f.run('unitPreference.get(state.units)'),1);assert.equal(f.requests.length,0);
});


test('Annual grid opens only the selected unit/month payments, escapes labels and shows missing dues without changing records',async()=>{
 const f=await fixture();f.run("annualYear=2026;state.units.push({id:2,label:'Daire <2>'});state.payments=[{id:10,charge_id:1,date:'2027-01-02',amount:2500,note:'SECRET'}, {id:20,charge_id:2,date:'2026-01-02',amount:5000}];");
 const html=f.run('annualDuesHTML()');assert.match(html,/Daire &lt;2&gt;/);assert.equal((html.match(/data-action="annual-month"/g)||[]).length,24);assert.match(html,/Excel’e indir/);assert.match(html,/Önceki yıl/);assert.match(html,/Sonraki yıl/);
 f.run("showAnnualMonth(1,'2026-01')");let detail=f.element('#dialogFields').innerHTML;
 assert.match(detail,/Kısmi/);assert.match(detail,/data-id="10"/);assert.doesNotMatch(detail,/data-id="20"|SECRET/);assert.match(detail,/2027/);
 f.run("showAnnualMonth(2,'2026-01')");detail=f.element('#dialogFields').innerHTML;assert.match(detail,/aidat kaydı yok/);assert.doesNotMatch(detail,/data-action="receipt"/);
 assert.throws(()=>f.run("showAnnualMonth(1,'2026-99')"),/Geçersiz/);assert.throws(()=>f.run("showAnnualMonth(99,'2026-01')"),/bulunamadı/);
});


test('Navigation chosen while startup data is loading is preserved instead of reopening the remembered unit',async()=>{
 let finish;const f=await fixture(()=>new Promise(resolve=>{finish=resolve;}));
 f.run('unitPreference.set(1,state.units);state=undefined;render=()=>{};');const pending=f.run('refresh()');
 const nav={dataset:{tab:'dues'}};await f.listeners.click[0]({target:{closest:selector=>selector==='[data-tab]'?nav:null}});
 assert.equal(f.run('tab'),'dues');assert.match(f.element('#view').innerHTML,/yükleniyor/);
 finish({admin:false,settings:{name:'Test'},units:[{id:1}],charges:[],payments:[]});await pending;assert.equal(f.run('tab'),'dues');
});
test('Annual grid restores both scroll axes on data refresh while a different year starts at the beginning',async()=>{
 const f=await fixture();f.run("tab='annual-dues';annualYear=2026;state.expenses=[];syncChargeSelection=()=>{};");
 let reads=0;const old={dataset:{year:'2026'},scrollLeft:183,scrollTop:91},fresh={scrollLeft:0,scrollTop:0},query=f.context.document.querySelector;
 f.context.document.querySelector=selector=>selector==='.annual-scroll'?(++reads===1?old:fresh):query(selector);
 f.run('render()');assert.equal(fresh.scrollLeft,183);assert.equal(fresh.scrollTop,91);
 reads=0;fresh.scrollLeft=0;fresh.scrollTop=0;f.run('annualYear=2025;render()');assert.equal(fresh.scrollLeft,0);assert.equal(fresh.scrollTop,0);
});
