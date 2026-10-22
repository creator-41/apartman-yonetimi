import webpush from 'npm:web-push@3.6.7';
import {dispatch,secretMatches} from './handler.mjs';

const url=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function rpc(payload:Record<string,unknown>){
 const response=await fetch(url+'/rest/v1/rpc/apartman_push_worker',{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({payload}),signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)throw Error('Push worker unavailable');
 return await response.json();
}
Deno.serve(async request=>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 try{
  const token=request.headers.get('x-apartman-dispatch');
  if(!token||token.length!==64)return new Response('Unauthorized',{status:401});
  const config=await rpc({operation:'config'});
  if(!await secretMatches(token,config?.dispatch))return new Response('Unauthorized',{status:401});
  if(request.headers.get('x-apartman-check')==='encryption'){
   // Authenticated health check: exercise Deno/Node crypto using synthetic recipient keys.
   // Nothing is sent to a provider and no subscription or credential is returned.
   const recipient=webpush.generateVAPIDKeys();
   const auth=crypto.getRandomValues(new Uint8Array(16));
   const details=webpush.generateRequestDetails({endpoint:'https://fcm.googleapis.com/fcm/send/TEST',keys:{p256dh:recipient.publicKey,auth:btoa(String.fromCharCode(...auth))}},'Synthetic runtime check',{
    contentEncoding:'aes128gcm',vapidDetails:{subject:'https://creator-41.github.io/apartman-yonetimi/',publicKey:config.publicKey,privateKey:config.privateKey}
   });
   return Response.json({encryption:details.headers['Content-Encoding']==='aes128gcm',ciphertextBytes:details.body?.length||0},{headers:{'Cache-Control':'no-store'}});
  }
  const result=await dispatch({rpc,webpush});
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch{
  // Never log endpoints, credentials, tokens or payloads.
  return Response.json({error:'Bildirim gönderimi tamamlanamadı.'},{status:503});
 }
});
