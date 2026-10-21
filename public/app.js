import { unpaidCharges, chargeRequest } from './charge-management.js';
import { createApi } from './transport.js';
import { config } from './config.js';
let storage;
try { storage=window.sessionStorage; } catch { /* memory-only session */ }
const api=createApi({...config,storage});
const selectedCharges=new Set();
let chargeDialogContext=null;
let bulkMode=false;
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
 return '<div class="cards">'+[['KASA',state.totals.cash,'Tüm dönemler · Güncel bakiye','featured'],['BU AY TOPLANAN',charges.reduce((s,c)=>s+c.paid,0),monthName(selectedMonth)+' aidatlarına yapılan ödemeler',''],['BU AY KALAN',charges.reduce((s,c)=>s+c.amount-c.paid,0),monthName(selectedMonth)+' aidatlarından kalan','']].map(([title,value,help,cls])=>'<div class="card '+cls+'"><div class="label">'+title+'</div><div class="number">'+money(value)+'</div><small>'+esc(help)+'</small></div>').join('')+'</div>';
}
function earlierDebt(unitId){return state.charges.filter(c=>c.unit_id===unitId&&c.period<selectedMonth).reduce((sum,c)=>sum+c.amount-c.paid,0);}
function chargeMenu(c){return '<details class="row-menu"><summary aria-label="Aidat işlemleri">⋯</summary><div class="row-menu-items"><button class="small outline" data-action="edit-charge" data-id="'+c.id+'" '+(c.paid>0?'disabled':'')+'>Düzenle</button><button class="small danger" data-action="remove-charge" data-id="'+c.id+'" '+(c.paid>0?'disabled':'')+'>Sil</button>'+(c.paid>0?'<small>Ödeme kaydı olan aidat korunur.</small>':'')+'</div></details>';}
function moreLinks(){return '<div class="more-grid">'+[['notices','Duyurular','Apartmandan haberler'],...(state.admin?[['units','Daireler ve dükkân','Bilgiler ve aidat muafiyeti'],['settings','Yönetim','Ayarlar, yedek ve işlem geçmişi']]:[])].map(([target,title,help])=>'<button class="panel more-link" data-tab="'+target+'"><strong>'+title+'</strong><span>'+help+'</span><span aria-hidden="true">→</span></button>').join('')+'</div>';}
function render(){
 document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===tab||(e.dataset.tab==='more'&&['units','settings','notices'].includes(tab))));
 const view=$('#view'),charges=state.charges.filter(c=>c.period===selectedMonth),expenses=state.expenses.filter(e=>e.date.startsWith(selectedMonth));
 if(tab==='overview'){
  const expected=charges.reduce((s,c)=>s+c.amount,0),paid=charges.reduce((s,c)=>s+c.paid,0),paidCount=charges.filter(c=>c.paid>=c.amount).length;
  const categories=state.categories.map(category=>({category,total:expenses.filter(e=>e.category===category).reduce((s,e)=>s+e.amount,0)})).filter(c=>c.total);
  view.innerHTML='<div class="toolbar"><h2>Apartman özeti</h2>'+monthFilter()+'</div>'+cards()+(state.admin?'<div class="quick-actions"><button class="primary" data-tab="dues">Ödeme al</button><button class="outline" data-action="expense">Gider ekle</button></div>':'')+'<div class="columns"><section class="panel"><div class="toolbar"><h2>Aylık aidat durumu</h2>'+'</div><p class="muted">'+esc(monthName(selectedMonth))+' · '+paidCount+' / '+charges.length+' bölüm ödedi</p><progress max="'+(expected||1)+'" value="'+paid+'" aria-label="Aidat tahsilat oranı"></progress><div class="bar-row"><span>Tahsil edilen</span><strong>'+money(paid)+'</strong></div><div class="bar-row"><span>Beklenen</span><strong>'+money(expected)+'</strong></div><div class="bar-row"><span>Kalan alacak</span><strong>'+money(expected-paid)+'</strong></div>'+(!charges.length?'<p class="empty">Bu ay için aidat oluşturulmamış.</p>':'')+'<h3 class="section-title">Bu ayın gider dağılımı</h3>'+ (categories.map(c=>'<div class="bar-row"><span>'+esc(c.category)+'</span><strong>'+money(c.total)+'</strong></div>').join('')||'<p class="muted">Bu ay gider kaydı yok.</p>')+'</section><section class="panel"><div class="toolbar"><h2>Apartmandan haberler</h2><button class="small outline" data-action="show-notices">Tümü</button></div>'+ (state.notices.slice(0,1).map(noticeHTML).join('')||'<div class="empty">Henüz duyuru yok.</div>')+'</section></div>';
 }else if(tab==='dues'){
  const eligible=unpaidCharges(charges);
  for(const id of selectedCharges)if(!eligible.some(c=>c.id===id))selectedCharges.delete(id);
  const unitsHTML=state.units.map(u=>{
   const c=charges.find(c=>c.unit_id===u.id),remaining=c?c.amount-c.paid:0,old=earlierDebt(u.id);
   const badge=!c?(u.exempt?'Yönetim kararı ile muaf':'Aidat oluşturulmadı'):remaining===0?'Ödendi':c.paid?'Kısmi ödeme':'Bekliyor';
   const selection=state.admin&&bulkMode?'<label class="select-charge"><input type="checkbox" data-charge-select="'+(c?.id||'')+'" aria-label="'+esc(u.label)+' aidatını seç" '+(!c||c.paid>0?'disabled':'')+(c&&selectedCharges.has(c.id)?' checked':'')+'> Seç</label>':'';
   return '<article class="dues-card">'+selection+'<div class="dues-main"><div><h3>'+esc(u.label)+'</h3><span class="badge '+(remaining?(c.paid?'partial':'due'):'')+'">'+badge+'</span></div><div class="dues-balance"><small>Bu ay kalan</small><strong>'+(c?money(remaining):'—')+'</strong></div></div>'+(old?'<p class="old-debt">Önceki aylardan: <strong>'+money(old)+'</strong></p>':'')+'<div class="dues-actions"><button class="outline small" data-action="unit-detail" data-id="'+u.id+'">Ayrıntılar</button>'+(state.admin&&remaining>0?'<button class="primary" data-action="pay" data-id="'+c.id+'">Ödeme al</button>':'')+(state.admin&&c?chargeMenu(c):'')+'</div></article>';
  }).join('');
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Aidatlar</h2>'+monthFilter()+'</div><div class="toolbar"><p class="muted">'+charges.filter(c=>c.paid>=c.amount).length+' / '+charges.length+' bölüm ödedi · Kalan '+money(charges.reduce((sum,c)=>sum+c.amount-c.paid,0))+'</p>'+(state.admin?'<div class="actions"><button class="primary" data-action="charge">Aylık aidat oluştur</button><button class="outline" data-action="toggle-bulk" aria-pressed="'+bulkMode+'">'+(bulkMode?'Toplu işlemi kapat':'Toplu işlem')+'</button></div>':'')+'</div>'+(state.admin&&bulkMode?'<div class="bulk-tools"><label class="check"><input type="checkbox" id="selectAllCharges" aria-label="Ödeme girilmemiş tüm aidatları seç"> Tümünü seç</label><div class="actions"><button class="outline" data-action="edit-selected-charges" disabled>Toplu düzenle</button><button class="danger" data-action="remove-selected-charges" disabled>Toplu sil</button></div><p class="help" id="selectionSummary"></p><p class="help">Yalnızca ödeme girilmemiş aidatlar seçilebilir.</p></div>':'')+'<div class="dues-grid">'+unitsHTML+'</div><details class="secondary-section"><summary>Dışa aktar</summary><button class="outline small" data-action="csv">CSV indir</button></details></section>'+(state.admin?'<details class="panel history"><summary>Ödeme kayıtları · '+esc(monthName(selectedMonth))+'</summary><p class="help">Yanlış kaydedilmiş ödemeleri buradan iptal edebilirsiniz. İptal edilen tutar yeniden borca eklenir.</p>'+table(['Bölüm','Ödeme tarihi','Tutar','Not','İşlem'],state.payments.filter(p=>charges.some(c=>c.id===p.charge_id)).map(p=>'<tr><td>'+esc(unitName(charges.find(c=>c.id===p.charge_id).unit_id))+'</td><td>'+dateName(p.date)+'</td><td>'+money(p.amount)+'</td><td class="expense-name">'+esc(p.note)+'</td><td><button class="small danger" data-action="delete-payment" data-id="'+p.id+'">Ödemeyi iptal et</button></td></tr>'))+'</details>':'');
 }else if(tab==='expenses'){
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Ortak giderler</h2><div class="actions">'+monthFilter()+(state.admin?'<button class="primary" data-action="expense">Gider ekle</button>':'')+'</div></div><p class="muted">'+esc(monthName(selectedMonth))+' toplamı: <strong>'+money(expenses.reduce((s,e)=>s+e.amount,0))+'</strong></p>'+table(['Tarih','Kategori','Açıklama','Tutar',...(state.admin?['İşlem']:[])],expenses.map(e=>'<tr><td>'+dateName(e.date)+'</td><td><span class="badge">'+esc(e.category)+'</span></td><td class="expense-name">'+esc(e.description)+'</td><td>'+money(e.amount)+'</td>'+(state.admin?'<td><button class="small danger" data-action="delete-expense" data-id="'+e.id+'">Sil</button></td>':'')+'</tr>'))+'</section>';
 }else if(tab==='more'){
  view.innerHTML=moreLinks();
 }else if(tab==='notices'){
  view.innerHTML='<section class="panel"><div class="toolbar"><h2>Duyuru panosu</h2>'+(state.admin?'<button class="primary" data-action="notice">Duyuru ekle</button>':'')+'</div>'+(state.notices.map(noticeHTML).join('')||'<div class="empty">İlk duyuru burada görünecek.</div>')+'</section>';
 }else if(tab==='units'&&state.admin){
  view.innerHTML='<div class="note">“Aidattan muaf tut” açık olan bölümlere yeni aylık aidat yazılmaz. Önceki borçlar ve ödemeler korunur.</div><div class="unit-grid">'+state.units.map(u=>'<article class="unit-card"><div class="unit-top"><h3>'+esc(u.label)+'</h3>'+(u.exempt?'<span class="badge">Yönetim kararı ile muaf</span>':'')+'</div><p>Malik: '+esc(u.owner||'Belirtilmedi')+'<br>Oturan: '+esc(u.resident||'Belirtilmedi')+'</p><p>Toplam alacak: <strong>'+money(state.charges.filter(c=>c.unit_id===u.id).reduce((s,c)=>s+c.amount-c.paid,0))+'</strong></p><button class="outline small" data-action="unit" data-id="'+u.id+'">Düzenle / Muafiyet</button></article>').join('')+'</div>';
 }else if(tab==='settings'&&state.admin){
  view.innerHTML='<section class="panel"><h2>Yönetim ayarları</h2><form id="settingsForm" class="setting-form"><label for="name">Apartman adı</label><input id="name" name="name" required maxlength="100" value="'+esc(state.settings.name)+'"><div class="form-grid"><div><label for="monthlyDues">Güncel aylık aidat (TL)</label><input id="monthlyDues" name="monthlyDues" type="number" min="0.01" step="0.01" required value="'+Number(state.settings.monthlyDues)/100+'"></div><div><label for="openingBalance">Açılış kasa bakiyesi (TL)</label><input id="openingBalance" name="openingBalance" type="number" min="0" step="0.01" required value="'+Number(state.settings.openingBalance)/100+'"></div></div><p class="help">Aidat tutarını değiştirmek önceki borçları değiştirmez. Ay için “Aylık aidat oluştur” işlemini ayrıca uygulayın. Açılış bakiyesi sistem öncesinden devreden tutardır.</p><button class="primary" type="submit">Ayarları kaydet</button></form></section><section class="panel history"><div class="toolbar"><h2>Kayıtlar ve yedek</h2><div class="actions"><button class="outline" data-action="backup">JSON yedeği indir</button><button class="outline" data-action="print">Yazdır</button></div></div><p class="help">Yedek dosyası malik/oturan bilgilerini de içerir; güvenli yerde saklayın. İşlem geçmişi son 100 değişikliği gösterir.</p>'+table(['Tarih','İşlem'],state.audit.map(a=>'<tr><td>'+esc(a.created_at)+' UTC</td><td>'+esc(a.action)+'</td></tr>'))+'</section>';
 }
 if(tab==='overview'){
  const pending=state.units.map(u=>({u,total:state.charges.filter(c=>c.unit_id===u.id).reduce((sum,c)=>sum+c.amount-c.paid,0)})).filter(x=>x.total>0);
  view.innerHTML+='<section class="panel history"><div class="toolbar"><h2>Ödeme bekleyenler</h2><span class="muted">Tüm dönemler · '+money(state.totals.receivable)+'</span></div>'+(pending.map(({u,total})=>'<button class="pending-row" data-action="unit-detail" data-id="'+u.id+'"><strong>'+esc(u.label)+'</strong><span>'+money(total)+' <span aria-hidden="true">›</span></span></button>').join('')||'<p class="empty">Bekleyen aidat borcu yok.</p>')+'</section>';
 }
 syncChargeSelection();
}
const input=(name,label,type='text',value='',extra='')=>'<label for="f-'+name+'">'+label+'</label><input id="f-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>';
function openDialog(title,fields,action,submit='Kaydet'){
 chargeDialogContext=null;
 $('#dialogSubmit').hidden=false;
 $('#dialogTitle').textContent=title;$('#dialogFields').innerHTML=fields;$('#dialogError').textContent='';$('#dialogSubmit').textContent=submit;dialogAction=action;$('#modal').showModal();
}
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
$('#closeModal').addEventListener('click',()=>$('#modal').close());
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
 try{
 if(action==='previous-month'||action==='next-month'){
  const d=new Date(selectedMonth+'-15T12:00:00');d.setMonth(d.getMonth()+(action==='next-month'?1:-1));
  const next=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  if(next>='2000-01'&&next<='2099-12'){selectedMonth=next;selectedCharges.clear();render();}
 }
 else if(action==='toggle-bulk'){bulkMode=!bulkMode;selectedCharges.clear();render();}
 else if(action==='unit-detail'){
  const u=state.units.find(u=>u.id===id),items=state.charges.filter(c=>c.unit_id===id).sort((a,b)=>b.period.localeCompare(a.period));
  const total=items.reduce((sum,c)=>sum+c.amount-c.paid,0);
  $('#dialogTitle').textContent=u.label+' · Aidat ayrıntıları';
  $('#dialogFields').innerHTML='<div class="note">Toplam kalan borç: <strong>'+money(total)+'</strong></div>'+(u.exempt?'<p><span class="badge">Yönetim kararı ile muaf</span></p>':'')+(items.map(c=>'<article class="charge-detail"><h3>'+esc(monthName(c.period))+'</h3><p class="help">Aidat '+money(c.amount)+' · Ödenen '+money(c.paid)+'</p><div class="toolbar"><strong>Kalan '+money(c.amount-c.paid)+'</strong>'+(state.admin&&c.amount>c.paid?'<button type="button" class="primary small" data-action="pay" data-id="'+c.id+'">Ödeme al</button>':'')+'</div></article>').join('')||'<p class="empty">Henüz aidat oluşturulmamış.</p>');
  $('#dialogError').textContent='';$('#dialogSubmit').hidden=true;dialogAction=null;chargeDialogContext=null;$('#modal').showModal();
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
 openDialog('Ortak gider ekle','<label for="f-category">Kategori</label><select id="f-category" name="category">'+state.categories.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select>'+input('description','Açıklama','text','','required maxlength="300"')+input('amount','Tutar (TL)','number','','required min="0.01" step="0.01" max="10000000"')+input('date','Gider tarihi','date',today(),'required'),async f=>{await api('expenses','POST',{category:f.get('category'),description:f.get('description'),amount:Number(f.get('amount')),date:f.get('date')});selectedMonth=f.get('date').slice(0,7);toast('Gider kaydedildi.');});
 }else if(action==='notice'){
 openDialog('Yeni duyuru',input('title','Başlık','text','','required maxlength="100"')+'<label for="f-body">Duyuru</label><textarea id="f-body" name="body" rows="5" required maxlength="2000"></textarea>',async f=>{await api('notices','POST',{title:f.get('title'),body:f.get('body')});toast('Duyuru yayınlandı.');},'Yayınla');
 }else if(action==='unit'){
 const u=state.units.find(u=>u.id===id);
 openDialog(u.label+' · Düzenle',input('label','Bölüm adı','text',u.label,'required maxlength="60"')+input('owner','Malik adı (yalnızca yönetici görür)','text',u.owner,'maxlength="100"')+input('resident','Oturan adı (yalnızca yönetici görür)','text',u.resident,'maxlength="100"')+'<div class="check exemption"><input id="f-exempt" type="checkbox" name="exempt" '+(u.exempt?'checked':'')+'><label for="f-exempt">Aidattan muaf tut</label></div><p class="help">Yönetici dairesi için açabilirsiniz. Yeni aylık aidat oluşturulurken uygulanır. Eski borç ve ödeme kayıtları korunur.</p>',async f=>{await api('units/'+id,'PUT',{label:f.get('label'),owner:f.get('owner'),resident:f.get('resident'),exempt:f.get('exempt')==='on'});toast('Bölüm ve muafiyet kaydedildi.');});
 }else if(action.startsWith('delete-')){
 const what=action.slice(7),map={payment:['payments','Ödemeyi iptal edince ilgili aidat borcu yeniden açılacak. Devam edilsin mi?'],expense:['expenses','Bu gider silinsin mi? Kasa bakiyesi yeniden hesaplanacak.'],notice:['notices','Duyuru kaldırılsın mı?']};
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

