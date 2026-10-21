const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(v/100);
export function paymentReceipt(state,id){
 if(!Number.isSafeInteger(id)||id<1)throw new Error('Geçersiz makbuz numarası.');
 const payment=state.payments.find(p=>p.id===id);
 if(!payment)throw new Error('Güncel ödeme kaydı bulunamadı. Ödeme iptal edilmiş olabilir.');
 const charge=state.charges.find(c=>c.id===payment.charge_id),unit=state.units.find(u=>u.id===charge?.unit_id);
 if(!charge||!unit)throw new Error('Makbuzun bölüm bilgisi bulunamadı.');
 return {number:'KM-'+String(id).padStart(6,'0'),paymentId:id,building:state.settings.name,unit:unit.label,period:charge.period,kind:charge.kind||'monthly',date:payment.date,amount:payment.amount};
}
export function receiptLink(base,id){
 if(!Number.isSafeInteger(id)||id<1)throw new Error('Geçersiz makbuz numarası.');
 const url=new URL('receipt.html',base);url.searchParams.set('payment',id);return url.href;
}
function wrap(text,max){
 const words=String(text).split(/\s+/),lines=[];let line='';
 for(const word of words){for(let i=0;i<word.length;i+=max){const part=word.slice(i,i+max);if(line&&(line+' '+part).length>max){lines.push(line);line='';}line+=(line?' ':'')+part;}}
 if(line)lines.push(line);return lines;
}
export function receiptSvg(receipt,link){
 const building=wrap(receipt.building,38),unit=wrap(receipt.unit,38),urlLines=wrap(link,62);
 const buildingExtra=(building.length-1)*30,unitExtra=(unit.length-1)*28;
 const date=new Date(receipt.date+'T12:00:00').toLocaleDateString('tr-TR');
 const period=new Date(receipt.period+'-15T12:00:00').toLocaleDateString('tr-TR',{year:'numeric',month:'long'});
 const text=(x,y,value,size=22,fill='#243c36',weight=400)=>'<text x="'+x+'" y="'+y+'" font-size="'+size+'" fill="'+fill+'" font-weight="'+weight+'">'+escape(value)+'</text>';
 const bottom=610+buildingExtra+unitExtra,height=bottom+urlLines.length*19+75;
 return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="'+height+'" viewBox="0 0 800 '+height+'" role="img" aria-label="'+escape(receipt.number)+' ödeme makbuzu"><rect width="800" height="'+height+'" fill="#f7f8f3"/><rect x="24" y="24" width="752" height="'+(height-48)+'" rx="22" fill="white" stroke="#e1e8e2"/><g font-family="Arial, sans-serif">'+text(64,83,'ÖDEME MAKBUZU',17,'#154d43',700)+building.map((line,i)=>text(64,135+i*30,line,28,'#154d43',700)).join('')+text(64,180+buildingExtra,'Makbuz no: '+receipt.number,19,'#70827a')+'<path d="M64 '+(205+buildingExtra)+'H736" stroke="#e1e8e2"/>'+text(64,245+buildingExtra,'BÖLÜM',15,'#70827a')+unit.map((line,i)=>text(64,280+buildingExtra+i*28,line,24,'#243c36',600)).join('')+text(64,325+buildingExtra+unitExtra,'DÖNEM',15,'#70827a')+text(64,359+buildingExtra+unitExtra,period+(receipt.kind==='opening'?' · Devir borcu':''),23)+text(64,404+buildingExtra+unitExtra,'ÖDEME TARİHİ',15,'#70827a')+text(64,438+buildingExtra+unitExtra,date,23)+'<rect x="64" y="'+(466+buildingExtra+unitExtra)+'" width="672" height="88" rx="12" fill="#e6f1eb"/>'+text(84,498+buildingExtra+unitExtra,'TAHSİL EDİLEN',15,'#154d43')+text(84,533+buildingExtra+unitExtra,money(receipt.amount),30,'#154d43',700)+text(64,bottom-20,'Güncel ödeme kaydını kontrol edin:',16,'#70827a')+urlLines.map((line,i)=>text(64,bottom+6+i*19,line,15,'#154d43')).join('')+text(64,height-55,'Apartman ödeme kaydından oluşturulmuştur.',15,'#70827a')+'</g></svg>';
}
export async function downloadReceipt(receipt,link){
 const svg=receiptSvg(receipt,link),source=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Makbuz görseli oluşturulamadı.'));img.src=source;});
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth*2;canvas.height=img.naturalHeight*2;canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Makbuz indirilemedi.');
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=receipt.number+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }finally{URL.revokeObjectURL(source);}
}
