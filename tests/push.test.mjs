import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createPush,pushSupport} from '../public/push.js';
import {allowedEndpoint,notificationPayload,dispatch,secretMatches} from '../supabase/functions/apartman-push/handler.mjs';
import {createApi} from '../public/transport.js';
import {adminRequestFromHash} from '../public/notification-links.js';
function fixture(){
 const values=new Map(),calls=[];let prompts=0,subscribed=0,unsubscribed=0;
 const sub={endpoint:'https://fcm.googleapis.com/fcm/send/device',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'PUBLIC',auth:'AUTH'}};},async unsubscribe(){unsubscribed++;return true;}};
 const win={isSecureContext:true,Notification:{permission:'granted',async requestPermission(){prompts++;return this.permission;}},PushManager:{},crypto,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},matchMedia:()=>({matches:false})};
 const nav={userAgent:'Android',serviceWorker:{ready:Promise.resolve({pushManager:{getSubscription:async()=>sub,subscribe:async()=>{subscribed++;return sub;}}})}};
 const api=async(...args)=>{calls.push(args);return {ok:true};};
 return {win,nav,calls,values,create:()=>createPush({api,publicKey:'BAAA',win,nav}),counts:()=>({prompts,subscribed,unsubscribed})};
}
test('Push is opt-in; no startup permission prompt, admin/request sync and device-only opt-out',async()=>{
 const f=fixture(),p=f.create();assert.equal(await p.sync(),false);assert.equal(f.counts().prompts,0);assert.equal(f.calls.length,0);
 await p.enable({admin:true,access:{id:'request',token:'capability'}});assert(p.enabled());assert.equal(f.counts().prompts,1);
 assert.equal(f.calls[0][2].admin,true);assert.equal(f.calls[0][2].request.token,'capability');
 await p.sync({admin:false});assert.equal(f.calls.at(-1)[2].admin,false);
 await p.test();assert.equal(f.calls.at(-1)[2].operation,'test');
 await p.disable();assert.equal(f.calls.at(-1)[2].operation,'remove');assert.equal(f.counts().unsubscribed,1);
 const count=f.calls.length;await f.create().sync();assert.equal(f.calls.length,count);assert(!p.enabled());
});
test('Denied and iPhone non-installed contexts explain setup without creating subscriptions',async()=>{
 const f=fixture();f.win.Notification.permission='denied';await assert.rejects(()=>f.create().enable(),/izni kapalı/);assert.equal(f.calls.length,0);
 f.nav.userAgent='iPhone';assert.equal(pushSupport(f.win,f.nav),'install');await assert.rejects(()=>f.create().enable(),/ana ekrana/);
 f.nav.standalone=true;assert.equal(pushSupport(f.win,f.nav),'supported');
});
test('Endpoint allowlist rejects SSRF, credentials, arbitrary ports, suffix attacks and insecure URLs',()=>{
 for(const u of ['https://fcm.googleapis.com/send/a','https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/a'])assert(allowedEndpoint(u));
 for(const u of ['http://fcm.googleapis.com/a','https://fcm.googleapis.com.evil.test/a','https://localhost/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a','https://fcm.googleapis.com/a#secret'])assert(!allowedEndpoint(u));
});
test('Generic encrypted payload excludes ledger and complaint details; private link only for own reply',async()=>{
 const job={id:3,kind:'payment',amount:99999,body:'SECRET',unit:'PRIVATE'};
 assert.doesNotMatch(JSON.stringify(notificationPayload(job)),/SECRET|PRIVATE|99999/);
 assert(!notificationPayload({...job,requestId:'a'.repeat(36),requestToken:'b'.repeat(36)}).url.includes('#'));
 assert.match(notificationPayload({...job,kind:'reply',requestId:'a'.repeat(36),requestToken:'b'.repeat(36)}).url,/#talep=/);
 assert(await secretMatches('abc','abc'));assert(!await secretMatches('abc','abd'));assert(!await secretMatches(null,'abc'));
});
test('Dispatcher acknowledges only actual provider response, avoids redirects and isolates retry failures',async()=>{
 const finished=[],sent=[];
 const jobs=[201,410,503].map((status,i)=>({id:i+1,lease:'lease'+i,kind:'notice',subscription:{endpoint:'https://fcm.googleapis.com/'+status}}));
 const rpc=async p=>p.operation==='config'?{publicKey:'pub',privateKey:'secret'}:p.operation==='claim'?jobs:finished.push(p);
 const webpush={generateRequestDetails:(sub,payload,options)=>{assert.equal(options.contentEncoding,'aes128gcm');assert.doesNotMatch(payload,/privateKey|secret/);return {endpoint:sub.endpoint,method:'POST',headers:{},body:'ENCRYPTED'};}};
 const result=await dispatch({rpc,webpush,fetchImpl:async(url,opts)=>{sent.push(opts);return {status:Number(url.split('/').at(-1))};}});
 assert.deepEqual(result,{processed:3,accepted:1,failed:2});assert.deepEqual(finished.map(p=>p.status),[201,410,503]);assert(sent.every(x=>x.redirect==='error'&&x.body==='ENCRYPTED'));
});
test('Worker push displays a visible generic notification and constrains click targets to this app',async()=>{
 const events={},shown=[],opened=[];let done;
 vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,Response,self:{location:{href:'https://example.test/apartman/sw.js'},addEventListener:(n,fn)=>events[n]=fn,registration:{showNotification:async(...x)=>shown.push(x)},clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}}});
 events.push({data:{json:()=>({body:'Yeni bir duyuru yayınlandı.',url:'https://evil.test/'})},waitUntil:p=>done=p});await done;
 assert.equal(shown[0][0],'Komşu');assert.equal(shown[0][1].data.url,'https://example.test/apartman/');
 events.notificationclick({notification:{close(){},data:{url:'https://evil.test/'}},waitUntil:p=>done=p});await done;assert.equal(opened[0],'https://example.test/apartman/');
});
test('Push transport uses the capability-guarded device RPC',async()=>{
 let sent;const api=createApi({url:'https://test',key:'public',fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({ok:true})};}});
 await api('push/device','POST',{id:'device',token:'secret',operation:'remove'});assert.equal(sent.url,'https://test/rest/v1/rpc/apartman_push_device');assert.equal(sent.body.payload.operation,'remove');
});
test('Administrator request notifications carry the exact record ID without a resident capability',()=>{
 const id='95f4f474-56fe-4e6f-8d5c-a1753341fd91';
 const payload=notificationPayload({id:1,kind:'request',requestId:id,requestToken:'SECRET'});
 assert.equal(payload.url,'https://creator-41.github.io/apartman-yonetimi/#yonetim-talep='+id);
 assert.doesNotMatch(JSON.stringify(payload),/SECRET/);assert.equal(adminRequestFromHash('#yonetim-talep='+id),id);
 assert.equal(adminRequestFromHash('#yonetim-talep=bad'),null);assert.equal(adminRequestFromHash('#yonetim-talep='+id+'&other=1'),null);
});
test('Notification click navigates and focuses the existing app window, preserving its session',async()=>{
 const events={},actions=[];let done;
 const target='https://example.test/apartman/#yonetim-talep=95f4f474-56fe-4e6f-8d5c-a1753341fd91';
 const client={url:'https://example.test/apartman/?source=app',navigate:async url=>{actions.push(['navigate',url]);return client;},focus:async()=>actions.push(['focus'])};
 vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,Response,self:{location:{href:'https://example.test/apartman/sw.js'},addEventListener:(n,fn)=>events[n]=fn,registration:{showNotification:async()=>{}},clients:{matchAll:async()=>[{url:'https://example.test/other/'},client],openWindow:async u=>actions.push(['open',u])}}});
 events.notificationclick({notification:{close(){},data:{url:target}},waitUntil:p=>done=p});await done;
 assert.deepEqual(actions,[['navigate',target],['focus']]);
});
