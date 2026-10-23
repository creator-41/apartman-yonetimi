// Entered amounts are TL; payloads, snapshots and differences are integer kuruş.
export function cashCheckAmounts(bank,cash,expectedCash){
 const parse=(value,negative)=>{if(value===null||String(value).trim()==='')throw new Error('Banka ve eldeki nakit tutarını girin.');const n=Number(value),cents=Math.round(n*100);if(!Number.isFinite(n)||n>10000000||n<(negative?-10000000:0)||Math.abs(n*100-cents)>0.00001)throw new Error('Tutarları en fazla iki ondalıkla girin; nakit negatif olamaz.');return cents;};
 if(!Number.isSafeInteger(expectedCash))throw new Error('Kasa bilgisini yenileyin.');
 const bankAmount=parse(bank,true),cashAmount=parse(cash,false);
 return {bank:bankAmount,cash:cashAmount,expectedCash,total:bankAmount+cashAmount,difference:bankAmount+cashAmount-expectedCash};
}
export function cashCheckResult(difference){return difference===0?'Hesap tutuyor':difference<0?'Eksik bakiye':'Fazla bakiye';}
