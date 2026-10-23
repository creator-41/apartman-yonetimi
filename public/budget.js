// All plan amounts and calculations are integer kuruş. This never creates ledger entries.
export function budgetSummary(state,items){
 const payerCount=state.units.filter(u=>!u.exempt).length,exemptCount=state.units.length-payerCount;
 const dues=Number(state.settings.monthlyDues),expense=items.reduce((sum,item)=>sum+item.amount,0);
 if(!Number.isSafeInteger(dues)||dues<0||items.some(i=>!Number.isSafeInteger(i.amount)||i.amount<=0)||!Number.isSafeInteger(expense)||!Number.isSafeInteger(dues*payerCount))throw new Error('Plan tutarları geçersiz.');
 const expected=dues*payerCount,required=payerCount?Math.ceil(expense/payerCount):null;
 return {payerCount,exemptCount,dues,expense,expected,balance:expected-expense,required,extra:required===null?null:Math.max(0,required-dues)};
}
export function budgetItem(label,amount){
 const name=String(label||'').trim(),value=Number(amount),cents=Math.round(value*100);
 if(!name||name.length>100)throw new Error('Gider adını girin (en fazla 100 karakter).');
 if(!Number.isFinite(value)||value<=0||value>10000000||Math.abs(value*100-cents)>0.00001)throw new Error('Tutarı en fazla iki ondalıkla girin.');
 return {label:name,amount:cents};
}
