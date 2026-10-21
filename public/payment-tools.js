export function normalizeIban(value){
 const iban=String(value||'').replace(/\s/g,'').toUpperCase();
 if(!iban)return '';
 if(!/^TR\d{24}$/.test(iban)||BigInt(iban.slice(4)+'2927'+iban.slice(2,4))%97n!==1n)throw new Error('IBAN numarasını kontrol edin.');
 return iban;
}
export const formatIban=iban=>String(iban||'').replace(/(.{4})/g,'$1 ').trim();
export function reminderText(state,unitId,day){
 const unit=state.units.find(u=>u.id===unitId);if(!unit)throw new Error('Bölüm bulunamadı.');
 const charges=state.charges.filter(c=>c.unit_id===unitId&&c.amount>c.paid).sort((a,b)=>a.period.localeCompare(b.period));
 if(!charges.length)throw new Error('Bu bölümün bekleyen borcu yok.');
 const money=v=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(v/100);
 const period=p=>new Date(p+'-15T12:00:00').toLocaleDateString('tr-TR',{year:'numeric',month:'long'});
 const total=charges.reduce((sum,c)=>sum+c.amount-c.paid,0);
 const lines=[state.settings.name+' · Aidat hatırlatması',unit.label,day.split('-').reverse().join('.')+' itibarıyla bekleyen tutarlar:','',...charges.map(c=>period(c.period)+(c.kind==='opening'?' (devir borcu)':'')+': '+money(c.amount-c.paid)),'','Toplam kalan: '+money(total)];
 if(state.settings.iban)lines.push('','Hesap sahibi: '+state.settings.accountHolder,'IBAN: '+formatIban(state.settings.iban),'Ödeme açıklaması: '+unit.label+' aidat');
 lines.push('','Ödemenizi yaptıysanız yönetimle paylaşabilirsiniz. Teşekkür ederiz.');
 return lines.join('\n');
}
