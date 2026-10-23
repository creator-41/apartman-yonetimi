import { createNoticeBook, NOTICE_TRACKING_KEY, ownNoticeStatus } from './notice-tracking.js?v=track-1';
import { createUnitPreference, MY_UNIT_KEY } from './my-unit.js?v=unit-1';
import { decisionReadPayload } from './decision-reads.js?v=reads-1';
import { sessionStorageFor, SESSION_KEY } from './session-storage.js?v=persistent-1';
import { adminRequestFromHash } from './notification-links.js?v=push-link-1';
import { createPush } from './push.js?v=push-1';
import { requestStatus, requestPayload, sendRequest, requestLink, requestFromHash, requestChange } from './requests.js?v=request-1';
import { noticePayload, sendPaymentNotice, waitingNotices, noticeStatus } from './payment-notices.js?v=track-1';
import { unitPaymentPlan } from './unit-payments.js?v=request-1';
import { initPwa } from './pwa.js?v=push-1';
import { filterUnits } from './dues-filters.js?v=request-1';
import { changeInfo } from './history.js?v=request-1';
import { paymentReceipt, receiptSvg, receiptLink, downloadReceipt } from './receipts.js?v=request-1';
import { normalizeIban, formatIban, reminderText } from './payment-tools.js?v=request-1';
import { openTasks, taskSave, statusName } from './work.js?v=request-1';
import { expenseUpdate, uploadReceipt, removeReceipt } from './expense-files.js?v=request-1';
import { monthReport, monthReportText, monthSummaryText, unitStatement, unitStatementText } from './reports.js?v=summary-1';
import { unpaidCharges, chargeRequest } from './charge-management.js';
import { createApi } from './transport.js?v=track-1';
import { config } from './config.js?v=push-1';
const noticeBook=createNoticeBook(window);
let ownNotices=[],ownNoticeError="",ownNoticeLoad=0;
const unitPreference=createUnitPreference(window);
let initialView=true,unitChooser=false;
const storage=sessionStorageFor(window);
const api=createApi({...config,storage});
const push=createPush({api,publicKey:config.vapidPublicKey});
const selectedCharges=new Set();
let chargeDialogContext=null;
let bulkMode=false;
let unitQuery="",duesFilter="all";
let reportContext=null;
let documentTarget=null;
let workFilter="open";let decisionArchive=false;
let uploadingDocument=false;
let createdPaymentId=null,createdDecisionReadId=null;
let unitPaymentContext=null,createdPaymentGroup=null;
let paymentNotices=[],paymentNoticeError="",createdNoticeAcknowledgement=null;
let residentRequests=[],requestError="",requestFilter="open",requestAccess=null,createdResidentRequest=null;
let changeHistory=[],historyError="";
'use strict';
let state,tab='overview',selectedMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit'}).format(new Date()),dialogAction;
const $=s=>document.querySelector(s);
const money=v=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2}).format(v/100);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const monthName=v=>new Date(v+'-15T12:00:00').toLocaleDateString('tr-TR',{year:'numeric',month:'long'});
const dateName=v=>new Date(v.slice(0,10)+'T12:00:00').toLocaleDateString('tr-TR');
const unitName=id=>state.units.find(u=>u.id===id)?.label||'Bölüm';
const noticeHTML=n=>'<article class="notice"><h3>'+esc(n.title)+'</h3><p>'+esc(n.body)+'</p><small>'+dateName(n.created_at)+'</small>'+(state.admin?' <button class="small danger" data-action="delete-notice" data-id="'+n.id+'">Kaldır</button>':'')+'</article>';
async function refresh(){
 state=await api('state');
 if(initialView){initialView=false;if(!state.admin&&unitPreference.get(state.units))tab='my-unit';}
 if(!state.admin){changeHistory=[];paymentNotices=[];paymentNoticeError='';residentRequests=[];requestError='';if(['history','payment-notices','requests'].includes(tab))tab='overview';}
 else if(tab==='history'){try{changeHistory=await api('history');historyError='';}catch(e){changeHistory=[];historyError=e.message;}}
 if(state.admin){try{paymentNotices=await api('payment-notices');paymentNoticeError='';}catch(e){paymentNoticeError=e.message;}}
 if(state.admin){try{residentRequests=await api('requests');requestError='';}catch(e){requestError=e.message;}}
 $('#building').textContent=state.settings.name;document.title=state.settings.name+' · Komşu';
 $('#mode').textContent=state.admin?'Yönetici paneli':'Ortak takip ekranı';$('#auth').textContent=state.admin?'Çıkış yap':'Yönetici girişi';
 document.querySelectorAll('.admin-only').forEach(e=>e.hidden=!state.admin);
 if(!state.admin&&['units','settings','history','payment-notices','requests'].includes(tab))tab='overview';
 if(tab==='my-unit')await loadOwnNotices();
 $('#error').hidden=true;render();
 push.sync({admin:state.admin}).catch(()=>{});
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4500);}
function error(e){$('#error').textContent=e.message;$('#error').hidden=false;if($('#modal').open)$('#dialogError').textContent=e.message;}
function table(headers,rows,empty='Henüz kayıt yok.'){return rows.length?'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>':'<div class="empty">'+empty+'</div>';}
function monthFilter(){return '<div class="month-picker"><button class="outline month-arrow" data-action="previous-month" aria-label="Önceki ay" '+(selectedMonth==='2000-01'?'disabled':'')+'>‹</button><label class="month-label" for="monthFilter"><span>'+esc(monthName(selectedMonth))+'</span><input aria-label="Ay seçin" id="monthFilter" type="month" min="2000-01" max="2099-12" value="'+selectedMonth+'"></label><button class="outline month-arrow" data-action="next-month" aria-label="Sonraki ay" '+(selectedMonth==='2099-12'?'disabled':'')+'>›</button></div>';}
function cards(){
 const report=monthReport(state,selectedMonth);
 const old=state.charges.filter(c=>c.period<selectedMonth).reduce((sum,c)=>sum+c.amount-c.paid,0);
 return '<div class="cards summary-cards">'+[['Kasa',state.totals.cash,'Güncel bakiye','featured'],['Kalan aidat',state.totals.receivable,'Tüm dönemler',''],['Bu ay tahsilat',report.income,monthName(selectedMonth),''],['Önceki aylardan kalan',old,'Seçili ay öncesi','arrears']].map(([title,value,help,cls])=>'<div class="card '+cls+'"><div class="label">'+title+'</div><div class="number">'+money(value)+'</div><small>'+esc(help)+'</small></div>').join('')+'</div>';
}
function earlierDebt(unitId){return state.charges.filter(c=>c.unit_id===unitId&&c.period<selectedMonth).reduce((sum,c)=>sum+c.amount-c.paid,0);}
function chargeMenu(c){return '<details class="row-menu"><summary aria-label="Aidat işlemleri">⋯</summary><div class="row-menu-items"><button class="small outline" data-action="edit-charge" data-id="'+c.id+'" '+(c.paid>0?'disabled':'')+'>Düzenle</button><button class="small danger" data-action="remove-charge" data-id="'+c.id+'" '+(c.paid>0?'disabled':'')+'>Sil</button>'+(c.paid>0?'<small>Ödeme kaydı olan aidat korunur.</small>':'')+'</div></details>';}
function newsHTML(limit=Infinity,compact=false){
 const groups=[
  ['Duyurular','notices',state.notices,noticeHTML],
  ['Alınan kararlar','decisions',(state.decisions||[]).filter(d=>!d.archived),d=>'<article class="notice"><button class="news-title" data-action="decision-detail" data-id="'+d.id+'">'+esc(d.title)+' <span aria-hidden="true">›</span></button><p class="news-preview">'+esc(d.body)+'</p><small>'+dateName(d.date)+(d.decision_no?' · Karar no: '+esc(d.decision_no):'')+'</small></article>'],
  ['Verilen görevler','tasks',[...(state.tasks||[])].filter(t=>!t.archived).sort((a,b)=>b.id-a.id),t=>'<article class="notice"><button class="news-title" data-action="task-detail" data-id="'+t.id+'">'+esc(t.title)+' <span aria-hidden="true">›</span></button><p>'+esc(t.assignee||'Sorumlu belirtilmedi')+' · <span class="badge">'+esc(statusName(t.status))+'</span></p>'+(t.due_date?'<small class="'+(t.status!=='done'&&t.due_date<today()?'overdue':'')+'">Hedef: '+dateName(t.due_date)+'</small>':'')+'</article>']
 ];
 if(compact){
  const active=groups.filter(([, ,rows])=>rows.length);
  return active.map(([title,target,rows,html])=>'<section class="news-group"><h3>'+title+'</h3>'+rows.slice(0,limit).map(row=>target==='notices'?'<article class="notice"><button class="news-title" data-tab="notices">'+esc(row.title)+' <span aria-hidden="true">›</span></button><p class="news-preview">'+esc(row.body)+'</p></article>':html(row)).join('')+'</section>').join('')||'<p class="muted">Henüz haber yok.</p>';
 }
 return groups.map(([title,target,rows,html])=>'<section class="news-group"><div class="toolbar"><h3>'+title+'</h3><button class="small outline" data-tab="'+target+'">'+(rows.length>limit?'Tümü ('+rows.length+')':'Aç')+'</button></div>'+(rows.slice(0,limit).map(html).join('')||'<p class="muted">Henüz kayıt yok.</p>')+'</section>').join('');
}
function bankHTML(){
 if(!state.settings.iban)return state.admin?'<section class="panel bank-card"><div><h2>Aidat ödeme hesabı</h2><p class="muted">IBAN henüz eklenmedi.</p></div><button class="primary" data-tab="settings">Ödeme hesabı ekle</button></section>':'';
 return '<section class="panel bank-card"><div><h2>Aidat ödeme hesabı</h2><p>'+esc(state.settings.accountHolder)+'</p><p class="iban">'+esc(formatIban(state.settings.iban))+'</p></div><button class="outline" data-action="copy-iban">IBAN kopyala</button></section>';
}
function bankForm(){
 return '<section class="panel"><h2>Aidat ödeme hesabı</h2><form id="bankForm" class="setting-form"><label for="accountHolder">Hesap sahibi</label><input id="accountHolder" name="accountHolder" maxlength="100" value="'+esc(state.settings.accountHolder)+'"><label for="iban">IBAN</label><input id="iban" name="iban" maxlength="40" placeholder="TR…" autocomplete="off" value="'+esc(formatIban(state.settings.iban))+'"><p class="help">Kaydedilen hesap bilgileri ortak Aidatlar ekranında görünür. Kaldırmak için IBAN alanını boşaltın.</p><button class="primary" type="submit">Ödeme hesabını kaydet</button><p id="bankError" role="alert"></p></form></section>';
}
async function showPushSettings(){
 let syncError='';try{await push.sync({admin:state.admin,access:requestAccess,force:true});}catch{syncError='Cihaz kaydı güncellenemedi. Bağlantıyı kontrol edip tekrar deneyin.';}
 const support=push.support(),enabled=push.enabled();
 openReadDialog('Bildirimler','<p>'+ (enabled?'Bildirimler bu cihazda açık.':'Bildirimler bu cihazda kapalı.')+'</p><p>Yeni duyuru ve yönetim kararları için haber alın.'+(state.admin?' Yönetici olarak yeni ödeme bildirimleri ve arıza / talepler de bu cihaza gelir.':'')+(requestAccess?' Bu talebin durum ve yanıt güncellemeleri de bu cihaza gelir.':'')+'</p><p class="help">Bildirimde tutar, daire veya talep açıklaması gösterilmez.</p>'+(syncError?'<p role="alert">'+esc(syncError)+'</p>':'')+(support==='install'?'<p>iPhone’da siteyi ana ekrana ekleyin ve uygulama simgesinden açın. Ardından burada bildirimleri açın.</p><button type="button" class="primary" data-action="install-app">Ana ekrana ekle</button>':support==='unsupported'?'<p>Bu tarayıcı telefon bildirimlerini desteklemiyor. Güncel bir telefon tarayıcısından deneyin.</p>':'<div class="actions"><button type="button" class="primary" data-action="'+(enabled?'push-disable':'push-enable')+'">'+(enabled?'Bildirimleri kapat':'Bildirimleri aç')+'</button>'+(enabled?'<button type="button" class="outline" data-action="push-test">Deneme bildirimi gönder</button>':'')+'</div>'));
}
async function copyPaymentText(text,label){
 try{await navigator.clipboard.writeText(text);toast(label);}
 catch{openReadDialog('Metni kopyala','<textarea id="paymentCopy" readonly rows="7">'+esc(text)+'</textarea>');$('#paymentCopy').focus();$('#paymentCopy').select();}
}
function showReceipt(id){
 const receipt=paymentReceipt(state,id),link=receiptLink(location.href,id);
 openReadDialog(receipt.number+' · Ödeme makbuzu','<div class="receipt-preview">'+receiptSvg(receipt,link)+'</div><div class="actions report-actions"><button type="button" class="primary" data-action="download-receipt" data-id="'+id+'">Makbuzu indir (PNG)</button><button type="button" class="outline" data-action="copy-receipt-link" data-id="'+id+'">Bağlantıyı kopyala</button><a class="outline" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">Aç / Yazdır / PDF</a></div>');
}
const timeName=value=>new Date(value).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'});
const signedMoney=value=>(value>0?'+':'')+money(value);
function changeSummary(entry){
 const {row}=changeInfo(entry),charge=state.charges.find(c=>c.id===row.charge_id);
 const label=entry.entity==='payment'?(charge?unitName(charge.unit_id)+' · '+monthName(charge.period):'Aidat #'+row.charge_id):row.description;
 return '<p><strong>'+esc(label)+'</strong> · '+dateName(row.date)+'</p><p>'+ (entry.operation==='UPDATE'?money(entry.before_row.amount)+' → ':'')+money(row.amount)+'</p>';
}
function historyHTML(){
 return '<section class="panel"><div class="toolbar"><h2>İşlem geçmişi</h2><button class="outline" data-action="refresh-history">Yenile</button></div><p class="help">Yeni ödeme ve gider işlemlerinin son 100 kaydı. Aynı kayıtta birden fazla değişiklik varsa en son işlemden başlayın.</p>'+(historyError?'<p role="alert">'+esc(historyError)+'</p>':'')+(changeHistory.map(entry=>{
  const info=changeInfo(entry);
  return '<article class="change-item"><div class="toolbar"><h3>'+esc(info.title)+'</h3>'+(info.canUndo?'<button class="outline small" data-action="undo-change" data-id="'+entry.id+'">Geri al</button>'+(entry.batch_id?'<button class="outline small" data-action="undo-payment-batch" data-batch-id="'+entry.batch_id+'">Tüm ödemeyi geri al</button>':''):'<span class="badge">'+(entry.undone_at?'Geri alındı':'Geri alma kaydı')+'</span>')+'</div>'+changeSummary(entry)+'<small>'+esc(timeName(entry.created_at))+' · '+esc(entry.actor_label)+'</small>'+(entry.undone_at?'<p class="help">Geri alan: '+esc(entry.undone_label)+' · '+esc(timeName(entry.undone_at))+'</p>':'')+'</article>';
 }).join('')||'<p class="empty">Yeni ödeme ve gider işlemleri burada görünecek.</p>')+'<details class="secondary-section"><summary>Diğer işlem kayıtları</summary>'+table(['Tarih','İşlem','Yönetici'],(state.audit||[]).map(a=>'<tr><td>'+esc(timeName(a.created_at))+'</td><td>'+esc(a.action)+'</td><td>'+esc(a.actor?'Yönetici '+a.actor.slice(0,8):'Yönetici')+'</td></tr>'))+'</details></section>';
}
function visibleUnits(){return filterUnits(state.units,state.charges,selectedMonth,unitQuery,duesFilter);}
function visibleUnpaidCharges(){const ids=new Set(visibleUnits().map(u=>u.id));return unpaidCharges(state.charges.filter(c=>c.period===selectedMonth&&ids.has(c.unit_id)));}
function duesFiltersHTML(count){
 const hint=duesFilter==='debt'?'Seçili ay ve önceki aylardan kalan borçlar.':duesFilter==='partial'?'Seçili ayın aidatını kısmen ödeyenler.':duesFilter==='paid'?'Seçili ayın aidatını ödeyen ve önceki borcu kalmayanlar.':'';
 return '<div class="dues-filters"><div><label for="unitSearch">Daire / dükkân ara</label><input id="unitSearch" type="search" maxlength="100" autocomplete="off" placeholder="Örn. Daire 3" value="'+esc(unitQuery)+'"></div><div><label for="duesFilter">Ödeme durumu</label><select id="duesFilter">'+[['all','Hepsi'],['debt','Borcu olanlar'],['partial','Kısmi ödeyenler'],['paid','Ödeyenler']].map(([value,label])=>'<option value="'+value+'" '+(duesFilter===value?'selected':'')+'>'+label+'</option>').join('')+'</select></div>'+((unitQuery||duesFilter!=='all')?'<button class="outline" data-action="clear-dues-filter">Temizle</button>':'')+'</div><p class="help filter-summary">'+count+' / '+state.units.length+' bölüm gösteriliyor.'+(hint?' '+hint:'')+'</p>';
}
function updateUnitSearch(e){
 if(e.isComposing)return;
 const position=e.target.selectionStart;unitQuery=e.target.value;selectedCharges.clear();render();
 const search=$('#unitSearch');search.focus();if(position!==null)search.setSelectionRange(position,position);
}
document.addEventListener('compositionend',e=>{if(e.target.id==='unitSearch')updateUnitSearch(e);});
function requestEntry(){return '<button type="button" class="outline" data-action="request-new">Arıza / talep bildir</button>';}
function requestQueueCard(){
 if(!state.admin)return '';
 const count=residentRequests.filter(r=>r.status!=='done').length;
 return '<section class="panel notice-queue"><div><h3>Arıza ve talepler'+(requestError?'':' · '+count+' açık')+'</h3><p class="muted">'+(requestError?'Talepler alınamadı. Yenileyip kontrol edin.':'Komşulardan gelen bildirimler.')+'</p></div><button class="outline" data-tab="requests">Talepleri incele</button></section>';
}
function openResidentRequest(){
 const requestId=crypto.randomUUID();let frozen;
 openDialog('Arıza / talep bildir','<label for="f-unitId">Daireniz / dükkânınız</label><select id="f-unitId" name="unitId" required><option value="">Seçin</option>'+state.units.map(u=>'<option value="'+u.id+'">'+esc(u.label)+'</option>').join('')+'</select>'+input('title','Konu','text','','required minlength="3" maxlength="100"')+input('location','Yer (isteğe bağlı)','text','','maxlength="100" placeholder="Örn. 2. kat merdiven"')+'<label for="f-body">Açıklama</label><textarea id="f-body" name="body" rows="4" required minlength="10" maxlength="2000"></textarea><label for="f-photo">Fotoğraf (isteğe bağlı)</label><input id="f-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><p class="help">JPG, PNG veya WEBP · En fazla 5 MB. Talep ve fotoğraf yönetime özeldir.</p>',async f=>{
  const file=$('#f-photo').files?.[0],payload=requestPayload({requestId,unitId:f.get('unitId'),title:f.get('title'),body:f.get('body'),location:f.get('location')||'',file});
  if(frozen&&JSON.stringify(frozen)!==JSON.stringify(payload))throw new Error('İlk gönderim kaydedilmiş olabilir. Bilgileri değiştirmeden tekrar deneyin.');
  frozen=payload;uploadingDocument=true;
  try{createdResidentRequest=await sendRequest(api,payload,file);toast('Talebiniz yönetime iletildi.');}catch(error){if(error.requestSubmissionRejected)frozen=null;throw error;}finally{uploadingDocument=false;}
 },'Talebi gönder');
}
async function showOwnRequest(access){
 requestAccess=access;history.replaceState(null,'',requestLink(location.href,access.id,access.token));
 const r=await api('requests/track','POST',access);
 openReadDialog('Talebiniz · '+r.id.slice(0,8),'<h3>'+esc(r.title)+'</h3><p><span class="badge">'+esc(requestStatus(r.status))+'</span> · '+dateName(r.created_at)+'</p>'+(r.location?'<p>Yer: '+esc(r.location)+'</p>':'')+'<p class="work-body">'+esc(r.body)+'</p>'+(r.reply?'<div class="note"><strong>Yönetim yanıtı</strong><p>'+esc(r.reply)+'</p></div>':'')+(r.has_photo?'<p class="help">Fotoğraf: '+(r.uploaded?'Yüklendi':'Yükleme tamamlanmamış; yöneticiye ulaşabilirsiniz.')+'</p>':'')+'<div class="actions"><button type="button" class="outline" data-action="push-settings">Yanıt bildirimleri</button><button type="button" class="outline" data-action="request-track">Durumu yenile</button><button type="button" class="primary" data-action="request-copy-link">Takip bağlantısını kopyala</button></div><p class="help">Bu bağlantıyı saklayın. Bağlantıya sahip kişi talebinizi ve yönetim yanıtını görebilir.</p>');
}
function residentRequestsHTML(){
 const rows=residentRequests.filter(r=>requestFilter==='all'||(requestFilter==='open'?r.status!=='done':r.status==='done'));
 return '<section class="panel"><div class="toolbar"><h2>Arıza ve talepler</h2><button class="outline" data-action="requests-refresh">Yenile</button></div><label for="requestFilter">Talepleri göster</label><select id="requestFilter">'+[['open','Açık talepler'],['done','Tamamlananlar'],['all','Tümü']].map(([v,l])=>'<option value="'+v+'"'+(requestFilter===v?' selected':'')+'>'+l+'</option>').join('')+'</select>'+(requestError?'<p role="alert">'+esc(requestError)+'</p>':'')+(rows.map(r=>'<article class="change-item"><div class="toolbar"><h3>'+esc(r.title)+'</h3><button class="outline small" data-action="request-detail" data-request-id="'+esc(r.id)+'">İncele</button></div><p>'+esc(unitName(r.unit_id))+' · <span class="badge">'+esc(requestStatus(r.status))+'</span></p><small>'+esc(timeName(r.created_at))+' · '+esc(r.id.slice(0,8))+'</small>'+(r.task_id?'<p class="help">Göreve bağlandı.</p>':'')+'</article>').join('')||'<p class="empty">Bu listede henüz talep yok.</p>')+'</section>';
}
function requestRow(id){if(!state.admin)throw new Error('Yönetici girişi gerekli.');const r=residentRequests.find(r=>r.id===id);if(!r)throw new Error('Talep bulunamadı. Listeyi yenileyin.');return r;}
function showRequestDetail(id){
 const r=requestRow(id);
 openReadDialog(r.title,'<p>'+esc(unitName(r.unit_id))+' · '+esc(requestStatus(r.status))+' · '+esc(timeName(r.created_at))+'</p>'+(r.location?'<p>Yer: '+esc(r.location)+'</p>':'')+'<p class="work-body">'+esc(r.body)+'</p>'+(r.reply?'<div class="note">'+esc(r.reply)+'</div>':'')+(r.has_photo?(r.uploaded?'<button type="button" class="outline" data-action="request-photo" data-request-id="'+esc(id)+'">Fotoğrafı aç</button>':'<p class="help">Fotoğraf yüklemesi tamamlanmamış.</p>'):'')+'<div class="actions report-actions"><button type="button" class="primary" data-action="request-status" data-request-id="'+esc(id)+'">Durum / Yanıt</button>'+(r.task_id?'<button type="button" class="outline" data-action="task-detail" data-id="'+r.task_id+'">Görevi aç</button>':'<button type="button" class="outline" data-action="request-task" data-request-id="'+esc(id)+'">Görev oluştur</button>')+'</div>');
}
let decisionReadContext=null;
async function showDecisionDetail(id){
 const d=state.decisions.find(x=>x.id===id);if(!d)throw new Error('Karar bulunamadı.');
 const reads=await api('decisions/reads','POST',{decisionId:id});
 if(reads.version!==d.version)throw new Error('Karar değişmiş. Sayfayı yenileyin.');
 decisionReadContext={decision:d,summary:reads};
 const tracking='<h3 class="section-title">Okudum bildirimleri</h3><p><strong>'+reads.total+' bölümden '+reads.read+'’i bildirdi.</strong></p>'+(state.admin?'<p class="help">Daire adına beyan edilir; kimlik doğrulaması veya oylama değildir.</p>'+table(['Bölüm','Bildirim',''],(reads.units||[]).map(u=>'<tr><td>'+esc(u.label)+'</td><td>'+(u.read?'Okudum · '+esc(timeName(u.readAt)):'Henüz bildirmedi')+'</td><td>'+(u.read?'<button type="button" class="small outline" data-action="decision-read-remove" data-id="'+id+'" data-unit-id="'+u.unitId+'">Bildirimi kaldır</button>':'')+'</td></tr>')):(!d.archived?'<button type="button" class="primary" data-action="decision-read" data-id="'+id+'">Okudum bildir</button><p class="help">Dairenizi / dükkânınızı seçerek bildirebilirsiniz.</p>':'<p class="help">Bu karar arşivde.</p>'));
 openReadDialog(d.title,'<p class="muted">'+dateName(d.date)+(d.decision_no?' · Karar no: '+esc(d.decision_no):'')+'</p><p class="work-body">'+esc(d.body)+'</p>'+((state.admin||(d.files||[]).length)?'<button type="button" class="outline" data-action="decision-files" data-id="'+d.id+'">Belgeler ('+(d.files||[]).length+')</button>':'')+tracking);
}
function openDecisionRead(id){
 const d=decisionReadContext?.decision;if(!d||d.id!==id||d.archived)throw new Error('Kararı yeniden açın.');
 openDialog('Kararı okudum','<p>'+esc(d.title)+'</p><label for="f-unitId">Daireniz / dükkânınız</label><select id="f-unitId" name="unitId" required><option value="">Seçin</option>'+state.units.map(u=>'<option value="'+u.id+'">'+esc(u.label)+'</option>').join('')+'</select><label class="check"><input type="checkbox" name="confirmed" required> Seçtiğim bölüm adına bu kararı okudum.</label>',async f=>{
  if(!f.get('confirmed'))throw new Error('Okudum kutusunu işaretleyin.');
  await api('decisions/reads','POST',decisionReadPayload(d,f.get('unitId')));createdDecisionReadId=id;toast('Okudum bildiriminiz kaydedildi.');
 },'Okudum');
}
async function removeDecisionRead(id,unitId){
 if(!state.admin)throw new Error('Yönetici girişi gerekli.');
 const current=decisionReadContext;if(current?.decision.id!==id)throw new Error('Kararı yeniden açın.');
 const row=current.summary.units?.find(u=>u.unitId===unitId&&u.read);if(!row)throw new Error('Bildirim bulunamadı.');
 const d=current.decision;
 openDialog('Okudum bildirimini kaldır','<p>'+esc(row.label)+' için bu karara ait bildirim kaldırılacak.</p><label class="check"><input name="confirmed" type="checkbox" required> Bildirimi kaldır.</label>',async f=>{
  if(!f.get('confirmed'))throw new Error('Kaldırma kutusunu işaretleyin.');
  await api('decisions/reads','POST',{operation:'remove',decisionId:id,unitId,version:d.version,readAt:row.readAt});createdDecisionReadId=id;toast('Bildirim kaldırıldı.');
 },'Kaldır');
}
function editRequestStatus(id){
 const r=requestRow(id);
 openDialog('Talep durumu / Yanıt','<p>'+esc(r.title)+'</p><label for="f-status">Durum</label><select name="status" id="f-status">'+['received','in_progress','done'].map(status=>'<option value="'+status+'"'+(r.status===status?' selected':'')+'>'+esc(requestStatus(status))+'</option>').join('')+'</select><label for="f-reply">Yönetim yanıtı (talep sahibi görür)</label><textarea id="f-reply" name="reply" rows="4" maxlength="1000">'+esc(r.reply)+'</textarea>',async f=>{
  await api('requests/manage','POST',requestChange(r,{operation:'status',status:f.get('status'),reply:f.get('reply')||''}));toast('Talep güncellendi.');
 },'Güncelle');
}
function createRequestTask(id){
 const r=requestRow(id);
 openDialog('Talepten görev oluştur','<p class="note">Görev ortak ekranda görünecek. Paylaşılacak metni kontrol edin. Talebin fotoğrafı ve özel açıklaması otomatik paylaşılmaz.</p>'+input('title','Görev başlığı','text',r.title,'required minlength="1" maxlength="150"')+'<label for="f-notes">Ortak görev açıklaması</label><textarea id="f-notes" name="notes" rows="3" maxlength="2000"></textarea>'+input('assignee','Sorumlu (isteğe bağlı)','text','','maxlength="100"')+input('dueDate','Hedef tarih (isteğe bağlı)','date','','min="2000-01-01" max="2099-12-31"')+'<label class="check"><input type="checkbox" name="confirmed" required> Görev bilgilerinin ortak ekranda görünmesini onaylıyorum.</label>',async f=>{
  await api('requests/manage','POST',requestChange(r,{operation:'task',title:f.get('title'),notes:f.get('notes')||'',assignee:f.get('assignee')||'',dueDate:f.get('dueDate')||'',confirmed:f.get('confirmed')==='on'}));toast('Görev oluşturuldu. Talep ve görev durumları birlikte izlenecek.');
 },'Görevi oluştur');
}

function noticeEntryButton(unitId){return '<button type="button" class="outline" data-action="payment-notice"'+(unitId?' data-id="'+unitId+'"':'')+'>Ödeme yaptım</button>';}
function noticeQueueCard(){
 if(!state.admin)return '';
 const count=waitingNotices(paymentNotices).length;
 return '<section class="panel notice-queue"><div><h3>Ödeme bildirimleri'+(paymentNoticeError?'':' · '+count+' bekleyen')+'</h3><p class="muted">'+(paymentNoticeError?'Bildirimler alınamadı. Yenileyip tekrar kontrol edin.':'Komşuların bildirdiği ödemeleri banka hesabından kontrol edin.')+'</p></div><button class="outline" data-tab="payment-notices">'+(count?'Bildirimleri incele':'Bildirimler')+'</button></section>';
}
function openPaymentNotice(unitId){
 const requestId=crypto.randomUUID(),trackingToken=crypto.randomUUID();let frozen;
 const choices=state.units.map(u=>'<option value="'+u.id+'"'+(u.id===unitId?' selected':'')+'>'+esc(u.label)+'</option>').join('');
 openDialog('Ödeme yaptım','<label for="f-unitId">Daireniz / dükkânınız</label><select id="f-unitId" name="unitId" required><option value="">Seçin</option>'+choices+'</select>'+input('amount','Ödediğiniz tutar (TL)','number','','required min="0.01" max="10000000" step="0.01"')+input('date','Ödeme tarihi','date',today(),'required min="2000-01-01" max="'+today()+'"')+input('note','Not (isteğe bağlı)','text','','maxlength="200"')+'<label for="f-receipt">Dekont (isteğe bağlı)</label><input id="f-receipt" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><p class="help">JPG, PNG, WEBP veya PDF · En fazla 5 MB. Bildirim ve dekont yalnızca yönetime görünür.</p><p class="note">Yönetici ödemeyi onayladıktan sonra borcunuzdan düşer.</p>',async f=>{
  const file=$('#f-receipt').files?.[0],payload={...noticePayload({requestId,unitId:Number(f.get('unitId')),amount:f.get('amount'),date:f.get('date'),note:f.get('note')||'',file},today()),trackingToken};
  if(frozen&&JSON.stringify(frozen)!==JSON.stringify(payload))throw new Error('İlk gönderimin sonucu belirsiz olabilir. Bilgileri değiştirmeden tekrar deneyin veya yöneticiyle kontrol edin.');
  frozen=payload;
  const trackingSaved=noticeBook.remember({id:requestId,token:trackingToken,unitId:payload.unitId});uploadingDocument=true;
  try{createdNoticeAcknowledgement={...await sendPaymentNotice(api,payload,file),unitId:payload.unitId,trackingSaved};toast('Ödeme bildirimi gönderildi.');}catch(error){if(error.noticeSubmissionRejected){frozen=null;noticeBook.forget(requestId);}throw error;}finally{uploadingDocument=false;}
 },'Bildirimi gönder');
}
function showNoticeAcknowledgement(result){
 const message=result.status==='approved'?'Bu bildirim daha önce onaylandı. Güncel borcunuzu hesap dökümünden kontrol edebilirsiniz.':result.status==='rejected'?'Bu bildirim yönetici tarafından reddedilmiş. Yöneticiyle görüşebilirsiniz.':'Yönetici banka hesabını kontrol edip onaylayınca ödeme borcunuzdan düşecek.';
 openReadDialog('Ödeme bildirimi alındı','<p>Bildirim no: <strong>'+esc(result.id.slice(0,8))+'</strong></p><p>'+esc(ownNoticeStatus(result.status))+'</p><p>'+message+'</p><button type="button" class="primary" data-action="own-notices" data-id="'+result.unitId+'">Dairem’de takip et</button>'+(result.trackingSaved===false?'<p class="help">Bu cihazda saklama kapalı; takip bu sayfa açıkken kullanılabilir.</p>':''));
}
function paymentNoticesHTML(){
 const row=n=>'<article class="change-item"><div class="toolbar"><div><h3>'+esc(unitName(n.unit_id))+' · '+money(n.amount)+'</h3><span class="badge">'+esc(noticeStatus(n.status))+'</span></div><button class="outline small" data-action="notice-detail" data-notice-id="'+esc(n.id)+'">İncele</button></div><p>'+dateName(n.date)+' · Bildirim '+esc(n.id.slice(0,8))+'</p><small>'+esc(timeName(n.created_at))+'</small></article>';
 const waiting=waitingNotices(paymentNotices),done=paymentNotices.filter(n=>!['pending','uploading'].includes(n.status));
 return '<section class="panel"><div class="toolbar"><h2>Ödeme bildirimleri</h2><button class="outline" data-action="refresh-notices">Yenile</button></div><p class="help">Bildirim bir komşu beyanıdır. Bankaya gelen tutarı, daireyi ve daha önce tahsilat kaydı açılmadığını kontrol edin.</p>'+(paymentNoticeError?'<p role="alert">'+esc(paymentNoticeError)+'</p>':'')+'<h3>Onay bekleyenler · '+waiting.length+'</h3>'+(waiting.map(row).join('')||'<p class="empty">Bekleyen bildirim yok.</p>')+'<details class="secondary-section"><summary>Sonuçlanan bildirimler · '+done.length+'</summary>'+done.map(row).join('')+'</details></section>';
}
function showNoticeDetail(id){
 if(!state.admin)throw new Error('Yönetici girişi gerekli.');
 const n=paymentNotices.find(n=>n.id===id);if(!n)throw new Error('Bildirim bulunamadı. Listeyi yenileyin.');
 openReadDialog(unitName(n.unit_id)+' · Ödeme bildirimi','<p><strong>'+money(n.amount)+'</strong> · '+dateName(n.date)+'</p><p><span class="badge">'+esc(noticeStatus(n.status))+'</span> · '+esc(n.id.slice(0,8))+'</p>'+(n.note?'<p class="notice-note">'+esc(n.note)+'</p>':'')+(n.uploaded?'<button class="outline" data-action="notice-receipt" data-notice-id="'+esc(n.id)+'">Dekontu aç</button>':n.path?'<p class="help">Dekont yüklemesi tamamlanmamış.</p>':'<p class="help">Dekont eklenmemiş.</p>')+(n.review_note?'<p>Yönetici notu: '+esc(n.review_note)+'</p>':'')+'<div class="actions">'+(n.status==='pending'?'<button class="primary" data-action="approve-notice" data-notice-id="'+esc(n.id)+'">Kontrol et / Onayla</button>':'')+(['pending','uploading'].includes(n.status)?'<button class="danger" data-action="reject-notice" data-notice-id="'+esc(n.id)+'">Reddet</button>':'')+(n.batch_id?'<button class="outline" data-action="notice-payment-group" data-notice-id="'+esc(n.id)+'">Tahsilat / Makbuzlar</button>':'')+'</div>');
}
function reviewNotice(id,approve){
 if(!state.admin)throw new Error('Yönetici girişi gerekli.');
 const n=paymentNotices.find(n=>n.id===id);if(!n)throw new Error('Bildirim bulunamadı. Listeyi yenileyin.');
 const plan=approve?unitPaymentPlan(state.charges,n.unit_id,n.amount/100):null;
 openDialog(approve?'Ödeme bildirimini onayla':'Ödeme bildirimini reddet','<p><strong>'+esc(unitName(n.unit_id))+'</strong> · '+money(n.amount)+' · '+dateName(n.date)+'</p>'+(approve?unitPaymentPreview(plan)+'<label class="check"><input type="checkbox" name="confirmed" required> Banka hesabına gelen ödemeyi kontrol ettim; bu ödeme daha önce kaydedilmedi.</label>':'<p>Bildirim reddedilecek. Kasa ve borç değişmeyecek.</p>')+input('note','Komşuya açıklama (isteğe bağlı)','text','','maxlength="200"')+'<p class="help">Bildirim sahibi bu açıklamayı görebilir.</p>',async f=>{
  const result=await api('payment-notices/review','POST',{id,operation:approve?'approve':'reject',confirmed:f.get('confirmed')==='on',expected:plan?.expected,note:f.get('note')||''});
  if(approve){createdPaymentGroup=result.group;createdPaymentId=null;}
  toast(approve?'Bildirim onaylandı; tahsilat kaydedildi.':'Bildirim reddedildi.');
 },approve?'Onayla ve tahsilata işle':'Bildirimi reddet');
}

function unitPaymentPreview(plan){
 return table(['Ay','Ödenecek','Ayda kalan'],plan.allocations.map(a=>'<tr><td>'+esc(monthName(a.period))+'</td><td>'+money(a.amount)+'</td><td>'+money(a.remaining)+'</td></tr>'))+'<p>Ödeme sonrası toplam borç: <strong>'+money(plan.remaining)+'</strong></p>';
}
function updateUnitPaymentPreview(){
 if(!unitPaymentContext)return;
 try{const plan=unitPaymentPlan(unitPaymentContext.charges,unitPaymentContext.unitId,Number($('#f-amount').value));$('#unitPaymentPreview').innerHTML=unitPaymentPreview(plan);$('#dialogSubmit').disabled=false;}
 catch(err){$('#unitPaymentPreview').textContent=err.message;$('#dialogSubmit').disabled=true;}
}
function openUnitPayment(unitId){
 if(!state.admin)throw new Error('Yönetici girişi gerekli.');
 const charges=state.charges.filter(c=>c.unit_id===unitId).map(c=>({...c})),plan=unitPaymentPlan(charges,unitId),requestId=crypto.randomUUID();
 openDialog(unitName(unitId)+' · Toplam ödeme al','<p>Toplam kalan borç: <strong>'+money(plan.total)+'</strong></p>'+input('amount','Ödenen toplam tutar (TL)','number',plan.amount/100,'required min="0.01" step="0.01" max="'+Math.min(plan.total/100,10000000)+'"')+'<p class="help">En eski borçtan başlayarak dağıtılır.</p><div id="unitPaymentPreview">'+unitPaymentPreview(plan)+'</div>'+input('date','Ödeme tarihi','date',today(),'required min="2000-01-01" max="2099-12-31"')+input('note','Not (yalnızca yönetici görür)','text','','maxlength="200"'),async f=>{
  const amount=Number(f.get('amount')),preview=unitPaymentPlan(charges,unitId,amount);
  const result=await api('payments/unit','POST',{unitId,requestId,amount,date:f.get('date'),note:f.get('note'),expected:preview.expected});
  createdPaymentGroup=result;createdPaymentId=null;toast(result.replayed?'Ödeme daha önce kaydedilmiş; kayıtlar açılıyor.':'Ödeme aylara dağıtılarak kaydedildi.');
 },'Ödemeyi kaydet');
 unitPaymentContext={charges,unitId};$('#dialogSubmit').disabled=false;
}
function showPaymentGroup(group){
 const unchanged=group.allocations.every(a=>state.payments.some(p=>p.id===a.paymentId&&p.amount===a.amount&&p.charge_id===a.chargeId&&p.date===group.date));
 const remaining=state.charges.filter(c=>c.unit_id===group.unitId).reduce((sum,c)=>sum+c.amount-c.paid,0);
 openReadDialog(unitName(group.unitId)+' · Ödeme dağılımı','<p>'+dateName(group.date)+' · Toplam <strong>'+money(group.amount)+'</strong></p>'+(!unchanged?'<p class="note">Bu ödemenin bir kısmı sonradan değişmiş. Güncel ödeme kayıtlarını kontrol edin.</p>':'')+table(['Ay','Ödeme','Makbuz'],group.allocations.map(a=>'<tr><td>'+esc(monthName(a.period))+'</td><td>'+money(a.amount)+'</td><td>'+(state.payments.some(p=>p.id===a.paymentId)?'<button type="button" class="outline small" data-action="receipt" data-id="'+a.paymentId+'">Makbuz</button>':'İptal edilmiş')+'</td></tr>'))+'<p>Güncel toplam borç: <strong>'+money(remaining)+'</strong></p>'+(unchanged?'<button type="button" class="outline" data-action="undo-payment-batch" data-batch-id="'+esc(group.batchId)+'">Tüm ödemeyi geri al</button>':''));
}
async function confirmBatchUndo(id){
 if(!state.admin)throw new Error('Yönetici girişi gerekli.');
 const group=await api('payments/batch','POST',{id});
 if(!group.canUndo)throw new Error('Bu ödemenin bir kısmı iptal edilmiş veya geri alınmış. İşlem geçmişinden kayıtları kontrol edin.');
 openDialog('Toplam ödemeyi geri al','<p><strong>'+esc(unitName(group.unitId))+'</strong> · '+dateName(group.date)+'</p>'+table(['Ay','Geri alınacak'],group.allocations.map(a=>'<tr><td>'+esc(monthName(a.period))+'</td><td>'+money(a.amount)+'</td></tr>'))+'<div class="note"><p>Kasa değişimi: <strong>'+signedMoney(-group.amount)+'</strong></p><p>Aidat borcu değişimi: <strong>'+signedMoney(group.amount)+'</strong></p></div><p>Bu ödemeye ait bütün aylar birlikte geri alınsın mı?</p>',async()=>{await api('payments/batch/undo','POST',{id});toast('Toplam ödeme geri alındı.');},'Tüm ödemeyi geri al');$('#dialogSubmit').disabled=false;
}
async function loadOwnNotices(){
 const load=++ownNoticeLoad,id=unitPreference.get(state.units),entries=noticeBook.entries(id);
 ownNotices=[];ownNoticeError='';if(!entries.length)return;
 try{const rows=await api('payment-notices/track','POST',entries.map(({id,token})=>({id,token})));if(load===ownNoticeLoad)ownNotices=rows.filter(n=>n.unit_id===id);}
 catch{if(load===ownNoticeLoad)ownNoticeError='Bildirim durumları alınamadı. Bağlantınızı kontrol edip yenileyin.';}
}
function ownNoticesHTML(id){
 const rows=ownNotices.filter(n=>n.unit_id===id);
 return '<section class="panel"><div class="toolbar"><h3>Ödeme bildirimlerim</h3><button class="outline small" data-action="refresh-own-notices">Durumları yenile</button></div><p class="help">Bu cihazdan gönderdiğiniz bildirimleri burada takip edebilirsiniz.</p>'+(ownNoticeError?'<p role="alert">'+esc(ownNoticeError)+'</p>':rows.map(n=>'<article class="notice"><div class="toolbar"><strong>'+money(n.amount)+' · '+dateName(n.date)+'</strong><span class="badge">'+esc(ownNoticeStatus(n.status))+'</span></div><small>Bildirim '+esc(n.id.slice(0,8))+'</small>'+(n.review_note?'<p>Yönetici açıklaması: '+esc(n.review_note)+'</p>':'')+(n.status==='approved'?(n.payments.some(p=>!p.active)?'<p class="help">Bu tahsilatın bir kısmı veya tamamı sonradan geri alınmış. Güncel borcunuzu kontrol edin.</p>':'')+'<div class="actions">'+n.payments.filter(p=>p.active).map(p=>'<button class="outline small" data-action="receipt" data-id="'+p.id+'">'+esc(monthName(p.period))+' · Makbuz</button>').join('')+'</div>':'')+'</article>').join('')||'<p class="empty">Bu daireye ait takip edilebilir bildirim yok.</p>')+'</section>';
}
function myUnitHTML(){
 const id=unitPreference.get(state.units),unit=state.units.find(u=>u.id===id);
 if(!unit||unitChooser)return '<section class="panel"><h2>Dairem</h2><p class="muted">Dairenizi seçin; borcunuzu ve ödemelerinizi tek ekranda görün.</p><form id="myUnitForm" class="setting-form"><label for="myUnitId">Daireniz / dükkânınız</label><select id="myUnitId" name="unitId" required><option value="">Seçin</option>'+state.units.map(u=>'<option value="'+u.id+'"'+(u.id===id?' selected':'')+'>'+esc(u.label)+'</option>').join('')+'</select><p class="help">Seçiminiz bu cihazda hatırlanır.</p><div class="actions"><button type="submit" class="primary">Dairemi göster</button>'+(unit?'<button type="button" class="outline" data-action="cancel-unit-choice">Vazgeç</button>':'')+'</div></form></section>';
 const month=today().slice(0,7),charges=state.charges.filter(c=>c.unit_id===id),unpaid=charges.filter(c=>c.amount>c.paid).sort((a,b)=>b.period.localeCompare(a.period)||b.id-a.id);
 const remaining=rows=>rows.reduce((sum,c)=>sum+c.amount-c.paid,0),total=remaining(charges),old=remaining(charges.filter(c=>c.period<month)),current=remaining(charges.filter(c=>c.period===month)),future=remaining(charges.filter(c=>c.period>month));
 const payments=unitStatement(state,id).rows.filter(r=>r.type==='payment').reverse();
 return '<div class="toolbar"><div><h2>Dairem · '+esc(unit.label)+'</h2>'+(unit.exempt?'<span class="badge">Yönetim kararı ile muaf</span>':'')+'</div><button class="outline small" data-action="choose-unit">Daireyi değiştir</button></div><div class="cards my-unit-cards">'+[['Toplam kalan borç',total],['Bu ay kalan',current],['Önceki aylardan kalan',old],...(future?[['Gelecek aylara ait',future]]:[])].map(([title,value])=>'<div class="card"><div class="label">'+title+'</div><div class="number">'+money(value)+'</div></div>').join('')+'</div><div class="overview-actions">'+noticeEntryButton(id)+'<button class="outline" data-action="unit-detail" data-id="'+id+'">Hesap dökümü</button></div>'+bankHTML()+ownNoticesHTML(id)+'<section class="panel"><h3>Bekleyen borçlar</h3>'+table(['Dönem','Kalan'],unpaid.map(c=>'<tr><td>'+esc(monthName(c.period))+(c.kind==='opening'?'<small class="ledger-period">Devir borcu</small>':'')+'</td><td>'+money(c.amount-c.paid)+'</td></tr>'),'Bekleyen borcunuz yok.')+'</section><section class="panel"><h3>Ödeme geçmişi</h3>'+table(['Tarih','Aidat ayı','Tutar',''],payments.map(p=>'<tr><td>'+dateName(p.date)+'</td><td>'+esc(monthName(p.period))+'</td><td>'+money(p.credit)+'</td><td><button class="outline small" data-action="receipt" data-id="'+p.id+'">Makbuz</button></td></tr>'),'Henüz kayıtlı ödemeniz yok.')+'</section>';
}
function moreLinks(){
 const links=items=>'<div class="more-grid">'+items.map(([target,title,help])=>'<button class="panel more-link" '+(['request-new','push-settings'].includes(target)?'data-action="'+target+'"':'data-tab="'+target+'"')+'><strong>'+title+'</strong><span>'+help+'</span></button>').join('')+'</div>';
 return '<section class="more-section"><h2>Bilgiler</h2>'+links([['push-settings','Bildirimler','Bu cihazın bildirimlerini yönet'],['request-new','Arıza / talep bildir','Yönetime bildirim gönder'],['report','Aylık bilanço','Tahsilat, harcama ve borçlar'],['notices','Duyurular','Apartmandan haberler'],['decisions','Kararlar','Alınan kararlar ve belgeler'],['tasks','Yapılacak işler','Sorumlular ve durumlar']])+'<button class="outline install-menu" data-action="install-app">Telefona ekle</button></section>'+(state.admin?'<section class="more-section"><h2>Yönetici işlemleri</h2>'+links([['requests','Arıza ve talepler','Durumlar ve görev oluşturma'],['payment-notices','Ödeme bildirimleri','Onay bekleyen ödemeler'],['history','İşlem geçmişi','Ödeme ve gider işlemlerini geri al'],['units','Daireler ve dükkân','Bilgiler ve muafiyet'],['settings','Yönetim','IBAN, ayarlar ve yedek']])+'<button class="outline install-menu" data-action="opening-charge">Eski borç girişi</button></section>':'');
}
function pendingUnits(){return state.units.map(u=>({u,total:state.charges.filter(c=>c.unit_id===u.id).reduce((sum,c)=>sum+c.amount-c.paid,0)})).filter(x=>x.total>0).sort((a,b)=>b.total-a.total||a.u.id-b.u.id);}
function pendingRows(rows){return rows.map(({u,total})=>'<button class="pending-row" data-action="unit-detail" data-id="'+u.id+'"><strong>'+esc(u.label)+'</strong><span>'+money(total)+' <span aria-hidden="true">›</span></span></button>').join('');}
function overviewHTML(){
 const charges=state.charges.filter(c=>c.period===selectedMonth),expected=charges.reduce((sum,c)=>sum+c.amount,0),paid=charges.reduce((sum,c)=>sum+c.paid,0),paidCount=charges.filter(c=>c.paid>=c.amount).length;
 const pending=pendingUnits(),tasks=openTasks(state.tasks||[],today());
 return '<div class="toolbar overview-toolbar"><h2>Apartman özeti</h2>'+monthFilter()+'</div>'+cards()+'<div class="overview-actions">'+(state.admin?'<button class="primary" data-tab="dues">Ödeme al</button><button class="outline" data-action="expense">Gider ekle</button>':'')+'<button class="outline" data-tab="report">Aylık bilanço</button>'+(!state.admin?noticeEntryButton()+requestEntry():'')+'</div>'+noticeQueueCard()+requestQueueCard()+'<section class="panel dues-summary"><div class="toolbar"><h3>Bu ayın aidatları</h3><span class="muted">'+paidCount+' / '+charges.length+' bölüm ödedi</span></div><progress max="'+(expected||1)+'" value="'+paid+'" aria-label="Aidat tahsilat oranı"></progress><div class="dues-summary-values"><span>Beklenen <strong>'+money(expected)+'</strong></span><span>Kalan <strong>'+money(expected-paid)+'</strong></span></div>'+(!charges.length?'<p class="help">Bu ay aidat oluşturulmamış.</p>':'')+'</section><div class="overview-columns"><section class="panel"><div class="toolbar"><h2>Ödeme bekleyenler</h2>'+(pending.length>3?'<button class="small outline" data-action="show-pending">Tümü ('+pending.length+')</button>':'')+'</div>'+pendingRows(pending.slice(0,3))+(pending.length?'':'<p class="muted">Bekleyen aidat borcu yok.</p>')+'</section><section class="panel compact-news"><div class="toolbar"><h2>Apartmandan haberler</h2><button class="small outline" data-tab="news">Tümü</button></div>'+newsHTML(1,true)+'</section></div>'+(tasks.length?'<section class="panel summary-tasks"><div class="toolbar"><h2>Yapılacak işler</h2><button class="small outline" data-tab="tasks">Tümü ('+tasks.length+')</button></div>'+tasks.slice(0,3).map(taskRow).join('')+'</section>':'');
}
function render(){
 document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===tab||(e.dataset.tab==='more'&&['units','settings','notices','report','decisions','tasks','news','history','payment-notices','requests'].includes(tab))));
 const view=$('#view'),charges=state.charges.filter(c=>c.period===selectedMonth),expenses=state.expenses.filter(e=>e.date.startsWith(selectedMonth));
 if(tab==='my-unit'){view.innerHTML=myUnitHTML();
 }else if(tab==='requests'&&state.admin){view.innerHTML=residentRequestsHTML();
 }else if(tab==='overview'){
  view.innerHTML=overviewHTML();
 }else if(tab==='dues'){
  const visible=visibleUnits();
  const eligible=visibleUnpaidCharges();
  for(const id of selectedCharges)if(!eligible.some(c=>c.id===id))selectedCharges.delete(id);
  const unitsHTML=visible.map(u=>{
   const c=charges.find(c=>c.unit_id===u.id),remaining=c?c.amount-c.paid:0,old=earlierDebt(u.id);
   const badge=!c?(u.exempt?'Yönetim kararı ile muaf':'Aidat oluşturulmadı'):remaining===0?'Ödendi':c.paid?'Kısmi ödeme':'Bekliyor';
   const selection=state.admin&&bulkMode?'<label class="select-charge"><input type="checkbox" data-charge-select="'+(c?.id||'')+'" aria-label="'+esc(u.label)+' aidatını seç" '+(!c||c.paid>0?'disabled':'')+(c&&selectedCharges.has(c.id)?' checked':'')+'> Seç</label>':'';
   return '<article class="dues-card">'+selection+'<div class="dues-main"><div><h3>'+esc(u.label)+'</h3>'+(c?.kind==='opening'?'<small class="ledger-period">Devir borcu</small>':'')+'<span class="badge '+(remaining?(c.paid?'partial':'due'):'')+'">'+badge+'</span></div><div class="dues-balance"><small>Bu ay kalan</small><strong>'+(c?money(remaining):'—')+'</strong></div></div>'+(old?'<p class="old-debt">Önceki aylardan: <strong>'+money(old)+'</strong></p>':'')+'<div class="dues-actions"><button class="outline small" data-action="unit-detail" data-id="'+u.id+'">Ayrıntılar</button>'+(state.admin&&state.charges.some(c=>c.unit_id===u.id&&c.amount>c.paid)?'<button class="outline small" data-action="reminder" data-id="'+u.id+'">Hatırlatma hazırla</button>':'')+(state.admin&&state.charges.some(c=>c.unit_id===u.id&&c.amount>c.paid)?'<button class="primary" data-action="pay-unit" data-id="'+u.id+'">Ödeme al</button>':'')+(state.admin&&c?chargeMenu(c):'')+'</div></article>';
  }).join('');
  view.innerHTML=bankHTML()+(!state.admin?'<section class="panel notice-queue"><p>Ödemenizi yönetime bildirin.</p>'+noticeEntryButton()+'</section>':'')+'<section class="panel"><div class="toolbar"><h2>Aidatlar</h2>'+monthFilter()+'</div><div class="toolbar"><p class="muted">'+charges.filter(c=>c.paid>=c.amount).length+' / '+charges.length+' bölüm ödedi · Kalan '+money(charges.reduce((sum,c)=>sum+c.amount-c.paid,0))+'</p>'+(state.admin?'<div class="actions"><button class="primary" data-action="charge">Aylık aidat oluştur</button><button class="outline" data-action="toggle-bulk" aria-pressed="'+bulkMode+'">'+(bulkMode?'Toplu işlemi kapat':'Toplu işlem')+'</button></div>':'')+'</div>'+(state.admin&&bulkMode?'<div class="bulk-tools"><label class="check"><input type="checkbox" id="selectAllCharges" aria-label="Görünen ödeme girilmemiş aidatları seç"> Görünenleri seç</label><div class="actions"><button class="outline" data-action="edit-selected-charges" disabled>Toplu düzenle</button><button class="danger" data-action="remove-selected-charges" disabled>Toplu sil</button></div><p class="help" id="selectionSummary"></p><p class="help">Yalnızca ödeme girilmemiş aidatlar seçilebilir.</p></div>':'')+duesFiltersHTML(visible.length)+'<div class="dues-grid">'+(unitsHTML||'<div class="empty">Aramaya uygun bölüm bulunamadı.</div>')+'</div><details class="secondary-section"><summary>Dışa aktar</summary><button class="outline small" data-action="csv">CSV indir</button></details></section>'+(state.admin?'<details class="panel history"><summary>Ödeme kayıtları · '+esc(monthName(selectedMonth))+'</summary><p class="help">Yanlış kaydedilmiş ödemeleri buradan iptal edebilirsiniz. İptal edilen tutar yeniden borca eklenir.</p>'+table(['Bölüm','Ödeme tarihi','Tutar','Not','İşlem'],state.payments.filter(p=>charges.some(c=>c.id===p.charge_id)).map(p=>'<tr><td>'+esc(unitName(charges.find(c=>c.id===p.charge_id).unit_id))+'</td><td>'+dateName(p.date)+'</td><td>'+money(p.amount)+'</td><td class="expense-name">'+esc(p.note)+'</td><td><button class="small outline" data-action="receipt" data-id="'+p.id+'">Makbuz</button> <button class="small danger" data-action="delete-payment" data-id="'+p.id+'">Ödemeyi iptal et</button></td></tr>'))+'</details>':'');
 }else if(tab==='expenses'){
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Ortak giderler</h2><div class="actions">'+monthFilter()+(state.admin?'<button class="primary" data-action="expense">Gider ekle</button>':'')+'</div></div><p class="muted">'+esc(monthName(selectedMonth))+' toplamı: <strong>'+money(expenses.reduce((s,e)=>s+e.amount,0))+'</strong></p>'+table(['Tarih','Kategori','Açıklama','Tutar','Belge',...(state.admin?['İşlem']:[])],expenses.map(e=>'<tr><td>'+dateName(e.date)+'</td><td><span class="badge">'+esc(e.category)+'</span></td><td class="expense-name">'+esc(e.description)+'</td><td>'+money(e.amount)+'</td><td>'+(state.admin||(e.files||[]).length?'<button class="small outline" data-action="expense-files" data-id="'+e.id+'">Belgeler'+((e.files||[]).length?' ('+e.files.length+')':'')+'</button>':'—')+'</td>'+(state.admin?'<td><button class="small outline" data-action="edit-expense" data-id="'+e.id+'">Düzenle</button> <button class="small danger" data-action="delete-expense" data-id="'+e.id+'">Sil</button></td>':'')+'</tr>'))+'</section>';
 }else if(tab==='news'){
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Apartmandan haberler</h2></div>'+newsHTML()+'</section>';
 }else if(tab==='decisions'||tab==='tasks'){
  view.innerHTML=workHTML();
 }else if(tab==='report'){
  view.innerHTML=reportHTML();
 }else if(tab==='more'){
  view.innerHTML=moreLinks()+(requestAccess?'<button class="outline install-menu" data-action="request-track">Talebimi takip et</button>':'');
 }else if(tab==='notices'){
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Duyuru panosu</h2>'+(state.admin?'<button class="primary" data-action="notice">Duyuru ekle</button>':'')+'</div>'+(state.notices.map(noticeHTML).join('')||'<div class="empty">İlk duyuru burada görünecek.</div>')+'</section>';
 }else if(tab==='units'&&state.admin){
  view.innerHTML='<div class="note">“Aidattan muaf tut” açık olan bölümlere yeni aylık aidat yazılmaz. Önceki borçlar ve ödemeler korunur.</div><div class="unit-grid">'+state.units.map(u=>'<article class="unit-card"><div class="unit-top"><h3>'+esc(u.label)+'</h3>'+(u.exempt?'<span class="badge">Yönetim kararı ile muaf</span>':'')+'</div><p>Malik: '+esc(u.owner||'Belirtilmedi')+'<br>Oturan: '+esc(u.resident||'Belirtilmedi')+'</p><p>Toplam alacak: <strong>'+money(state.charges.filter(c=>c.unit_id===u.id).reduce((s,c)=>s+c.amount-c.paid,0))+'</strong></p><button class="outline small" data-action="unit" data-id="'+u.id+'">Düzenle / Muafiyet</button></article>').join('')+'</div>';
 }else if(tab==='payment-notices'&&state.admin){
  view.innerHTML=paymentNoticesHTML();
 }else if(tab==='history'&&state.admin){
  view.innerHTML=historyHTML();
 }else if(tab==='settings'&&state.admin){
  view.innerHTML='<section class="panel"><h2>Yönetim ayarları</h2><form id="settingsForm" class="setting-form"><label for="name">Apartman adı</label><input id="name" name="name" required maxlength="100" value="'+esc(state.settings.name)+'"><div class="form-grid"><div><label for="monthlyDues">Güncel aylık aidat (TL)</label><input id="monthlyDues" name="monthlyDues" type="number" min="0.01" step="0.01" required value="'+Number(state.settings.monthlyDues)/100+'"></div><div><label for="openingBalance">Açılış kasa bakiyesi (TL)</label><input id="openingBalance" name="openingBalance" type="number" min="0" step="0.01" required value="'+Number(state.settings.openingBalance)/100+'"></div></div><p class="help">Aidat tutarını değiştirmek önceki borçları değiştirmez. Ay için “Aylık aidat oluştur” işlemini ayrıca uygulayın. Açılış bakiyesi sistem öncesinden devreden tutardır.</p><button class="primary" type="submit">Ayarları kaydet</button></form></section><section class="panel history"><div class="toolbar"><h2>Kayıtlar ve yedek</h2><div class="actions"><button class="primary" data-tab="history">İşlem geçmişi / Geri al</button><button class="outline" data-action="backup">JSON kayıt yedeği indir</button><button class="outline" data-action="print">Yazdır</button></div></div><p class="help">Yedek, kayıtları ve belge listesini içerir; yüklenen dosyalar ayrıca saklanır. Malik/oturan bilgileri de bulunduğu için güvenli yerde saklayın. İşlem geçmişi son 100 değişikliği gösterir.</p>'+table(['Tarih','İşlem'],state.audit.map(a=>'<tr><td>'+esc(a.created_at)+' UTC</td><td>'+esc(a.action)+'</td></tr>'))+'</section>';
 }
 if(tab==='settings'&&state.admin)view.innerHTML=bankForm()+view.innerHTML;

 syncChargeSelection();
}
const input=(name,label,type='text',value='',extra='')=>'<label for="f-'+name+'">'+label+'</label><input id="f-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>';
function openDialog(title,fields,action,submit='Kaydet'){
 chargeDialogContext=null;reportContext=null;unitPaymentContext=null;
 $('#dialogSubmit').hidden=false;$('#dialogSubmit').disabled=false;
 $('#dialogTitle').textContent=title;$('#dialogFields').innerHTML=fields;$('#dialogError').textContent='';$('#dialogSubmit').textContent=submit;dialogAction=action;$('#modal').showModal();
}
function openReadDialog(title,fields){
 openDialog(title,fields,null);$('#dialogSubmit').hidden=true;
}
function shareButtons(){return '<div class="actions report-actions"><button type="button" class="outline small" data-action="copy-report">Metni kopyala</button><button type="button" class="outline small" data-action="download-report">Metin olarak indir</button></div>';}
function downloadText(text,name){
 const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function reportHTML(){
 reportContext={kind:'month'};
 const r=monthReport(state,selectedMonth);
 const summary=[['Devreden kasa',r.opening],['Tahsilat',r.income],['Harcamalar',r.spent],['Gelir − gider',r.net],['Ay sonu kasa',r.closing],['Kalan alacak',r.receivable]];
 return '<section class="panel monthly-balance"><div class="toolbar"><div><p class="eyebrow">'+esc(state.settings.name)+'</p><h2>Aylık bilanço</h2></div>'+monthFilter()+'</div><div class="actions report-actions"><button class="primary" data-action="copy-month-summary">Özeti kopyala</button><button class="outline" data-action="print-balance">Yazdır / PDF kaydet</button><button class="outline" data-action="copy-report">Metni kopyala</button><button class="outline" data-action="download-report">Metin indir</button></div><div class="balance-cards">'+summary.map(([label,value])=>'<div><span>'+label+'</span><strong>'+money(value)+'</strong></div>').join('')+'</div><h3 class="section-title">Tahsilatlar</h3>'+table(['Ödeme tarihi','Bölüm','Aidat dönemi','Tutar'],r.collections.map(p=>'<tr><td>'+dateName(p.date)+'</td><td>'+esc(p.unit)+'</td><td>'+(p.period?esc(monthName(p.period)):'—')+'</td><td>'+money(p.amount)+'</td></tr>'),'Bu ay tahsilat yok.')+'<h3 class="section-title">Harcama özeti</h3>'+(r.categories.map(c=>'<div class="bar-row"><span>'+esc(c.category)+'</span><strong>'+money(c.amount)+'</strong></div>').join('')||'<p class="muted">Bu ay harcama yok.</p>')+'<h3 class="section-title">Harcamalar</h3>'+table(['Tarih','Kategori','Açıklama','Tutar'],r.spending.map(e=>'<tr><td>'+dateName(e.date)+'</td><td>'+esc(e.category)+'</td><td class="expense-name">'+esc(e.description)+'</td><td>'+money(e.amount)+'</td></tr>'),'Bu ay harcama yok.')+'<h3 class="section-title">Aidat borcu kalan daireler</h3>'+table(['Bölüm','Durum','Bu ay kalan','Önceki borç','Toplam'],r.debtors.map(u=>'<tr><td>'+esc(u.label)+'</td><td>'+esc(u.status)+'</td><td>'+money(u.currentRemaining)+'</td><td>'+money(u.olderRemaining)+'</td><td><strong>'+money(u.total)+'</strong></td></tr>'),'Ay sonu itibarıyla bekleyen aidat borcu yok.')+'<p class="help">Tahsilatlar ödeme tarihine göredir. Borçlar seçilen ay sonuna kadar olan kayıtlarla hesaplanır; sonraki aylardaki ödemeler bu rapora dahil değildir.</p></section>';
}
function editExpense(expense){
 const editing=Boolean(expense),snapshot=expense?{...expense}:null;
 const fields='<label for="f-category">Kategori</label><select id="f-category" name="category">'+state.categories.map(c=>'<option '+(c===expense?.category?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+input('description','Açıklama','text',expense?.description||'','required maxlength="300"')+input('amount','Tutar (TL)','number',expense?expense.amount/100:'','required min="0.01" step="0.01" max="10000000"')+input('date','Gider tarihi','date',expense?.date||today(),'required min="2000-01-01" max="2099-12-31"');
 openDialog(editing?'Gideri düzenle':'Ortak gider ekle',fields,async f=>{
  const values={category:f.get('category'),description:f.get('description'),amount:Number(f.get('amount')),date:f.get('date')};
  if(editing)await api('expenses/manage','POST',expenseUpdate(snapshot,values));else await api('expenses','POST',values);
  selectedMonth=values.date.slice(0,7);toast(editing?'Gider güncellendi.':'Gider kaydedildi. Fiş veya faturayı Belgeler bölümünden ekleyebilirsiniz.');
 });
}
function showExpenseFiles(expenseId){showDocumentFiles('expense',expenseId);}
function showDocumentFiles(kind,id){
 const expense=(kind==='decision'?state.decisions:state.expenses).find(e=>e.id===id);if(!expense)throw new Error('Gider bulunamadı.');
 const files=expense.files||[];
 const items=files.map(file=>'<article class="receipt"><strong>'+esc(file.file_name)+'</strong><small>'+ (file.uploaded?(file.shared?'Ortak ekranda görünüyor':'Yalnızca yönetici'):'Yükleme tamamlanmadı')+' · '+(file.bytes/1024/1024).toLocaleString('tr-TR',{maximumFractionDigits:1})+' MB</small><div class="actions">'+(file.uploaded?'<button type="button" class="outline small" data-action="open-file" data-file-id="'+file.id+'">Görüntüle</button>':'')+(state.admin?(file.uploaded?'<button type="button" class="outline small" data-action="file-visibility" data-file-id="'+file.id+'">'+(file.shared?'Ortak ekrandan gizle':'Ortak ekranda göster')+'</button>':'')+'<button type="button" class="danger small" data-action="remove-file" data-file-id="'+file.id+'">Kaldır</button>':'')+'</div></article>').join('');
 const uploader=state.admin&&files.length<5?'<div class="receipt-upload"><label for="receiptInput">Belge seç</label><input id="receiptInput" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><p class="help">JPG, PNG, WEBP veya PDF · En fazla 10 MB. Yüklenen belgeyi önce yalnızca yönetici görür.</p><button type="button" class="primary" data-action="upload-file">Belgeyi yükle</button></div>':'';
 openReadDialog(kind==='decision'?'Karar belgeleri':'Gider belgeleri','<p>'+esc(expense.title||expense.description)+(kind==='expense'?' · <strong>'+money(expense.amount)+'</strong>':'')+'</p>'+(items||'<p class="empty">Henüz belge yok.</p>')+uploader);
 documentTarget={kind,id};
}
function currentFile(id){return [...state.expenses,...(state.decisions||[])].flatMap(e=>e.files||[]).find(f=>f.id===id);}
function taskRow(t){
 const late=t.status!=='done'&&t.due_date&&t.due_date<today();
 return '<button class="pending-row" data-action="task-detail" data-id="'+t.id+'"><span><strong>'+esc(t.title)+'</strong><small class="ledger-period">'+esc(t.assignee||'Sorumlu belirtilmedi')+' · '+esc(statusName(t.status))+'</small></span><span class="'+(late?'overdue':'')+'">'+(t.due_date?(late?'Gecikti · ':t.due_date===today()?'Bugün · ':'')+dateName(t.due_date):'Tarih yok')+' ›</span></button>';
}
function workHTML(){
 const decisions=tab==='decisions',kind=decisions?'decision':'task';
 const rows=decisions?(state.decisions||[]).filter(d=>d.archived===decisionArchive):(workFilter==='open'?openTasks(state.tasks||[],today()):(state.tasks||[]).filter(t=>workFilter==='archive'?t.archived:!t.archived&&(workFilter==='all'||t.status==='done')));
 const filter=decisions?'<label class="check"><input id="decisionArchive" type="checkbox" '+(decisionArchive?'checked':'')+'> Arşiv</label>':'<select id="workFilter" aria-label="İşleri filtrele">'+[['open','Bekleyen işler'],['done','Tamamlananlar'],['all','Tümü'],['archive','Arşiv']].map(([v,l])=>'<option value="'+v+'" '+(workFilter===v?'selected':'')+'>'+l+'</option>').join('')+'</select>';
 return '<section class="panel"><div class="toolbar"><h2>'+(decisions?'Kararlar':'Yapılacak işler')+'</h2><div class="actions">'+filter+(state.admin?'<button class="primary" data-action="'+kind+'">'+(decisions?'Karar ekle':'İş ekle')+'</button>':'')+'</div></div>'+(rows.map(row=>'<article class="work-item">'+(decisions?'<button class="pending-row" data-action="decision-detail" data-id="'+row.id+'"><strong>'+esc(row.title)+'</strong><span>'+dateName(row.date)+' ›</span></button>':taskRow(row))+(state.admin?'<div class="actions">'+(!decisions&&!row.archived?'<button class="small outline" data-action="complete-task" data-id="'+row.id+'">'+(row.status==='done'?'Yeniden aç':'Tamamlandı işaretle')+'</button>':'')+'<button class="small outline" data-action="edit-'+kind+'" data-id="'+row.id+'">Düzenle</button><button class="small outline" data-action="archive-'+kind+'" data-id="'+row.id+'">'+(row.archived?'Arşivden çıkar':'Arşivle')+'</button></div>':'')+'</article>').join('')||'<p class="empty">Bu listede henüz kayıt yok.</p>')+'</section>';
}
function editWork(kind,row){
 if(!state.admin)throw new Error('Yönetici girişi gerekli.');
 const decision=kind==='decision';
 const textArea=(name,label,value,max)=>'<label for="f-'+name+'">'+label+'</label><textarea id="f-'+name+'" name="'+name+'" rows="5" maxlength="'+max+'" '+(decision?'required':'')+'>'+esc(value)+'</textarea>';
 let fields=input('title','Başlık','text',row?.title||'','required maxlength="150"');
 if(decision)fields+=input('date','Karar tarihi','date',row?.date||today(),'required min="2000-01-01" max="2099-12-31"')+input('decisionNo','Karar numarası (isteğe bağlı)','text',row?.decision_no||'','maxlength="40"')+textArea('body','Karar metni',row?.body||'',4000);
 else fields+=input('assignee','Sorumlu kişi','text',row?.assignee||'','maxlength="100"')+input('dueDate','Hedef tarih (isteğe bağlı)','date',row?.due_date||'','min="2000-01-01" max="2099-12-31"')+'<label for="f-status">Durum</label><select id="f-status" name="status">'+['pending','in_progress','done'].map(v=>'<option value="'+v+'" '+(v===(row?.status||'pending')?'selected':'')+'>'+statusName(v)+'</option>').join('')+'</select><label for="f-decisionId">İlgili karar (isteğe bağlı)</label><select id="f-decisionId" name="decisionId"><option value="">Seçilmeyen</option>'+state.decisions.filter(d=>!d.archived||d.id===row?.decision_id).map(d=>'<option value="'+d.id+'" '+(d.id===row?.decision_id?'selected':'')+'>'+esc(d.title)+'</option>').join('')+'</select>'+textArea('notes','Açıklama',row?.notes||'',2000);
 openDialog((row?'Düzenle: ':'')+(decision?'Karar':'Yapılacak iş'),fields,async f=>{
  const payload={operation:'save',...(row?{id:row.id,version:row.version}:{}),title:f.get('title')};
  for(const name of decision?['date','decisionNo','body']:['assignee','dueDate','status','decisionId','notes'])payload[name]=f.get(name);
  await api(decision?'decisions/manage':'tasks/manage','POST',payload);tab=decision?'decisions':'tasks';toast('Kayıt kaydedildi.');
 });
}

function syncChargeSelection(){
 const eligible=visibleUnpaidCharges();
 const all=$('#selectAllCharges');if(!all)return;
 all.disabled=eligible.length===0;all.checked=eligible.length>0&&eligible.every(c=>selectedCharges.has(c.id));all.indeterminate=selectedCharges.size>0&&!all.checked;
 document.querySelectorAll('[data-charge-select]').forEach(e=>e.checked=selectedCharges.has(Number(e.dataset.chargeSelect)));
 for(const [action,label] of [['edit-selected-charges','Toplu düzenle'],['remove-selected-charges','Toplu sil']]){
  const b=document.querySelector('[data-action="'+action+'"]');if(b){b.disabled=!selectedCharges.size;b.textContent=label+(selectedCharges.size?' ('+selectedCharges.size+')':'');}
 }
 $('#selectionSummary').textContent=selectedCharges.size+' kayıt seçili · Toplam '+money(eligible.filter(c=>selectedCharges.has(c.id)).reduce((s,c)=>s+c.amount,0));
}
function updateChargePreview(){
 if(!chargeDialogContext||chargeDialogContext.mode!=='edit')return;
 const amount=Number($('#f-amount')?.value),period=$('#f-period')?.value;
 const preview=$('#chargePreview');if(preview)preview.textContent=chargeDialogContext.rows.length+' aidat · Yeni ay: '+(period?monthName(period):'—')+' · Yeni toplam: '+(Number.isFinite(amount)&&amount>=0.01?money(Math.round(amount*100)*chargeDialogContext.rows.length):'—');
}
function manageCharges(mode,ids){
 const rows=state.charges.filter(c=>ids.includes(c.id)).map(c=>({...c}));
 chargeRequest(rows,ids,mode,mode==='edit'?rows[0]?.amount/100:undefined,rows[0]?.period);
 const total=rows.reduce((sum,c)=>sum+c.amount,0);
 const summary='<div class="note">'+rows.length+' aidat · '+esc(monthName(rows[0].period))+' · Mevcut toplam: <strong>'+money(total)+'</strong></div><p class="help">'+rows.map(c=>esc(unitName(c.unit_id))).join(', ')+'</p>';
 const fields=mode==='edit'?input('period','Aidat ayı','month',rows[0].period,'required min="2000-01" max="2099-12"')+input('amount','Her bölüm için yeni aidat (TL)','number',rows[0].amount/100,'required min="0.01" max="10000000" step="0.01"')+'<p class="note" id="chargePreview"></p>':'<p>Seçilen aidatlar ve bunlara ait alacak tutarı silinecek. Ödeme kaydı bulunmadığı için kasa değişmeyecek.</p>'+input('confirmation','Onaylamak için SİL yazın','text','','required autocomplete="off" maxlength="3"');
 openDialog(mode==='edit'?'Aidatları düzenle':'Seçili aidatları sil',summary+fields,async f=>{
  if(mode==='delete'&&String(f.get('confirmation')).trim().toLocaleUpperCase('tr-TR')!=='SİL')throw new Error('Onaylamak için SİL yazın.');
  const payload=chargeRequest(rows,ids,mode,mode==='edit'?Number(f.get('amount')):undefined,f.get('period'));
  const r=await api('charges/manage','POST',payload);
  selectedCharges.clear();if(mode==='edit')selectedMonth=payload.period;
  toast(r.count+' aidat '+(mode==='edit'?'güncellendi.':'silindi.'));
 },mode==='edit'?'Değişiklikleri kaydet':'Seçili aidatları sil');
 chargeDialogContext={mode,rows};updateChargePreview();
}
document.addEventListener('input',e=>{if(e.target.id==='unitSearch'){updateUnitSearch(e);return;}if(['f-amount','f-period'].includes(e.target.id)){updateChargePreview();updateUnitPaymentPreview();}});
$('#dialogForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!dialogAction)return;const button=$('#dialogSubmit');button.disabled=true;
 try{
  await dialogAction(new FormData(e.target));$('#modal').close();
  const paymentId=createdPaymentId,group=createdPaymentGroup,notice=createdNoticeAcknowledgement,residentRequest=createdResidentRequest,readId=createdDecisionReadId;createdDecisionReadId=null;createdPaymentId=null;createdPaymentGroup=null;createdNoticeAcknowledgement=null;createdResidentRequest=null;
  try{await refresh();if(residentRequest)await showOwnRequest({id:residentRequest.id,token:residentRequest.token});else if(notice)showNoticeAcknowledgement(notice);else if(group)showPaymentGroup(group);else if(paymentId)showReceipt(paymentId);else if(readId)await showDecisionDetail(readId);else await followNotification();}
  catch(err){error(new Error('İşlem tamamlandı, ekran yenilenemedi. Tekrar kaydetmeden önce sayfayı yenileyin. '+err.message));}
 }catch(err){$('#dialogError').textContent=err.message;}finally{button.disabled=false;}
});
$('#closeModal').addEventListener('click',()=>{if(!uploadingDocument)$('#modal').close();});
$('#modal').addEventListener('cancel',e=>{if(uploadingDocument)e.preventDefault();});
function openAdminLogin(){
 openDialog('Yönetici girişi',input('email','Yönetici e-postası','email','','required autocomplete="username"')+input('password','Yönetici şifresi','password','','required autocomplete="current-password" maxlength="1024"')+'<p class="help">Bu cihazda oturumunuz açık kalır.</p>',async f=>{await api('login','POST',{email:f.get('email'),password:f.get('password')});toast('Yönetici paneli açıldı.');},'Giriş yap');
}
async function followNotification(){
 const id=adminRequestFromHash(location.hash);if(!id)return false;
 if(!state?.admin){openAdminLogin();toast('Arıza kaydını görmek için yönetici girişi yapın.');return false;}
 tab='requests';requestFilter='all';
 await refresh();
 if(!state.admin){openAdminLogin();return false;}
 if(requestError)throw new Error(requestError);
 if(residentRequests.some(row=>row.id===id))showRequestDetail(id);
 else openReadDialog('Arıza kaydı','<p>Bu kayıt artık listede bulunmuyor. Arıza ve talepler listesinden kontrol edebilirsiniz.</p>');
 history.replaceState(null,'',location.href.split('#')[0]);
 return true;
}
$('#auth').addEventListener('click',async()=>{
 if(state?.admin){try{await api('logout','POST',{});await refresh();toast('Yönetici oturumu kapatıldı.');}catch(e){error(e);}return;}
 openAdminLogin();
});
document.addEventListener('change',e=>{
 if(e.target.id==='duesFilter'){duesFilter=e.target.value;selectedCharges.clear();render();$('#duesFilter').focus();}
 else if(e.target.id==='requestFilter'){requestFilter=e.target.value;render();}
 else if(e.target.id==='workFilter'){workFilter=e.target.value;render();}
 else if(e.target.id==='decisionArchive'){decisionArchive=e.target.checked;render();}
 else if(e.target.id==='monthFilter'&&e.target.value){selectedMonth=e.target.value;selectedCharges.clear();render();}
 else if(e.target.matches('[data-charge-select]')){const id=Number(e.target.dataset.chargeSelect);if(e.target.checked)selectedCharges.add(id);else selectedCharges.delete(id);syncChargeSelection();}
 else if(e.target.id==='selectAllCharges'){selectedCharges.clear();if(e.target.checked)for(const c of visibleUnpaidCharges())selectedCharges.add(c.id);syncChargeSelection();}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='myUnitForm'){
  e.preventDefault();try{const saved=unitPreference.set(new FormData(e.target).get('unitId'),state.units);unitChooser=false;await refresh();toast(saved?'Daireniz seçildi.':'Daireniz seçildi. Bu cihazda kalıcı saklama kapalı.');}catch(err){error(err);}return;
 }
 if(e.target.id==='bankForm'){
  e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;$('#bankError').textContent='';
  try{const f=new FormData(e.target),iban=normalizeIban(f.get('iban')),accountHolder=String(f.get('accountHolder')||'').trim();if(iban&&!accountHolder)throw new Error('Hesap sahibini girin.');
   await api('bank','PUT',{iban,accountHolder,expected:{iban:state.settings.iban||'',accountHolder:state.settings.accountHolder||''}});await refresh();toast('Ödeme hesabı kaydedildi.');
  }catch(err){$('#bankError').textContent=err.message;}finally{button.disabled=false;}return;
 }
 if(e.target.id!=='settingsForm')return;e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
 try{const f=new FormData(e.target);await api('settings','PUT',{name:f.get('name'),monthlyDues:Number(f.get('monthlyDues')),openingBalance:Number(f.get('openingBalance'))});await refresh();toast('Ayarlar kaydedildi.');}catch(err){error(err);}finally{button.disabled=false;}
});
document.addEventListener('click',async e=>{
 const nav=e.target.closest('[data-tab]');if(nav){tab=nav.dataset.tab;if(tab==='my-unit'){try{await refresh();}catch(err){error(err);}}else if(tab==='history'){if(!state.admin)return;$('#view').innerHTML='<p class="empty">İşlem geçmişi yükleniyor…</p>';try{await refresh();}catch(err){error(err);}}else render();return;}
 const btn=e.target.closest('[data-action]');if(!btn)return;
 e.preventDefault();
 const action=btn.dataset.action,id=Number(btn.dataset.id);
 if(uploadingDocument)return;
 try{
 if(action==='previous-month'||action==='next-month'){
  const d=new Date(selectedMonth+'-15T12:00:00');d.setMonth(d.getMonth()+(action==='next-month'?1:-1));
  const next=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  if(next>='2000-01'&&next<='2099-12'){selectedMonth=next;selectedCharges.clear();render();}
 }
 else if(action==='install-app'){btn.disabled=true;try{await installApp();}finally{btn.disabled=false;}}
 else if(action==='clear-dues-filter'){unitQuery='';duesFilter='all';selectedCharges.clear();render();$('#unitSearch').focus();}
 else if(action==='toggle-bulk'){bulkMode=!bulkMode;selectedCharges.clear();render();}
 else if(action==='receipt'){await refresh();showReceipt(id);}
 else if(action==='download-receipt'){btn.disabled=true;try{const current=await api('state');await downloadReceipt(paymentReceipt(current,id),receiptLink(location.href,id));}catch(err){$('#dialogError').textContent=err.message;}finally{btn.disabled=false;}}
 else if(action==='copy-receipt-link'){await copyPaymentText(receiptLink(location.href,id),'Makbuz bağlantısı kopyalandı.');}
 else if(action==='own-notices'){unitPreference.set(id,state.units);unitChooser=false;tab='my-unit';await refresh();}
 else if(action==='refresh-own-notices'){await refresh();}
 else if(action==='choose-unit'){unitChooser=true;render();}
 else if(action==='cancel-unit-choice'){unitChooser=false;render();}
 else if(action==='copy-iban'){if(!state.settings.iban)throw new Error('IBAN henüz eklenmedi.');await copyPaymentText(state.settings.iban,'IBAN kopyalandı.');}
 else if(action==='reminder'){
  if(!state.admin)throw new Error('Yönetici girişi gerekli.');
  openReadDialog('Ödeme hatırlatması','<label for="reminderText">Paylaşılacak metin</label><textarea id="reminderText" rows="12" maxlength="12000">'+esc(reminderText(state,id,today()))+'</textarea><div class="actions report-actions"><button type="button" class="primary" data-action="copy-reminder">Metni kopyala</button></div><p class="help">Metni kontrol edip WhatsApp’a yapıştırabilirsiniz.</p>');
 }
 else if(action==='copy-reminder'){await copyPaymentText($('#reminderText').value,'Hatırlatma kopyalandı. WhatsApp’a yapıştırabilirsiniz.');}
 else if(action==='request-new'){openResidentRequest();}
 else if(action==='requests-refresh'){await refresh();}
 else if(action==='request-detail'){showRequestDetail(btn.dataset.requestId);}
 else if(action==='request-status'){editRequestStatus(btn.dataset.requestId);}
 else if(action==='request-task'){createRequestTask(btn.dataset.requestId);}
 else if(action==='request-track'){if(!requestAccess)throw new Error('Takip bağlantınızı açın.');await showOwnRequest(requestAccess);}
 else if(action==='push-settings'){await showPushSettings();}
 else if(action==='push-enable'){btn.disabled=true;try{await push.enable({admin:state.admin,access:requestAccess});await showPushSettings();toast('Bildirimler bu cihazda açıldı.');}finally{btn.disabled=false;}}
 else if(action==='push-disable'){btn.disabled=true;try{await push.disable();await showPushSettings();toast('Bildirimler bu cihazda kapatıldı.');}finally{btn.disabled=false;}}
 else if(action==='push-test'){btn.disabled=true;try{await push.test();toast('Deneme bildirimi sıraya alındı.');}finally{btn.disabled=false;}}
 else if(action==='request-copy-link'){if(requestAccess)await copyPaymentText(requestLink(location.href,requestAccess.id,requestAccess.token),'Takip bağlantısı kopyalandı.');}
 else if(action==='request-photo'){
  const r=requestRow(btn.dataset.requestId);if(!r.uploaded)throw new Error('Fotoğraf bulunamadı.');
  const result=await api('request-files/sign','POST',{path:r.path});
  openReadDialog('Talep fotoğrafı','<p>'+esc(r.file_name)+'</p><a class="primary" href="'+esc(result.url)+'" target="_blank" rel="noopener noreferrer">Fotoğrafı aç / İndir</a><p class="help">Bağlantı 60 saniye geçerlidir.</p>');
 }
 else if(action==='payment-notice'){openPaymentNotice(id);}
 else if(action==='refresh-notices'){await refresh();}
 else if(action==='notice-detail'){showNoticeDetail(btn.dataset.noticeId);}
 else if(action==='approve-notice'||action==='reject-notice'){reviewNotice(btn.dataset.noticeId,action==='approve-notice');}
 else if(action==='notice-receipt'){
  if(!state.admin)throw new Error('Yönetici girişi gerekli.');
  const n=paymentNotices.find(n=>n.id===btn.dataset.noticeId);if(!n?.uploaded)throw new Error('Dekont bulunamadı.');
  const result=await api('notice-files/sign','POST',{path:n.path});
  openReadDialog('Ödeme dekontu','<p>'+esc(n.file_name)+'</p><a class="primary" href="'+esc(result.url)+'" target="_blank" rel="noopener noreferrer">Dekontu aç / İndir</a><p class="help">Bağlantı 60 saniye geçerlidir.</p>');
 }
 else if(action==='notice-payment-group'){
  if(!state.admin)throw new Error('Yönetici girişi gerekli.');
  const n=paymentNotices.find(n=>n.id===btn.dataset.noticeId);if(!n?.batch_id)throw new Error('Tahsilat bulunamadı.');
  const group=await api('payments/batch','POST',{id:n.batch_id});showPaymentGroup(group);
 }
 else if(action==='pay-unit'){openUnitPayment(id);}
 else if(action==='undo-payment-batch'){await confirmBatchUndo(btn.dataset.batchId);}
 else if(action==='unit-detail'){
  const u=state.units.find(u=>u.id===id);if(!u)throw new Error('Bölüm bulunamadı.');
  const items=state.charges.filter(c=>c.unit_id===id).sort((a,b)=>b.period.localeCompare(a.period));
  const ledger=unitStatement(state,id);
  const rows=ledger.rows.map(row=>'<tr><td>'+dateName(row.date)+'</td><td>'+esc(row.label)+(row.type==='payment'?'<button type="button" class="outline small" data-action="receipt" data-id="'+row.id+'">Makbuz</button>':'')+'<small class="ledger-period">'+esc(monthName(row.period))+'</small>'+(row.note?'<small class="ledger-period">'+esc(row.note)+'</small>':'')+'</td><td>'+ (row.debit?money(row.debit):'—')+'</td><td>'+(row.credit?money(row.credit):'—')+'</td><td>'+money(row.balance)+'</td></tr>');
  openReadDialog(u.label+' · Hesap dökümü','<div class="statement-totals"><p>Borçlandırma <strong>'+money(ledger.debit)+'</strong></p><p>Ödemeler <strong>'+money(ledger.credit)+'</strong></p><p>Kalan borç <strong>'+money(ledger.balance)+'</strong></p></div>'+(u.exempt?'<p><span class="badge">Yönetim kararı ile muaf</span></p>':'')+shareButtons()+table(['Tarih','İşlem','Borç','Ödeme','Bakiye'],rows,'Henüz hesap hareketi yok.')+(state.admin?'<div class="statement-payments">'+(ledger.balance>0?'<button type="button" class="primary" data-action="pay-unit" data-id="'+id+'">Toplam borçtan ödeme al</button>':'')+items.filter(c=>c.amount>c.paid).map(c=>'<div class="bar-row"><span>'+esc(monthName(c.period))+' · '+money(c.amount-c.paid)+'</span><button type="button" class="primary small" data-action="pay" data-id="'+c.id+'">Ödeme al</button></div>').join('')+'<button type="button" class="outline" data-action="opening-charge" data-id="'+id+'">Eski borç ekle</button></div>':''));
  reportContext={kind:'unit',id};
 }
 else if(action==='opening-charge'){
  if(!state.admin)throw new Error('Yönetici girişi gerekli.');
  const previous=new Date(today()+'T12:00:00');previous.setDate(0);const maxDate=previous.getFullYear()+'-'+String(previous.getMonth()+1).padStart(2,'0')+'-'+String(previous.getDate()).padStart(2,'0');
  const fields='<label for="f-unitId">Daire / dükkân</label><select id="f-unitId" name="unitId" required>'+state.units.map(u=>'<option value="'+u.id+'" '+(u.id===id?'selected':'')+'>'+esc(u.label)+'</option>').join('')+'</select>'+input('date','Borcun ait olduğu tarih','date',maxDate,'required min="2000-01-01" max="'+maxDate+'"')+input('amount','Kalan borç (TL)','number','','required min="0.01" max="10000000" step="0.01"')+input('note','Açıklama (yalnızca yönetici görür)','text','','required minlength="3" maxlength="200"')+'<p class="help">Yalnızca henüz kaydedilmemiş borcu girin. Bu işlem kasaya para eklemez.</p><div class="check exemption"><input id="f-confirm" type="checkbox" required><label for="f-confirm">Daireyi, dönemi ve tutarı kontrol ettim.</label></div>';
  openDialog('Eski borç girişi',fields,async f=>{
   const unitId=Number(f.get('unitId')),date=f.get('date');
   if(state.charges.some(c=>c.unit_id===unitId&&c.period===date.slice(0,7)))throw new Error('Bu bölümün seçilen ayda borcu zaten var. Mevcut kaydı kontrol edin.');
   await api('charges/opening','POST',{unitId,date,amount:Number(f.get('amount')),note:f.get('note')});
   selectedMonth=date.slice(0,7);tab='dues';toast('Eski borç kaydedildi.');
  },'Borcu kaydet');
 }
 else if(action==='copy-month-summary'){await copyPaymentText(monthSummaryText(state,selectedMonth,location.href),'Özet kopyalandı. WhatsApp’a yapıştırabilirsiniz.');}
 else if(action==='copy-report'||action==='download-report'){
  const text=reportContext?.kind==='unit'?unitStatementText(state,reportContext.id):monthReportText(state,selectedMonth);
  if(action==='download-report')downloadText(text,reportContext?.kind==='unit'?'daire-'+reportContext.id+'-hesap-dokumu.txt':'apartman-'+selectedMonth+'-hesap-ozeti.txt');
  else{try{await navigator.clipboard.writeText(text);toast('Metin kopyalandı. WhatsApp’a yapıştırabilirsiniz.');}catch{openReadDialog('Paylaşılacak metin','<label for="reportText">Metni seçip kopyalayın</label><textarea id="reportText" readonly rows="12">'+esc(text)+'</textarea>');$('#reportText').focus();$('#reportText').select();}}
 }
 else if(action==='decision'||action==='task'){editWork(action);}
 else if(action==='edit-decision'||action==='edit-task'){const kind=action.slice(5);editWork(kind,(kind==='decision'?state.decisions:state.tasks).find(x=>x.id===id));}
 else if(action==='decision-detail'){await showDecisionDetail(id);}
 else if(action==='decision-read'){openDecisionRead(id);}
 else if(action==='decision-read-remove'){await removeDecisionRead(id,Number(btn.dataset.unitId));}
 else if(action==='decision-files'){showDocumentFiles('decision',id);}
 else if(action==='task-detail'){const t=state.tasks.find(x=>x.id===id);if(!t)throw new Error('İş bulunamadı.');const d=state.decisions.find(x=>x.id===t.decision_id);openReadDialog(t.title,'<p>'+esc(statusName(t.status))+' · '+esc(t.assignee||'Sorumlu belirtilmedi')+(t.due_date?' · '+dateName(t.due_date):'')+'</p><p class="work-body">'+esc(t.notes)+'</p>'+(d?'<button type="button" class="outline" data-action="decision-detail" data-id="'+d.id+'">İlgili karar: '+esc(d.title)+'</button>':''));}
 else if(action==='complete-task'){const t=state.tasks.find(x=>x.id===id);btn.disabled=true;await api('tasks/manage','POST',taskSave(t,{status:t.status==='done'?'pending':'done'}));await refresh();toast('İşin durumu güncellendi.');}
 else if(action==='archive-task'||action==='archive-decision'){const kind=action.slice(8),row=(kind==='task'?state.tasks:state.decisions).find(x=>x.id===id);btn.disabled=true;await api(kind==='task'?'tasks/manage':'decisions/manage','POST',{operation:'archive',id,version:row.version,archived:!row.archived});await refresh();toast(row.archived?'Kayıt arşivden çıkarıldı.':'Kayıt arşivlendi.');}
 else if(action==='show-pending'){openReadDialog('Ödeme bekleyenler','<p class="muted">Tüm dönemler · '+money(state.totals.receivable)+'</p>'+pendingRows(pendingUnits()));}
 else if(action==='show-notices'){tab='notices';render();}
 else if(action==='edit-charge'||action==='remove-charge')manageCharges(action==='edit-charge'?'edit':'delete',[id]);
 else if(action==='edit-selected-charges'||action==='remove-selected-charges')manageCharges(action==='edit-selected-charges'?'edit':'delete',[...selectedCharges]);
 else if(action==='undo-change'){
  if(!state.admin)throw new Error('Yönetici girişi gerekli.');const entry=changeHistory.find(x=>Number(x.id)===id);if(!entry)throw new Error('İşlem bulunamadı. Listeyi yenileyin.');
  const info=changeInfo(entry);if(!info.canUndo)throw new Error('Bu işlem geri alınamaz.');
  openDialog('İşlemi geri al',changeSummary(entry)+'<div class="note"><p>Kasa değişimi: <strong>'+signedMoney(info.cashChange)+'</strong></p>'+(entry.entity==='payment'?'<p>Aidat borcu değişimi: <strong>'+signedMoney(info.debtChange)+'</strong></p>':'')+'</div><p>Bu işlem geri alınsın mı?</p>',async()=>{await api('undo','POST',{id:entry.id});toast('İşlem geri alındı. Kasa ve borçlar güncellendi.');},'Geri al');
 }
 else if(action==='refresh-history'){await refresh();}
 else if(action==='print'||action==='print-balance')window.print();
 else if(action==='backup'){
  btn.disabled=true;
  const result=await api('backup');
  const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='apartman-yedek-'+today()+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);btn.disabled=false;
 }
 else if(action==='charge'){
 const eligible=state.units.filter(u=>!u.exempt),missing=eligible.filter(u=>!state.charges.some(c=>c.unit_id===u.id&&c.period===selectedMonth));
 openDialog('Aylık aidat oluştur',input('period','Aidat ayı','month',selectedMonth,'required min="2000-01" max="2099-12"')+input('amount','Her bölüm için tutar (TL)','number',Number(state.settings.monthlyDues)/100,'required min="0.01" max="10000000" step="0.01"')+'<p class="help">Seçili ayda '+missing.length+' bölümün kaydı eksik. Muaf bölümler atlanır. Daha önce oluşturulan kayıtlar korunur; ikinci kez borç yazılmaz.</p>',async f=>{const m=f.get('period');const r=await api('charges','POST',{period:m,amount:Number(f.get('amount'))});selectedMonth=m;toast(r.count+' bölüme aidat oluşturuldu.');},'Aidatları oluştur');
 }else if(action==='pay'){
 const c=state.charges.find(c=>c.id===id);
 openDialog(unitName(c.unit_id)+' · Ödeme al','<p class="help">'+esc(monthName(c.period))+' · Kalan: '+money(c.amount-c.paid)+'</p>'+input('amount','Ödenen tutar (TL)','number',(c.amount-c.paid)/100,'required min="0.01" step="0.01" max="'+(c.amount-c.paid)/100+'"')+'<details class="secondary-section"><summary>Tarih ve not ekle</summary>'+input('date','Ödeme tarihi','date',today(),'required')+input('note','Not / Makbuz bilgisi','text','','maxlength="200"')+'</details>',async f=>{const result=await api('payments','POST',{chargeId:id,amount:Number(f.get('amount')),date:f.get('date'),note:f.get('note')});createdPaymentId=Number(result.count);toast('Ödeme kaydedildi.');},'Ödemeyi kaydet');
 }else if(action==='expense'){
 editExpense();
 }else if(action==='edit-expense'){
 const expense=state.expenses.find(expense=>expense.id===id);if(!expense)throw new Error('Gider bulunamadı. Listeyi yenileyin.');editExpense(expense);
 }else if(action==='expense-files'){
 showExpenseFiles(id);
 }else if(action==='upload-file'){
 if(uploadingDocument)return;
 const target={...documentTarget},file=$('#receiptInput')?.files[0];
 uploadingDocument=true;$('#closeModal').disabled=true;btn.disabled=true;btn.textContent='Yükleniyor…';$('#dialogError').textContent='';
 try{await uploadReceipt(api,target.id,file,target.kind);await refresh();showDocumentFiles(target.kind,target.id);toast('Belge eklendi.');}
 catch(err){try{await refresh();showDocumentFiles(target.kind,target.id);}catch{}$('#dialogError').textContent=err.message;}
 finally{uploadingDocument=false;$('#closeModal').disabled=false;btn.disabled=false;btn.textContent='Belgeyi yükle';}
 }else if(['open-file','file-visibility','remove-file'].includes(action)){
 const file=currentFile(btn.dataset.fileId);if(!file)throw new Error('Belge bulunamadı. Listeyi yenileyin.');
 const target={...documentTarget};
 if(action==='open-file'){
  btn.disabled=true;
  try{
   const result=await api('files/sign','POST',{path:file.path});
   const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Belgeyi aç';link.className='outline';
   if(btn.nextElementSibling?.matches('a'))btn.nextElementSibling.remove();btn.after(link);btn.textContent='Bağlantıyı yenile';link.click();
  }finally{btn.disabled=false;}
 }else{
  if(action==='remove-file'&&!confirm('Bu belge kaldırılsın mı?'))return;
  if(action==='file-visibility'&&!file.shared&&!confirm('Bu belge ortak ekranda herkese açılacak. Kişisel bilgileri kontrol ettiniz mi?'))return;
  btn.disabled=true;
  try{
   if(action==='remove-file')await removeReceipt(api,file);
   else await api('expenses/manage','POST',{operation:'visibility',fileId:file.id,shared:!file.shared});
   await refresh();showDocumentFiles(target.kind,target.id);toast(action==='remove-file'?'Belge kaldırıldı.':'Belge görünürlüğü güncellendi.');
  }catch(err){$('#dialogError').textContent=err.message;btn.disabled=false;}
 }
 }else if(action==='notice'){
 openDialog('Yeni duyuru',input('title','Başlık','text','','required maxlength="100"')+'<label for="f-body">Duyuru</label><textarea id="f-body" name="body" rows="5" required maxlength="2000"></textarea>',async f=>{await api('notices','POST',{title:f.get('title'),body:f.get('body')});toast('Duyuru yayınlandı.');},'Yayınla');
 }else if(action==='unit'){
 const u=state.units.find(u=>u.id===id);
 openDialog(u.label+' · Düzenle',input('label','Bölüm adı','text',u.label,'required maxlength="60"')+input('owner','Malik adı (yalnızca yönetici görür)','text',u.owner,'maxlength="100"')+input('resident','Oturan adı (yalnızca yönetici görür)','text',u.resident,'maxlength="100"')+'<div class="check exemption"><input id="f-exempt" type="checkbox" name="exempt" '+(u.exempt?'checked':'')+'><label for="f-exempt">Aidattan muaf tut</label></div><p class="help">Yönetici dairesi için açabilirsiniz. Yeni aylık aidat oluşturulurken uygulanır. Eski borç ve ödeme kayıtları korunur.</p>',async f=>{await api('units/'+id,'PUT',{label:f.get('label'),owner:f.get('owner'),resident:f.get('resident'),exempt:f.get('exempt')==='on'});toast('Bölüm ve muafiyet kaydedildi.');});
 }else if(action.startsWith('delete-')){
 const what=action.slice(7),map={payment:['payments','Ödemeyi iptal edince ilgili aidat borcu yeniden açılacak. Devam edilsin mi?'],expense:['expenses','Bu gider silinsin mi? Kasa bakiyesi yeniden hesaplanacak.'],notice:['notices','Duyuru kaldırılsın mı?']};
 if(what==='expense'&&(state.expenses.find(expense=>expense.id===id)?.files||[]).length)throw new Error('Önce bu giderin Belgeler bölümündeki dosyaları kaldırın.');
 if(!map[what]||!confirm(map[what][1]))return;
 btn.disabled=true;await api(map[what][0]+'/'+id,'DELETE',{});await refresh();toast('İşlem kaydedildi.');
 }else if(action==='csv'){
 const rows=[['Bölüm','Ay','Aidat TL','Ödenen TL','Kalan TL','Yönetim kararı ile muaf']];
 for(const u of state.units){const c=state.charges.find(c=>c.unit_id===u.id&&c.period===selectedMonth);rows.push([u.label,selectedMonth,c?c.amount/100:0,c?c.paid/100:0,c?(c.amount-c.paid)/100:0,u.exempt?'Evet':'Hayır']);}
 const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/^[=+@-]/,"'\u0024&").replace(/"/g,'""')+'"').join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='aidat-'+selectedMonth+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 }catch(err){error(err);btn.disabled=false;}
});
const installApp=initPwa({showStatus:toast,showGuide:kind=>{
 const instructions=kind==='ios'?'<ol><li>Bu siteyi Safari’de aç.</li><li>Paylaş menüsünden <strong>Ana Ekrana Ekle</strong> seç.</li><li>Varsa <strong>Web Uygulaması Olarak Aç</strong> seçeneğini açıp <strong>Ekle</strong> düğmesine dokun.</li></ol>':kind==='android'?'<ol><li>Bu siteyi Chrome’da aç.</li><li>Sağ üstteki üç nokta menüsünden <strong>Uygulamayı yükle</strong> veya <strong>Ana ekrana ekle</strong> seç.</li><li>Yüklemeyi onayla.</li></ol>':'<p>Chrome veya Edge’in adres çubuğundaki yükleme simgesini ya da tarayıcı menüsündeki <strong>Uygulamayı yükle</strong> seçeneğini kullanabilirsin.</p><p>Telefonunda bu siteyi açarak aynı şekilde ana ekrana ekleyebilirsin.</p>';
 openReadDialog('Komşu’yu ana ekrana ekle',instructions);
}});
refresh().then(async()=>{const access=requestFromHash(location.hash);if(access)await showOwnRequest(access);else await followNotification();}).catch(error);
window.addEventListener?.('storage',event=>{if(event.key===SESSION_KEY){$('#modal').close();refresh().then(()=>{if(state.admin)return followNotification();}).catch(error);}});
window.addEventListener?.('storage',event=>{if(event.key===MY_UNIT_KEY||event.key===null){unitPreference.sync(event.key===null?null:event.newValue);if(state&&tab==='my-unit')render();}});
window.addEventListener?.('storage',event=>{if(event.key===NOTICE_TRACKING_KEY||event.key===null){noticeBook.sync(event.key===null?null:event.newValue);if(state&&tab==='my-unit')refresh().catch(error);}});
window.addEventListener?.('hashchange',()=>{followNotification().catch(error);});
setInterval(()=>{if(!$('#modal').open&&!document.hidden&&document.activeElement?.id!=='unitSearch'&&!$('#settingsForm')&&!$('#bankForm')&&!$('#myUnitForm'))refresh().catch(error);},60000);


// iOS may ignore viewport zoom limits. Block only zoom gestures, preserving one-finger scrolling.
for(const type of ['gesturestart','gesturechange'])document.addEventListener(type,event=>event.preventDefault(),{passive:false});
document.addEventListener('touchmove',event=>{if(event.touches.length>1)event.preventDefault();},{passive:false});
