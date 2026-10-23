export const MONTHS=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
export const annualStatus=code=>({paid:'Ödendi',partial:'Kısmi',unpaid:'Ödenmedi',exempt:'Muaf',missing:'Kayıt yok',future:'Henüz aidat yok'})[code]||'Kayıt yok';
// Snapshot of the dues periods, not a report of cash received during the calendar year.
export function annualDues(state,year,currentMonth){
 year=Number(year);if(!Number.isInteger(year)||year<2000||year>2099||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(currentMonth))throw new Error('Geçerli yıl seçin.');
 const periods=MONTHS.map((_,i)=>year+'-'+String(i+1).padStart(2,'0'));
 const charges=new Map(state.charges.map(c=>[c.unit_id+':'+c.period,c]));
 const rows=state.units.map(u=>{
  const cells=periods.map(period=>{
   const c=charges.get(u.id+':'+period),amount=c?Number(c.amount):0,paid=c?Number(c.paid):0,remaining=amount-paid;
   const status=c?(remaining<=0?'paid':paid>0?'partial':'unpaid'):u.exempt&&period>=currentMonth?'exempt':period>currentMonth?'future':'missing';
   return {period,chargeId:c?.id??null,kind:c?.kind||'monthly',amount,paid,remaining,status};
  });
  return {unitId:u.id,label:u.label,cells,amount:cells.reduce((s,c)=>s+c.amount,0),paid:cells.reduce((s,c)=>s+c.paid,0),remaining:cells.reduce((s,c)=>s+c.remaining,0)};
 });
 const months=periods.map((period,i)=>({period,amount:rows.reduce((s,r)=>s+r.cells[i].amount,0),paid:rows.reduce((s,r)=>s+r.cells[i].paid,0),remaining:rows.reduce((s,r)=>s+r.cells[i].remaining,0)}));
 return {year,rows,months,amount:rows.reduce((s,r)=>s+r.amount,0),paid:rows.reduce((s,r)=>s+r.paid,0),remaining:rows.reduce((s,r)=>s+r.remaining,0)};
}
