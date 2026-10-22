const DEVICE_KEY='komsu-push-device-v1';
export function pushSupport(win,nav){
 const ios=/iPad|iPhone|iPod/.test(nav.userAgent)||(/Macintosh/.test(nav.userAgent)&&nav.maxTouchPoints>1);
 if(ios&&!nav.standalone&&!win.matchMedia?.('(display-mode: standalone)').matches)return 'install';
 return win.isSecureContext&&'Notification' in win&&'PushManager' in win&&'serviceWorker' in nav?'supported':'unsupported';
}
export function applicationKey(value){
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function createPush({api,publicKey,win=window,nav=navigator}){
 let local,device=null,enabled=false,lastSync='',request=null,syncing=Promise.resolve(),disabling=false;
 try{local=win.localStorage;device=JSON.parse(local.getItem(DEVICE_KEY)||'null');}catch{/* Explicit setup will explain unavailable storage. */}
 if(!device?.id||!device?.token)device=null;
 const registration=()=>nav.serviceWorker.ready;
 const support=()=>pushSupport(win,nav);
 async function performSync({admin=false,access=null,force=false}={}){
  if(access)request=access;
  if(!device||device.disabled||disabling||support()!=='supported')return false;
  const reg=await registration(),sub=await reg.pushManager.getSubscription();
  if(!sub||win.Notification.permission!=='granted'){
   await api('push/device','POST',{...device,operation:'remove'});enabled=false;lastSync='';return false;
  }
  const marker=JSON.stringify([admin,request,sub.endpoint]);
  if(force||marker!==lastSync){await api('push/device','POST',{...device,subscription:sub.toJSON(),admin,request});lastSync=marker;}
  enabled=true;return true;
 }
 const sync=options=>{syncing=syncing.catch(()=>{}).then(()=>performSync(options));return syncing;};
 return {
  support,enabled:()=>enabled,
  async enable({admin=false,access=null}={}){
   if(support()==='install')throw Error('iPhone’da önce siteyi ana ekrana ekleyip uygulama simgesinden açın.');
   if(support()!=='supported')throw Error('Bu tarayıcı telefon bildirimlerini desteklemiyor.');
   if(!publicKey)throw Error('Bildirim altyapısı henüz hazır değil.');
   // Request immediately from the user's click, before awaiting registration or network.
   const permission=await win.Notification.requestPermission();
   if(permission!=='granted')throw Error(permission==='denied'?'Bildirim izni kapalı. Tarayıcı veya telefon ayarlarından açabilirsiniz.':'Bildirim izni verilmedi.');
   if(!device){
    device={id:win.crypto.randomUUID(),token:win.crypto.randomUUID()};
    try{local.setItem(DEVICE_KEY,JSON.stringify(device));}catch{device=null;throw Error('Bildirimleri açmak için bu sitede cihaz depolamasına izin verin.');}
   }
   device.disabled=false;local.setItem(DEVICE_KEY,JSON.stringify(device));
   const reg=await registration();
   let sub=await reg.pushManager.getSubscription();
   if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(publicKey)});
   try{await sync({admin,access,force:true});}catch{enabled=false;throw Error('Cihaz kaydedilemedi. Bildirimleri aç düğmesiyle tekrar deneyin.');}
  },
  sync,
  async disable(){
   disabling=true;
   try{
    await syncing.catch(()=>{});
    if(device)await api('push/device','POST',{...device,operation:'remove'});
    if(device){device.disabled=true;local.setItem(DEVICE_KEY,JSON.stringify(device));}
    enabled=false;lastSync='';
    const reg=support()==='supported'?await registration():null,sub=await reg?.pushManager.getSubscription();
    if(sub)await sub.unsubscribe();
    // Keep the device secret for safe retry if the browser cannot unsubscribe immediately.
   }finally{disabling=false;}
  },
  async test(){if(!enabled||!device)throw Error('Önce bildirimleri açın.');await api('push/device','POST',{...device,operation:'test'});}
 };
}
