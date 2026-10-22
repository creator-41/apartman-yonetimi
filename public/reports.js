// All calculations use integer kuruş. Dues periods and payment dates are separate.
const sum=(rows,key='amount')=>rows.reduce((total,row)=>total+Number(row[key]),0);
export const chargeDate=c=>c.incurred_on?.slice(0,7)===c.period?c.incurred_on:c.period+'-01';
export function monthReport(state,month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Geçerli ay seçin.');
 const start=month+'-01',payments=state.payments||[],expenses=state.expenses||[];
 const before=rows=>rows.filter(r=>r.date<start),during=rows=>rows.filter(r=>r.date.slice(0,7)===month);
 const opening=Number(state.settings.openingBalance)+sum(before(payments))-sum(before(expenses));
 const income=sum(during(payments)),spent=sum(during(expenses));
 const chargeIds=new Set(state.charges.filter(c=>chargeDate(c).slice(0,7)<=month).map(c=>c.id));
 const paidToDate=sum(payments.filter(p=>chargeIds.has(p.charge_id)&&p.date.slice(0,7)<=month));
 const receivable=sum(state.charges.filter(c=>chargeIds.has(c.id)))-paidToDate;
 const expenseRows=during(expenses);
 const categories=[...new Set(expenseRows.map(e=>e.category))].map(category=>({category,amount:sum(expenseRows.filter(e=>e.category===category))}));
 const paidByCharge=new Map();
 for(const p of payments.filter(p=>p.date.slice(0,7)<=month))paidByCharge.set(p.charge_id,(paidByCharge.get(p.charge_id)||0)+Number(p.amount));
 const debtors=state.units.map(unit=>{
  const items=state.charges.filter(c=>c.unit_id===unit.id&&chargeIds.has(c.id));
  const current=items.filter(c=>c.period===month),older=items.filter(c=>c.period<month);
  const monthlyDue=sum(current),monthlyPaid=current.reduce((s,c)=>s+(paidByCharge.get(c.id)||0),0);
  const currentRemaining=monthlyDue-monthlyPaid,olderRemaining=older.reduce((s,c)=>s+Number(c.amount)-(paidByCharge.get(c.id)||0),0);
  return {unitId:unit.id,label:unit.label,monthlyDue,monthlyPaid,currentRemaining,olderRemaining,total:currentRemaining+olderRemaining,status:currentRemaining>0?(monthlyPaid>0?'Kısmi ödeme':'Ödemedi'):'Önceki dönem borcu'};
 }).filter(u=>u.total>0);
 const collections=during(payments).map(p=>{const c=state.charges.find(c=>c.id===p.charge_id),u=state.units.find(u=>u.id===c?.unit_id);return {date:p.date,amount:p.amount,unit:u?.label||'Bölüm',period:c?.period||''};}).sort((a,b)=>a.date.localeCompare(b.date)||a.unit.localeCompare(b.unit,'tr'));
 const spending=expenseRows.map(e=>({date:e.date,category:e.category,description:e.description||'',amount:e.amount})).sort((a,b)=>a.date.localeCompare(b.date));
 return {month,opening,income,spent,net:income-spent,closing:opening+income-spent,receivable,categories,collections,spending,debtors};
}
export function unitStatement(state,unitId){
 const charges=state.charges.filter(c=>c.unit_id===unitId);
 const ids=new Set(charges.map(c=>c.id)),payments=(state.payments||[]).filter(p=>ids.has(p.charge_id));
 const rows=[...charges.map(c=>({id:c.id,type:'charge',date:chargeDate(c),period:c.period,label:c.kind==='opening'?'Devir borcu':'Aidat',debit:Number(c.amount),credit:0,note:state.admin?c.note||'':''})),...payments.map(p=>({id:p.id,type:'payment',date:p.date,period:charges.find(c=>c.id===p.charge_id).period,label:'Ödeme',debit:0,credit:Number(p.amount),note:state.admin?p.note||'':''}))]
 .sort((a,b)=>a.date.localeCompare(b.date)||(a.type===b.type?a.id-b.id:a.type==='charge'?-1:1));
 let balance=0;for(const row of rows){balance+=row.debit-row.credit;row.balance=balance;}
 return {rows,debit:sum(charges),credit:sum(payments),balance};
}
const money=v=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(v/100);
const monthLabel=m=>new Date(m+'-15T12:00:00').toLocaleDateString('tr-TR',{year:'numeric',month:'long'});
const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('tr-TR');
export function monthSummaryText(state,month,page){
 const r=monthReport(state,month),link=new URL('./',page);
 // Share only aggregate figures; never copy unit balances, notes or tracking tokens.
 return [state.settings.name,monthLabel(month)+' · Aylık özet','',
 'Tahsilat: '+money(r.income),'Toplam gider: '+money(r.spent),'',
 'Harcama özeti',...(r.categories.length?r.categories.map(c=>'• '+c.category+': '+money(c.amount)):['Bu ay harcama yok.']),'',
 'Güncel kasa: '+money(state.totals.cash),'Toplam kalan aidat (tüm dönemler): '+money(state.totals.receivable),'',
 'Ayrıntılar: '+link.href].join('\n');
}
export function monthReportText(state,month){
 const r=monthReport(state,month);
 return [state.settings.name,monthLabel(month)+' · Aylık bilanço','',
 'Devreden kasa: '+money(r.opening),'Tahsilat: '+money(r.income),'Harcamalar: '+money(r.spent),'Gelir − gider: '+money(r.net),'Ay sonu kasa: '+money(r.closing),'Ay sonu kalan alacak: '+money(r.receivable),'',
 'TAHSİLATLAR',...(r.collections.length?r.collections.map(p=>dateLabel(p.date)+' · '+p.unit+(p.period?' · '+monthLabel(p.period)+' aidatı':'')+' · '+money(p.amount)):['Bu ay tahsilat yok.']),'',
 'HARCAMA ÖZETİ',...(r.categories.length?r.categories.map(c=>c.category+': '+money(c.amount)):['Bu ay harcama yok.']),'',
 'HARCAMALAR',...r.spending.map(e=>dateLabel(e.date)+' · '+e.category+' · '+e.description+' · '+money(e.amount)),'',
 'AİDAT BORCU KALAN DAİRELER',...(r.debtors.length?r.debtors.map(u=>u.label+' · '+u.status+' · Bu ay kalan: '+money(u.currentRemaining)+' · Önceki borç: '+money(u.olderRemaining)+' · Toplam: '+money(u.total)):['Ay sonu itibarıyla bekleyen aidat borcu yok.']),'',
 'Tahsilatlar ödeme tarihine göredir. Borçlar seçilen ay sonuna kadar olan kayıtlarla hesaplanır; sonraki aylardaki ödemeler bu rapora dahil değildir.'].join('\n');
}
export function unitStatementText(state,unitId){
 const unit=state.units.find(u=>u.id===unitId);if(!unit)throw new Error('Bölüm bulunamadı.');
 const r=unitStatement(state,unitId);
 // Shared text deliberately omits names and private manager notes.
 return [state.settings.name,unit.label+' · Hesap dökümü','',...r.rows.map(row=>dateLabel(row.date)+' · '+row.label+' ('+monthLabel(row.period)+') · '+(row.type==='charge'?'Borç: '+money(row.debit):'Ödeme: '+money(row.credit))+' · Bakiye: '+money(row.balance)),
 '', 'Toplam borçlandırma: '+money(r.debit),'Toplam ödeme: '+money(r.credit),'Kalan borç: '+money(r.balance)].join('\n');
}
