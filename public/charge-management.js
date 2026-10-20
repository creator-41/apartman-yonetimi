export const unpaidCharges=charges=>charges.filter(c=>Number(c.paid)===0);

export function chargeRequest(charges,ids,operation,amount,period){
  const chosen=[...new Set(ids)];
  const selected=chosen.map(id=>charges.find(c=>c.id===id));
  if(!chosen.length||selected.some(c=>!c))throw new Error('Aidat seçin veya listeyi yenileyin.');
  if(selected.some(c=>Number(c.paid)!==0))throw new Error('Ödeme girilmiş aidatlar değiştirilemez. Önce ödemeyi kontrol edip gerekiyorsa iptal edin.');
  if(new Set(selected.map(c=>c.period)).size!==1)throw new Error('Tek bir ayın aidatlarını seçin.');
  if(!['edit','delete'].includes(operation))throw new Error('Geçersiz işlem.');
  const payload={operation,ids:chosen,expected:selected.map(({id,unit_id,period,amount})=>({id,unit_id,period,amount}))};
  if(operation==='edit'){
    if(!Number.isFinite(amount)||amount<0.01||amount>10000000||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))throw new Error('Geçerli ay ve tutar girin.');
    payload.amount=amount;payload.period=period;
  }
  return payload;
}
