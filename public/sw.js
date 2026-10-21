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
