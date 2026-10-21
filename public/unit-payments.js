export function unitPaymentPlan(charges,unitId,amount){
 const expected=charges.filter(c=>c.unit_id===unitId&&c.amount>c.paid).map(c=>({id:c.id,period:c.period,amount:Number(c.amount),paid:Number(c.paid)})).sort((a,b)=>a.period.localeCompare(b.period)||a.id-b.id);
 const total=expected.reduce((s,c)=>s+c.amount-c.paid,0);
 const value=Number(amount),parts=String(value).split('.'),decimals=(parts[1]||'').padEnd(3,'0');
 const cents=amount===undefined?Math.min(total,1000000000):Number(parts[0])*100+Number(decimals.slice(0,2))+(decimals[2]>='5'?1:0);
 if(!total)throw new Error('Bu bölümün bekleyen borcu yok.');
 if((amount!==undefined&&(!Number.isFinite(Number(amount))||Number(amount)<0.01||Number(amount)>10000000))||!Number.isFinite(cents)||cents<1||cents>1000000000||cents>total)throw new Error('Ödeme toplam kalan borcu aşamaz; geçerli tutar girin.');
 let left=cents;const allocations=[];
 for(const c of expected){if(!left)break;const part=Math.min(left,c.amount-c.paid);allocations.push({chargeId:c.id,period:c.period,amount:part,remaining:c.amount-c.paid-part});left-=part;}
 return {expected,total,amount:cents,remaining:total-cents,allocations};
}
