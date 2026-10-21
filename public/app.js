import { expenseUpdate, uploadReceipt, removeReceipt } from './expense-files.js?v=receipts-1';
import { monthReport, monthReportText, unitStatement, unitStatementText } from './reports.js';
import { unpaidCharges, chargeRequest } from './charge-management.js';
import { createApi } from './transport.js?v=receipts-1';
import { config } from './config.js';
let storage;
try { storage=window.sessionStorage; } catch { /* memory-only session */ }
const api=createApi({...config,storage});
const selectedCharges=new Set();
let chargeDialogContext=null;
let bulkMode=false;
let reportContext=null;
let documentExpenseId=null;
let uploadingDocument=false;
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
 state=await api('state');$('#building').textContent=state.settings.name;document.title=state.settings.name+' · Komşu';
 $('#mode').textContent=state.admin?'Yönetici paneli':'Ortak takip ekranı';$('#auth').textContent=state.admin?'Çıkış yap':'Yönetici girişi';
 document.querySelectorAll('.admin-only').forEach(e=>e.hidden=!state.admin);
 if(!state.admin&&['units','settings'].includes(tab))tab='overview';
 $('#error').hidden=true;render();
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4500);}
function error(e){$('#error').textContent=e.message;$('#error').hidden=false;}
function table(headers,rows,empty='Henüz kayıt yok.'){return rows.length?'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>':'<div class="empty">'+empty+'</div>';}
function monthFilter(){return '<div class="month-picker"><button class="outline month-arrow" data-action="previous-month" aria-label="Önceki ay" '+(selectedMonth==='2000-01'?'disabled':'')+'>‹</button><label class="month-label" for="monthFilter"><span>'+esc(monthName(selectedMonth))+'</span><input aria-label="Ay seçin" id="monthFilter" type="month" min="2000-01" max="2099-12" value="'+selectedMonth+'"></label><button class="outline month-arrow" data-action="next-month" aria-label="Sonraki ay" '+(selectedMonth==='2099-12'?'disabled':'')+'>›</button></div>';}
function cards(){
 const charges=state.charges.filter(c=>c.period===selectedMonth);
 return '<div class="cards">'+[['KASA',state.totals.cash,'Tüm dönemler · Güncel bakiye','featured'],['BU AY TOPLANAN',charges.reduce((s,c)=>s+c.paid,0),monthName(selectedMonth)+' aidatlarına yapılan ödemeler',''],['BU AY KALAN',charges.reduce((s,c)=>s+c.amount-c.paid,0),monthName(selectedMonth)+' aidatlarından kalan',''],['ÖNCEKİ AYLARDAN KALAN',state.charges.filter(c=>c.period<selectedMonth).reduce((sum,c)=>sum+c.amount-c.paid,0),monthName(selectedMonth)+' öncesindeki aidatlardan kalan','arrears']].map(([title,value,help,cls])=>'<div class="card '+cls+'"><div class="label">'+title+'</div><div class="number">'+money(value)+'</div><small>'+esc(help)+'</small></div>').join('')+'</div>';
}
function earlierDebt(unitId){return state.charges.filter(c=>c.unit_id===unitId&&c.period<selectedMonth).reduce((sum,c)=>sum+c.amount-c.paid,0);}
function chargeMenu(c){return '<details class="row-menu"><summary aria-label="Aidat işlemleri">⋯</summary><div class="row-menu-items"><button class="small outline" data-action="edit-charge" data-id="'+c.id+'" '+(c.paid>0?'disabled':'')+'>Düzenle</button><button class="small danger" data-action="remove-charge" data-id="'+c.id+'" '+(c.paid>0?'disabled':'')+'>Sil</button>'+(c.paid>0?'<small>Ödeme kaydı olan aidat korunur.</small>':'')+'</div></details>';}
function moreLinks(){return '<div class="more-grid">'+[['report','Aylık hesap özeti','Kasa, tahsilat ve giderler'],['notices','Duyurular','Apartmandan haberler'],...(state.admin?[['units','Daireler ve dükkân','Bilgiler ve aidat muafiyeti'],['settings','Yönetim','Ayarlar, yedek ve işlem geçmişi']]:[])].map(([target,title,help])=>'<button class="panel more-link" data-tab="'+target+'"><strong>'+title+'</strong><span>'+help+'</span><span aria-hidden="true">→</span></button>').join('')+(state.admin?'<button class="panel more-link" data-action="opening-charge"><strong>Eski borç girişi</strong><span>Önceki dönemlerden kalan borçlar</span><span aria-hidden="true">→</span></button>':'')+'</div>';}
function render(){
 document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===tab||(e.dataset.tab==='more'&&['units','settings','notices','report'].includes(tab))));
 const view=$('#view'),charges=state.charges.filter(c=>c.period===selectedMonth),expenses=state.expenses.filter(e=>e.date.startsWith(selectedMonth));
 if(tab==='overview'){
  const expected=charges.reduce((s,c)=>s+c.amount,0),paid=charges.reduce((s,c)=>s+c.paid,0),paidCount=charges.filter(c=>c.paid>=c.amount).length;
  const categories=state.categories.map(category=>({category,total:expenses.filter(e=>e.category===category).reduce((s,e)=>s+e.amount,0)})).filter(c=>c.total);
  view.innerHTML='<div class="toolbar"><h2>Apartman özeti</h2><div class="actions"><button class="outline" data-tab="report">Aylık hesap özeti</button>'+monthFilter()+'</div></div>'+cards()+(state.admin?'<div class="quick-actions"><button class="primary" data-tab="dues">Ödeme al</button><button class="outline" data-action="expense">Gider ekle</button></div>':'')+'<div class="columns"><section class="panel"><div class="toolbar"><h2>Aylık aidat durumu</h2>'+'</div><p class="muted">'+esc(monthName(selectedMonth))+' · '+paidCount+' / '+charges.length+' bölüm ödedi</p><progress max="'+(expected||1)+'" value="'+paid+'" aria-label="Aidat tahsilat oranı"></progress><div class="bar-row"><span>Tahsil edilen</span><strong>'+money(paid)+'</strong></div><div class="bar-row"><span>Beklenen</span><strong>'+money(expected)+'</strong></div><div class="bar-row"><span>Kalan alacak</span><strong>'+money(expected-paid)+'</strong></div>'+(!charges.length?'<p class="empty">Bu ay için aidat oluşturulmamış.</p>':'')+'<h3 class="section-title">Bu ayın gider dağılımı</h3>'+ (categories.map(c=>'<div class="bar-row"><span>'+esc(c.category)+'</span><strong>'+money(c.total)+'</strong></div>').join('')||'<p class="muted">Bu ay gider kaydı yok.</p>')+'</section><section class="panel"><div class="toolbar"><h2>Apartmandan haberler</h2><button class="small outline" data-action="show-notices">Tümü</button></div>'+ (state.notices.slice(0,1).map(noticeHTML).join('')||'<div class="empty">Henüz duyuru yok.</div>')+'</section></div>';
 }else if(tab==='dues'){
  const eligible=unpaidCharges(charges);
  for(const id of selectedCharges)if(!eligible.some(c=>c.id===id))selectedCharges.delete(id);
  const unitsHTML=state.units.map(u=>{
   const c=charges.find(c=>c.unit_id===u.id),remaining=c?c.amount-c.paid:0,old=earlierDebt(u.id);
   const badge=!c?(u.exempt?'Yönetim kararı ile muaf':'Aidat oluşturulmadı'):remaining===0?'Ödendi':c.paid?'Kısmi ödeme':'Bekliyor';
   const selection=state.admin&&bulkMode?'<label class="select-charge"><input type="checkbox" data-charge-select="'+(c?.id||'')+'" aria-label="'+esc(u.label)+' aidatını seç" '+(!c||c.paid>0?'disabled':'')+(c&&selectedCharges.has(c.id)?' checked':'')+'> Seç</label>':'';
   return '<article class="dues-card">'+selection+'<div class="dues-main"><div><h3>'+esc(u.label)+'</h3>'+(c?.kind==='opening'?'<small class="ledger-period">Devir borcu</small>':'')+'<span class="badge '+(remaining?(c.paid?'partial':'due'):'')+'">'+badge+'</span></div><div class="dues-balance"><small>Bu ay kalan</small><strong>'+(c?money(remaining):'—')+'</strong></div></div>'+(old?'<p class="old-debt">Önceki aylardan: <strong>'+money(old)+'</strong></p>':'')+'<div class="dues-actions"><button class="outline small" data-action="unit-detail" data-id="'+u.id+'">Ayrıntılar</button>'+(state.admin&&remaining>0?'<button class="primary" data-action="pay" data-id="'+c.id+'">Ödeme al</button>':'')+(state.admin&&c?chargeMenu(c):'')+'</div></article>';
  }).join('');
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Aidatlar</h2>'+monthFilter()+'</div><div class="toolbar"><p class="muted">'+charges.filter(c=>c.paid>=c.amount).length+' / '+charges.length+' bölüm ödedi · Kalan '+money(charges.reduce((sum,c)=>sum+c.amount-c.paid,0))+'</p>'+(state.admin?'<div class="actions"><button class="primary" data-action="charge">Aylık aidat oluştur</button><button class="outline" data-action="toggle-bulk" aria-pressed="'+bulkMode+'">'+(bulkMode?'Toplu işlemi kapat':'Toplu işlem')+'</button></div>':'')+'</div>'+(state.admin&&bulkMode?'<div class="bulk-tools"><label class="check"><input type="checkbox" id="selectAllCharges" aria-label="Ödeme girilmemiş tüm aidatları seç"> Tümünü seç</label><div class="actions"><button class="outline" data-action="edit-selected-charges" disabled>Toplu düzenle</button><button class="danger" data-action="remove-selected-charges" disabled>Toplu sil</button></div><p class="help" id="selectionSummary"></p><p class="help">Yalnızca ödeme girilmemiş aidatlar seçilebilir.</p></div>':'')+'<div class="dues-grid">'+unitsHTML+'</div><details class="secondary-section"><summary>Dışa aktar</summary><button class="outline small" data-action="csv">CSV indir</button></details></section>'+(state.admin?'<details class="panel history"><summary>Ödeme kayıtları · '+esc(monthName(selectedMonth))+'</summary><p class="help">Yanlış kaydedilmiş ödemeleri buradan iptal edebilirsiniz. İptal edilen tutar yeniden borca eklenir.</p>'+table(['Bölüm','Ödeme tarihi','Tutar','Not','İşlem'],state.payments.filter(p=>charges.some(c=>c.id===p.charge_id)).map(p=>'<tr><td>'+esc(unitName(charges.find(c=>c.id===p.charge_id).unit_id))+'</td><td>'+dateName(p.date)+'</td><td>'+money(p.amount)+'</td><td class="expense-name">'+esc(p.note)+'</td><td><button class="small danger" data-action="delete-payment" data-id="'+p.id+'">Ödemeyi iptal et</button></td></tr>'))+'</details>':'');
 }else if(tab==='expenses'){
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Ortak giderler</h2><div class="actions">'+monthFilter()+(state.admin?'<button class="primary" data-action="expense">Gider ekle</button>':'')+'</div></div><p class="muted">'+esc(monthName(selectedMonth))+' toplamı: <strong>'+money(expenses.reduce((s,e)=>s+e.amount,0))+'</strong></p>'+table(['Tarih','Kategori','Açıklama','Tutar','Belge',...(state.admin?['İşlem']:[])],expenses.map(e=>'<tr><td>'+dateName(e.date)+'</td><td><span class="badge">'+esc(e.category)+'</span></td><td class="expense-name">'+esc(e.description)+'</td><td>'+money(e.amount)+'</td><td>'+(state.admin||(e.files||[]).length?'<button class="small outline" data-action="expense-files" data-id="'+e.id+'">Belgeler'+((e.files||[]).length?' ('+e.files.length+')':'')+'</button>':'—')+'</td>'+(state.admin?'<td><button class="small outline" data-action="edit-expense" data-id="'+e.id+'">Düzenle</button> <button class="small danger" data-action="delete-expense" data-id="'+e.id+'">Sil</button></td>':'')+'</tr>'))+'</section>';
 }else if(tab==='report'){
  view.innerHTML=reportHTML();
 }else if(tab==='more'){
  view.innerHTML=moreLinks();
 }else if(tab==='notices'){
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Duyuru panosu</h2>'+(state.admin?'<button class="primary" data-action="notice">Duyuru ekle</button>':'')+'</div>'+(state.notices.map(noticeHTML).join('')||'<div class="empty">İlk duyuru burada görünecek.</div>')+'</section>';
 }else if(tab==='units'&&state.admin){
  view.innerHTML='<div class="note">“Aidattan muaf tut” açık olan bölümlere yeni aylık aidat yazılmaz. Önceki borçlar ve ödemeler korunur.</div><div class="unit-grid">'+state.units.map(u=>'<article class="unit-card"><div class="unit-top"><h3>'+esc(u.label)+'</h3>'+(u.exempt?'<span class="badge">Yönetim kararı ile muaf</span>':'')+'</div><p>Malik: '+esc(u.owner||'Belirtilmedi')+'<br>Oturan: '+esc(u.resident||'Belirtilmedi')+'</p><p>Toplam alacak: <strong>'+money(state.charges.filter(c=>c.unit_id===u.id).reduce((s,c)=>s+c.amount-c.paid,0))+'</strong></p><button class="outline small" data-action="unit" data-id="'+u.id+'">Düzenle / Muafiyet</button></article>').join('')+'</div>';
 }else if(tab==='settings'&&state.admin){
  view.innerHTML='<section class="panel"><h2>Yönetim ayarları</h2><form id="settingsForm" class="setting-form"><label for="name">Apartman adı</label><input id="name" name="name" required maxlength="100" value="'+esc(state.settings.name)+'"><div class="form-grid"><div><label for="monthlyDues">Güncel aylık aidat (TL)</label><input id="monthlyDues" name="monthlyDues" type="number" min="0.01" step="0.01" required value="'+Number(state.settings.monthlyDues)/100+'"></div><div><label for="openingBalance">Açılış kasa bakiyesi (TL)</label><input id="openingBalance" name="openingBalance" type="number" min="0" step="0.01" required value="'+Number(state.settings.openingBalance)/100+'"></div></div><p class="help">Aidat tutarını değiştirmek önceki borçları değiştirmez. Ay için “Aylık aidat oluştur” işlemini ayrıca uygulayın. Açılış bakiyesi sistem öncesinden devreden tutardır.</p><button class="primary" type="submit">Ayarları kaydet</button></form></section><section class="panel history"><div class="toolbar"><h2>Kayıtlar ve yedek</h2><div class="actions"><button class="outline" data-action="backup">JSON kayıt yedeği indir</button><button class="outline" data-action="print">Yazdır</button></div></div><p class="help">Yedek, kayıtları ve belge listesini içerir; yüklenen dosyalar ayrıca saklanır. Malik/oturan bilgileri de bulunduğu için güvenli yerde saklayın. İşlem geçmişi son 100 değişikliği gösterir.</p>'+table(['Tarih','İşlem'],state.audit.map(a=>'<tr><td>'+esc(a.created_at)+' UTC</td><td>'+esc(a.action)+'</td></tr>'))+'</section>';
 }
 if(tab==='overview'){
  const pending=state.units.map(u=>({u,total:state.charges.filter(c=>c.unit_id===u.id).reduce((sum,c)=>sum+c.amount-c.paid,0)})).filter(x=>x.total>0);
  view.innerHTML+='<section class="panel history"><div class="toolbar"><h2>Ödeme bekleyenler</h2><span class="muted">Tüm dönemler · '+money(state.totals.receivable)+'</span></div>'+(pending.map(({u,total})=>'<button class="pending-row" data-action="unit-detail" data-id="'+u.id+'"><strong>'+esc(u.label)+'</strong><span>'+money(total)+' <span aria-hidden="true">›</span></span></button>').join('')||'<p class="empty">Bekleyen aidat borcu yok.</p>')+'</section>';
 }
 syncChargeSelection();
}
const input=(name,label,type='text',value='',extra='')=>'<label for="f-'+name+'">'+label+'</label><input id="f-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>';
function openDialog(title,fields,action,submit='Kaydet'){
 chargeDialogContext=null;reportContext=null;
 $('#dialogSubmit').hidden=false;
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
 return '<section class="panel"><div class="toolbar"><h2>Aylık hesap özeti</h2>'+monthFilter()+'</div>'+shareButtons()+'<div class="report-totals">'+[['Devreden kasa',r.opening],['Bu ay tahsil edilen',r.income],['Bu ay gider',r.spent],['Ay sonu kasa',r.closing],['Ay sonu kalan alacak',r.receivable]].map(([label,value])=>'<div class="bar-row"><span>'+label+'</span><strong>'+money(value)+'</strong></div>').join('')+'</div><h3 class="section-title">Gider dağılımı</h3>'+(r.categories.map(c=>'<div class="bar-row"><span>'+esc(c.category)+'</span><strong>'+money(c.amount)+'</strong></div>').join('')||'<p class="muted">Bu ay gider kaydı yok.</p>')+'<p class="help">Tahsilatlar ödeme tarihine göre hesaplanır. Bakiyeler güncel kayıtlara göredir.</p></section>';
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
function showExpenseFiles(expenseId){
 const expense=state.expenses.find(e=>e.id===expenseId);if(!expense)throw new Error('Gider bulunamadı.');
 const files=expense.files||[];
 const items=files.map(file=>'<article class="receipt"><strong>'+esc(file.file_name)+'</strong><small>'+ (file.uploaded?(file.shared?'Ortak ekranda görünüyor':'Yalnızca yönetici'):'Yükleme tamamlanmadı')+' · '+(file.bytes/1024/1024).toLocaleString('tr-TR',{maximumFractionDigits:1})+' MB</small><div class="actions">'+(file.uploaded?'<button type="button" class="outline small" data-action="open-file" data-file-id="'+file.id+'">Görüntüle</button>':'')+(state.admin?(file.uploaded?'<button type="button" class="outline small" data-action="file-visibility" data-file-id="'+file.id+'">'+(file.shared?'Ortak ekrandan gizle':'Ortak ekranda göster')+'</button>':'')+'<button type="button" class="danger small" data-action="remove-file" data-file-id="'+file.id+'">Kaldır</button>':'')+'</div></article>').join('');
 const uploader=state.admin&&files.length<5?'<div class="receipt-upload"><label for="receiptInput">Fiş / fatura seç</label><input id="receiptInput" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><p class="help">JPG, PNG, WEBP veya PDF · En fazla 10 MB. Yüklenen belgeyi önce yalnızca yönetici görür.</p><button type="button" class="primary" data-action="upload-file">Belgeyi yükle</button></div>':'';
 openReadDialog('Gider belgeleri','<p>'+esc(expense.description)+' · <strong>'+money(expense.amount)+'</strong></p>'+(items||'<p class="empty">Henüz belge yok.</p>')+uploader);
 documentExpenseId=expenseId;
}
function currentFile(id){return state.expenses.flatMap(e=>e.files||[]).find(f=>f.id===id);}
function syncChargeSelection(){
 const eligible=unpaidCharges(state.charges.filter(c=>c.period===selectedMonth));
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
document.addEventListener('input',e=>{if(['f-amount','f-period'].includes(e.target.id))updateChargePreview();});
$('#dialogForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!dialogAction)return;const button=$('#dialogSubmit');button.disabled=true;
 try{await dialogAction(new FormData(e.target));$('#modal').close();await refresh();}catch(err){$('#dialogError').textContent=err.message;}finally{button.disabled=false;}
});
$('#closeModal').addEventListener('click',()=>{if(!uploadingDocument)$('#modal').close();});
$('#modal').addEventListener('cancel',e=>{if(uploadingDocument)e.preventDefault();});
$('#auth').addEventListener('click',async()=>{
 if(state?.admin){try{await api('logout','POST',{});await refresh();toast('Yönetici oturumu kapatıldı.');}catch(e){error(e);}return;}
 openDialog('Yönetici girişi',input('email','Yönetici e-postası','email','','required autocomplete="username"')+input('password','Yönetici şifresi','password','','required autocomplete="current-password" maxlength="1024"'),async f=>{await api('login','POST',{email:f.get('email'),password:f.get('password')});toast('Yönetici paneli açıldı.');},'Giriş yap');
});
document.addEventListener('change',e=>{
 if(e.target.id==='monthFilter'&&e.target.value){selectedMonth=e.target.value;selectedCharges.clear();render();}
 else if(e.target.matches('[data-charge-select]')){const id=Number(e.target.dataset.chargeSelect);if(e.target.checked)selectedCharges.add(id);else selectedCharges.delete(id);syncChargeSelection();}
 else if(e.target.id==='selectAllCharges'){selectedCharges.clear();if(e.target.checked)for(const c of unpaidCharges(state.charges.filter(c=>c.period===selectedMonth)))selectedCharges.add(c.id);syncChargeSelection();}
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='settingsForm')return;e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
 try{const f=new FormData(e.target);await api('settings','PUT',{name:f.get('name'),monthlyDues:Number(f.get('monthlyDues')),openingBalance:Number(f.get('openingBalance'))});await refresh();toast('Ayarlar kaydedildi.');}catch(err){error(err);}finally{button.disabled=false;}
});
document.addEventListener('click',async e=>{
 const nav=e.target.closest('[data-tab]');if(nav){tab=nav.dataset.tab;render();return;}
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
 else if(action==='toggle-bulk'){bulkMode=!bulkMode;selectedCharges.clear();render();}
 else if(action==='unit-detail'){
  const u=state.units.find(u=>u.id===id);if(!u)throw new Error('Bölüm bulunamadı.');
  const items=state.charges.filter(c=>c.unit_id===id).sort((a,b)=>b.period.localeCompare(a.period));
  const ledger=unitStatement(state,id);
  const rows=ledger.rows.map(row=>'<tr><td>'+dateName(row.date)+'</td><td>'+esc(row.label)+'<small class="ledger-period">'+esc(monthName(row.period))+'</small>'+(row.note?'<small class="ledger-period">'+esc(row.note)+'</small>':'')+'</td><td>'+ (row.debit?money(row.debit):'—')+'</td><td>'+(row.credit?money(row.credit):'—')+'</td><td>'+money(row.balance)+'</td></tr>');
  openReadDialog(u.label+' · Hesap dökümü','<div class="statement-totals"><p>Borçlandırma <strong>'+money(ledger.debit)+'</strong></p><p>Ödemeler <strong>'+money(ledger.credit)+'</strong></p><p>Kalan borç <strong>'+money(ledger.balance)+'</strong></p></div>'+(u.exempt?'<p><span class="badge">Yönetim kararı ile muaf</span></p>':'')+shareButtons()+table(['Tarih','İşlem','Borç','Ödeme','Bakiye'],rows,'Henüz hesap hareketi yok.')+(state.admin?'<div class="statement-payments">'+items.filter(c=>c.amount>c.paid).map(c=>'<div class="bar-row"><span>'+esc(monthName(c.period))+' · '+money(c.amount-c.paid)+'</span><button type="button" class="primary small" data-action="pay" data-id="'+c.id+'">Ödeme al</button></div>').join('')+'<button type="button" class="outline" data-action="opening-charge" data-id="'+id+'">Eski borç ekle</button></div>':''));
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
 else if(action==='copy-report'||action==='download-report'){
  const text=reportContext?.kind==='unit'?unitStatementText(state,reportContext.id):monthReportText(state,selectedMonth);
  if(action==='download-report')downloadText(text,reportContext?.kind==='unit'?'daire-'+reportContext.id+'-hesap-dokumu.txt':'apartman-'+selectedMonth+'-hesap-ozeti.txt');
  else{try{await navigator.clipboard.writeText(text);toast('Metin kopyalandı. WhatsApp’a yapıştırabilirsiniz.');}catch{openReadDialog('Paylaşılacak metin','<label for="reportText">Metni seçip kopyalayın</label><textarea id="reportText" readonly rows="12">'+esc(text)+'</textarea>');$('#reportText').focus();$('#reportText').select();}}
 }
 else if(action==='show-notices'){tab='notices';render();}
 else if(action==='edit-charge'||action==='remove-charge')manageCharges(action==='edit-charge'?'edit':'delete',[id]);
 else if(action==='edit-selected-charges'||action==='remove-selected-charges')manageCharges(action==='edit-selected-charges'?'edit':'delete',[...selectedCharges]);
 else if(action==='print')window.print();
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
 openDialog(unitName(c.unit_id)+' · Ödeme al','<p class="help">'+esc(monthName(c.period))+' · Kalan: '+money(c.amount-c.paid)+'</p>'+input('amount','Ödenen tutar (TL)','number',(c.amount-c.paid)/100,'required min="0.01" step="0.01" max="'+(c.amount-c.paid)/100+'"')+'<details class="secondary-section"><summary>Tarih ve not ekle</summary>'+input('date','Ödeme tarihi','date',today(),'required')+input('note','Not / Makbuz bilgisi','text','','maxlength="200"')+'</details>',async f=>{await api('payments','POST',{chargeId:id,amount:Number(f.get('amount')),date:f.get('date'),note:f.get('note')});toast('Ödeme kaydedildi.');},'Ödemeyi kaydet');
 }else if(action==='expense'){
 editExpense();
 }else if(action==='edit-expense'){
 const expense=state.expenses.find(expense=>expense.id===id);if(!expense)throw new Error('Gider bulunamadı. Listeyi yenileyin.');editExpense(expense);
 }else if(action==='expense-files'){
 showExpenseFiles(id);
 }else if(action==='upload-file'){
 if(uploadingDocument)return;
 const expenseId=documentExpenseId,file=$('#receiptInput')?.files[0];
 uploadingDocument=true;$('#closeModal').disabled=true;btn.disabled=true;btn.textContent='Yükleniyor…';$('#dialogError').textContent='';
 try{await uploadReceipt(api,expenseId,file);await refresh();showExpenseFiles(expenseId);toast('Belge eklendi.');}
 catch(err){try{await refresh();showExpenseFiles(expenseId);}catch{}$('#dialogError').textContent=err.message;}
 finally{uploadingDocument=false;$('#closeModal').disabled=false;btn.disabled=false;btn.textContent='Belgeyi yükle';}
 }else if(['open-file','file-visibility','remove-file'].includes(action)){
 const file=currentFile(btn.dataset.fileId);if(!file)throw new Error('Belge bulunamadı. Listeyi yenileyin.');
 const expenseId=documentExpenseId;
 if(action==='open-file'){
  btn.disabled=true;
  try{
   const result=await api('files/sign','POST',{path:file.path});
   const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Belgeyi aç';link.className='outline';
   if(btn.nextElementSibling?.matches('a'))btn.nextElementSibling.remove();btn.after(link);btn.textContent='Bağlantıyı yenile';link.click();
  }finally{btn.disabled=false;}
 }else{
  if(action==='remove-file'&&!confirm('Bu belge kaldırılsın mı? Gider kaydı korunacak.'))return;
  if(action==='file-visibility'&&!file.shared&&!confirm('Bu belge ortak ekranda herkese açılacak. Kişisel bilgileri kontrol ettiniz mi?'))return;
  btn.disabled=true;
  try{
   if(action==='remove-file')await removeReceipt(api,file);
   else await api('expenses/manage','POST',{operation:'visibility',fileId:file.id,shared:!file.shared});
   await refresh();showExpenseFiles(expenseId);toast(action==='remove-file'?'Belge kaldırıldı.':'Belge görünürlüğü güncellendi.');
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
refresh().catch(error);
setInterval(()=>{if(!$('#modal').open&&!document.hidden&&!$('#settingsForm'))refresh().catch(error);},60000);

