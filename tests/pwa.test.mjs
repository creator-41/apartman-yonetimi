import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {initPwa,installGuide} from '../public/pwa.js';
function setup({standalone=false,online=true}={}){
 const events={},nodes={installPanel:{},connectionStatus:{}},guides=[],statuses=[],registrations=[];
 const display={matches:standalone,addEventListener:(type,fn)=>events['display-'+type]=fn};
 const win={matchMedia:()=>display,addEventListener:(type,fn)=>events[type]=fn};
 const nav={onLine:online,userAgent:'Android',serviceWorker:{register:async(...args)=>{registrations.push(args)}}};
 const doc={readyState:'complete',querySelector:s=>nodes[s.slice(1)]};
 const install=initPwa({win,nav,doc,showGuide:x=>guides.push(x),showStatus:x=>statuses.push(x)});
 return {events,nodes,guides,statuses,registrations,install,nav,display};
}
test('Install prompt is deferred to a user gesture, consumed once, with menu fallback',async()=>{
 const s=setup();assert.equal(s.registrations[0][0],'./sw.js');assert.equal(s.nodes.installPanel.hidden,false);
 let prompted=0,prevented=0;s.events.beforeinstallprompt({preventDefault(){prevented++},prompt:async()=>prompted++,userChoice:Promise.resolve({outcome:'accepted'})});assert.equal(prompted,0);assert.equal(prevented,1);await s.install();assert.equal(prompted,1);assert.equal(s.guides.length,0);await s.install();assert.deepEqual(s.guides,['android']);
 s.events.appinstalled();assert(s.nodes.installPanel.hidden);assert.equal(s.statuses.length,1);
});
test('Standalone display hides installation and connection warning follows network state',()=>{
 const s=setup({standalone:true,online:false});assert(s.nodes.installPanel.hidden);assert.equal(s.nodes.connectionStatus.hidden,false);s.nav.onLine=true;s.events.online();assert(s.nodes.connectionStatus.hidden);assert.equal(installGuide('iPhone Safari'),'ios');assert.equal(installGuide('Desktop Firefox'),'desktop');
});
function worker(fetchImpl){
 const events={},cacheWrites=[],deleted=[];const cache={addAll:async items=>cacheWrites.push(...items)};
 const fallback={offline:true};vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,Response,fetch:fetchImpl,caches:{open:async()=>cache,match:async()=>fallback,keys:async()=>['another-app-cache','komsu-apartman-offline-v0','komsu-apartman-offline-v1'],delete:async key=>deleted.push(key)},self:{location:{href:'https://test/apartman/sw.js'},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
 return {events,cacheWrites,deleted,fallback};
}
test('Worker caches only a static offline page/style, and cleans only its own old cache',async()=>{
 const s=worker(async()=>({network:true}));let done;s.events.install({waitUntil:p=>done=p});await done;assert.deepEqual(s.cacheWrites,['https://test/apartman/offline.html','https://test/apartman/offline.css']);s.events.activate({waitUntil:p=>done=p});await done;assert.deepEqual(s.deleted,['komsu-apartman-offline-v0']);
});
test('Worker leaves API/auth/storage/mutations and unrelated app navigation untouched',()=>{
 const s=worker(async()=>({}));for(const request of [{url:'https://api.supabase.co/rest/v1/rpc/apartman_state',method:'POST',mode:'cors'},{url:'https://test/apartman/app.js',method:'GET',mode:'cors'},{url:'https://test/other/',method:'GET',mode:'navigate'},{url:'https://test/apartman/',method:'POST',mode:'navigate'}]){let intercepted=false;s.events.fetch({request,respondWith:()=>intercepted=true});assert(!intercepted);}
});
test('Online navigation always uses network; failed navigation and offline CSS use static fallback',async()=>{
 const online=worker(async()=>({network:true}));let result;online.events.fetch({request:{url:'https://test/apartman/?v=1',method:'GET',mode:'navigate'},respondWith:p=>result=p});assert.deepEqual(await result,{network:true});
 const offline=worker(async()=>{throw Error('Offline')});offline.events.fetch({request:{url:'https://test/apartman/receipt.html?payment=1',method:'GET',mode:'navigate'},respondWith:p=>result=p});assert.equal(await result,offline.fallback);offline.events.fetch({request:{url:'https://test/apartman/offline.css',method:'GET',mode:'no-cors'},respondWith:p=>result=p});assert.equal(await result,offline.fallback);
});
