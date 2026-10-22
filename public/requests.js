export const requestStatus=status=>({received:'Alındı',in_progress:'Yapılıyor',done:'Tamamlandı'})[status]||status;
export function requestPayload({requestId,unitId,title,body,location='',file}){
 const data={requestId,unitId:Number(unitId),title:String(title||'').trim(),body:String(body||'').trim(),location:String(location).trim(),file:null};
 if(!Number.isInteger(data.unitId)||data.unitId<1||data.title.length<3||data.title.length>100||data.body.length<10||data.body.length>2000||data.location.length>100)throw new Error('Daire, en az 3 karakter başlık ve en az 10 karakter açıklama girin.');
 if(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!Number.isInteger(file.size)||file.size<1||file.size>5242880||!file.name?.trim()||file.name.trim().length>150)throw new Error('Fotoğraf JPG, PNG veya WEBP ve en fazla 5 MB olmalıdır.');
  data.file={fileName:file.name.trim(),mimeType:file.type,bytes:file.size};
 }
 return data;
}
export async function sendRequest(api,payload,file){
 let result;
 try{result=await api('requests/submit','POST',payload);}catch(error){error.requestSubmissionRejected=error.status===400&&error.code==='P0001';throw error;}
 if(!result.path||result.uploaded)return result;
 let uploadError;
 try{await api('request-files/upload','POST',{path:result.path,file});}catch(error){uploadError=error;}
 try{await api('requests/complete','POST',{id:result.id,token:result.token});return {...result,uploaded:true};}
 catch(error){throw new Error('Talep '+result.id.slice(0,8)+' kaydedildi; fotoğraf tamamlanamadı. '+(uploadError?.message||error.message)+' Aynı formdan bilgileri değiştirmeden tekrar deneyin.');}
}
export function requestLink(page,id,token){
 if(!/^[0-9a-f-]{36}$/.test(id)||!/^[0-9a-f-]{36}$/.test(token))throw new Error('Geçersiz takip bilgisi.');
 const url=new URL('./',page);url.hash='talep='+id+'.'+token;return url.href;
}
export function requestFromHash(hash){
 const match=/^#talep=([0-9a-f-]{36})\.([0-9a-f-]{36})$/.exec(hash);return match?{id:match[1],token:match[2]}:null;
}
export function requestChange(row,changes){return {id:row.id,version:row.version,taskVersion:row.task_version,...changes};}
