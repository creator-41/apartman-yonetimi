// Only a static connection screen is cached. App code, sessions and financial data stay on the network.
const CACHE='komsu-apartman-offline-v1';
const ROOT=new URL('./',self.location.href);
const OFFLINE=new URL('offline.html',ROOT).href;
const ASSETS=[OFFLINE,new URL('offline.css',ROOT).href];
function notificationUrl(value){
 try{
  const candidate=new URL(value,ROOT);
  if(candidate.origin===ROOT.origin&&candidate.pathname===ROOT.pathname&&!candidate.search&&
    (!candidate.hash||/^#talep=[0-9a-f-]{36}\.[0-9a-f-]{36}$/.test(candidate.hash)||/^#yonetim-talep=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate.hash)))return candidate.href;
 }catch{}
 return ROOT.href;
}
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('komsu-apartman-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method==='GET'&&ASSETS.includes(url.href)){event.respondWith(caches.match(url.href).then(cached=>cached||fetch(request)));return;}
 if(request.method!=='GET'||request.mode!=='navigate'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 event.respondWith(fetch(request).catch(async()=>await caches.match(OFFLINE)||Response.error()));
});
self.addEventListener('push',event=>{
 let message={};try{message=event.data?.json()||{};}catch{/* Always display a visible, generic notification. */}
 const root=new URL('./',self.location.href);
 const url=notificationUrl(message.url);
 event.waitUntil(self.registration.showNotification('Komşu',{
  body:typeof message.body==='string'?message.body.slice(0,160):'Apartman ekranında yeni bir gelişme var.',
  icon:new URL('icons/icon-192.png',root).href,badge:new URL('icons/icon-192.png',root).href,
  tag:typeof message.tag==='string'?message.tag.slice(0,80):'komsu',data:{url}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=notificationUrl(event.notification.data?.url);
 event.waitUntil((async()=>{
  // Reuse this app's window so its tab-scoped administrator session is preserved.
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>{try{const u=new URL(client.url);return u.origin===ROOT.origin&&u.pathname===ROOT.pathname;}catch{return false;}});
  if(existing){try{const navigated=await existing.navigate(url);if(navigated)return await navigated.focus();}catch{/* Window closed; fall back to a new one. */}}
  return self.clients.openWindow(url);
 })());
});
