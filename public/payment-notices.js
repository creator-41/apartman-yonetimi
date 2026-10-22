const types=['image/jpeg','image/png','image/webp','application/pdf'];
export function noticePayload({requestId,unitId,amount,date,note='',file},today){
 const n=Number(amount);
 if(!Number.isInteger(Number(unitId))||Number(unitId)<1)throw new Error('Dairenizi seçin.');
 if(!Number.isFinite(n)||n<0.01||n>10000000)throw new Error('Geçerli tutar girin.');
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||date>today||Number.isNaN(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Geçerli ödeme tarihi girin; tarih gelecekte olamaz.');
 if(note.trim().length>200)throw new Error('Not en fazla 200 karakter olabilir.');
 let metadata=null;
 if(file){
  if(!types.includes(file.type)||!Number.isInteger(file.size)||file.size<1||file.size>5242880)throw new Error('Dekont JPG, PNG, WEBP veya PDF ve en fazla 5 MB olmalıdır.');
  if(!file.name?.trim()||file.name.trim().length>150)throw new Error('Dosya adı 1–150 karakter olmalıdır.');
  metadata={fileName:file.name.trim(),mimeType:file.type,bytes:file.size};
 }
 return {requestId,unitId:Number(unitId),amount:n,date,note:note.trim(),file:metadata};
}
// A retry reuses the reservation and finishes an upload whose response may have been lost.
export async function sendPaymentNotice(api,payload,file){
 let result;
 try{result=await api('payment-notices/submit','POST',payload);}
 catch(error){
  // A Postgres validation exception aborts the RPC transaction: no claim was inserted.
  error.noticeSubmissionRejected=error.status===400&&error.code==='P0001';
  throw error;
 }
 if(result.status!=='uploading')return result;
 let uploadError;
 try{await api('notice-files/upload','POST',{path:result.path,file});}catch(error){uploadError=error;}
 try{return await api('payment-notices/complete','POST',{id:result.id,token:result.token});}
 catch(error){throw new Error((uploadError?.message||error.message)+' Aynı formdaki bilgileri değiştirmeden tekrar deneyin.');}
}
export function waitingNotices(rows){return rows.filter(n=>['pending','uploading'].includes(n.status));}
export function noticeStatus(status){return {uploading:'Dekont tamamlanmadı',pending:'Onay bekliyor',approved:'Onaylandı',rejected:'Reddedildi'}[status]||'Bilinmeyen durum';}
