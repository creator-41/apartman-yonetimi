// Only a static connection screen is cached. App code, sessions and financial data stay on the network.
const CACHE='komsu-apartman-offline-v1';
const ROOT=new URL('./',self.location.href);
const OFFLINE=new URL('offline.html',ROOT).href;
const ASSETS=[OFFLINE,new URL('offline.css',ROOT).href];
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
 let url=root.href;
 try{const candidate=new URL(message.url,root);if(candidate.origin===root.origin&&candidate.pathname===root.pathname&&(!candidate.hash||/^#talep=[0-9a-f-]{36}\.[0-9a-f-]{36}$/.test(candidate.hash))&&!candidate.search)url=candidate.href;}catch{}
 event.waitUntil(self.registration.showNotification('Komşu',{
  body:typeof message.body==='string'?message.body.slice(0,160):'Apartman ekranında yeni bir gelişme var.',
  icon:new URL('icons/icon-192.png',root).href,badge:new URL('icons/icon-192.png',root).href,
  tag:typeof message.tag==='string'?message.tag.slice(0,80):'komsu',data:{url}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const root=new URL('./',self.location.href);let url=root.href;
 try{const candidate=new URL(event.notification.data?.url,root);if(candidate.origin===root.origin&&candidate.pathname===root.pathname&&!candidate.search&&(!candidate.hash||/^#talep=[0-9a-f-]{36}\.[0-9a-f-]{36}$/.test(candidate.hash)))url=candidate.href;}catch{}
 // A new app window processes the private tracking fragment through the normal guarded RPC.
 event.waitUntil(self.clients.openWindow(url));
});
