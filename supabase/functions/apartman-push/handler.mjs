const ROOT='https://creator-41.github.io/apartman-yonetimi/';
export function allowedEndpoint(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&
 /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(u.hostname);}
 catch{return false;}
}
export function notificationPayload(job){
 const bodies={notice:'Yeni bir duyuru yayınlandı.',decision:'Yeni bir yönetim kararı yayınlandı.',payment:'Yeni bir ödeme bildirimi var.',request:'Yeni bir arıza / talep var.',reply:'Talebinizin durumu veya yönetim yanıtı güncellendi.',test:'Bildirimler bu cihazda çalışıyor.'};
 let url=ROOT;
 if(job.kind==='request'&&/^[0-9a-f-]{36}$/.test(job.requestId))url+='#yonetim-talep='+job.requestId;
 if(job.kind==='reply'&&/^[0-9a-f-]{36}$/.test(job.requestId)&&/^[0-9a-f-]{36}$/.test(job.requestToken))url+='#talep='+job.requestId+'.'+job.requestToken;
 return {title:'Komşu',body:bodies[job.kind]||'Apartman ekranında yeni bir gelişme var.',tag:'komsu-'+job.id,url};
}
export async function dispatch({rpc,webpush,fetchImpl=fetch}){
 const config=await rpc({operation:'config'});
 if(!config?.publicKey||!config?.privateKey)throw Error('Push configuration unavailable');
 const jobs=await rpc({operation:'claim'});
 let accepted=0,failed=0;
 // A bounded batch and per-request timeout fit within Edge execution limits.
 for(let start=0;start<jobs.length;start+=5){
  await Promise.all(jobs.slice(start,start+5).map(async job=>{
   let status=400;
   try{
    if(!allowedEndpoint(job.subscription?.endpoint))throw Error('Invalid endpoint');
    const request=webpush.generateRequestDetails(job.subscription,JSON.stringify(notificationPayload(job)),{
     TTL:86400,urgency:'normal',vapidDetails:{subject:ROOT,publicKey:config.publicKey,privateKey:config.privateKey},contentEncoding:'aes128gcm'
    });
    const response=await fetchImpl(request.endpoint,{method:request.method,headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(8000)});
    status=response.status;await response.body?.cancel();
   }catch{status=503;}
   await rpc({operation:'finish',id:job.id,lease:job.lease,status});
   if(status>=200&&status<300)accepted++;else failed++;
  }));
 }
 return {processed:jobs.length,accepted,failed};
}
export async function secretMatches(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length>256||!a)return false;
 const enc=new TextEncoder(),hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)));
 const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
