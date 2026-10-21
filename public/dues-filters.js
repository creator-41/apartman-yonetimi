const searchable=value=>String(value||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i').trim();
export function filterUnits(units,charges,month,query='',filter='all'){
 const needle=searchable(query);
 return units.filter(unit=>{
  if(needle&&!searchable(unit.label).includes(needle))return false;
  const current=charges.find(c=>c.unit_id===unit.id&&c.period===month);
  const old=charges.filter(c=>c.unit_id===unit.id&&c.period<month).reduce((s,c)=>s+Number(c.amount)-Number(c.paid),0);
  const remaining=current?Number(current.amount)-Number(current.paid):0;
  if(filter==='debt')return remaining+old>0;
  if(filter==='partial')return Boolean(current&&Number(current.paid)>0&&remaining>0);
  if(filter==='paid')return Boolean(current&&remaining===0&&old===0);
  return true;
 });
}
