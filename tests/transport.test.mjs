import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../public/transport.js';
import {sessionStorageFor,SESSION_KEY} from '../public/session-storage.js';
const ok=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function setup(responder,saved=null){
 const map=new Map(saved?[['komsu-apartman-session-v1',JSON.stringify(saved)]]:[]),calls=[];
 const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const api=createApi({url:'https://test.supabase.co',key:'sb_publishable_test',storage,now:()=>1000000,fetchImpl:async(url,options)=>{
   const call={url,headers:options.headers,body:options.body?JSON.parse(options.body):undefined};calls.push(call);return responder(call,calls);
 }});
 return {api,calls,map};
}
test('Anonymous state sends publishable key without a fake bearer',async()=>{
 const {api,calls}=setup(()=>ok({admin:false}));
 assert.equal((await api('state')).admin,false);
 assert.equal(calls[0].headers.apikey,'sb_publishable_test');assert.equal(calls[0].headers.Authorization,undefined);
 assert.match(calls[0].url,/rpc\/apartman_state$/);
});
test('Login, administrator RPC mapping, and local logout',async()=>{
 const {api,calls,map}=setup(c=>c.url.includes('grant_type=password')?ok({access_token:'a',refresh_token:'r',expires_at:5000}):c.url.includes('apartman_state')?ok({admin:true}):ok({ok:true}));
 await api('login','POST',{email:'owner@example.com',password:'test-password'});
 await api('units/2','PUT',{label:'Daire 2',exempt:true});
 assert.deepEqual(calls[2].body,{action:'unit',payload:{id:2,label:'Daire 2',exempt:true}});
 assert.equal(calls[2].headers.Authorization,'Bearer a');
 await api('payments/4','DELETE',{});assert.deepEqual(calls[3].body,{action:'delete-payment',payload:{id:4}});
 await api('backup');assert.match(calls[4].url,/rpc\/apartman_backup$/);
 await api('logout','POST',{});assert.equal(map.size,0);assert.match(calls[5].url,/logout\?scope=local$/);
});
test('Club user without apartment membership is logged out and rejected',async()=>{
 const {api,map}=setup(c=>c.url.includes('grant_type=password')?ok({access_token:'a',refresh_token:'r',expires_at:5000}):c.url.includes('apartman_state')?ok({admin:false}):ok({}));
 await assert.rejects(api('login','POST',{email:'club@example.com',password:'test'}),/yetkisi yok/);assert.equal(map.size,0);
});
test('Concurrent requests share one token refresh',async()=>{
 const {api,calls}=setup(c=>c.url.includes('refresh_token')?ok({access_token:'new',refresh_token:'new-r',expires_at:5000}):ok({admin:true}),{access_token:'old',refresh_token:'old-r',expires_at:900});
 await Promise.all([api('state'),api('state')]);assert.equal(calls.filter(c=>c.url.includes('refresh_token')).length,1);
 assert.ok(calls.filter(c=>c.url.includes('/rpc/')).every(c=>c.headers.Authorization==='Bearer new'));
});
test('Rejected refresh clears session; network failure preserves it',async()=>{
 const {api,map}=setup(()=>ok({error_description:'Expired'},400),{access_token:'old',refresh_token:'r',expires_at:900});
 await assert.rejects(api('state'),/Expired/);assert.equal(map.size,0);
 const retry=setup(()=>{throw new Error('offline');},{access_token:'old',refresh_token:'r',expires_at:900});
 await assert.rejects(retry.api('state'),/offline/);assert.equal(retry.map.size,1);
});
test('Database authorization errors are surfaced',async()=>{
 const {api,calls}=setup(()=>ok({message:'Apartman yöneticisi yetkisi gerekli.'},403));
 await assert.rejects(api('charges','POST',{amount:500,period:'2026-10'}),/yetkisi gerekli/);assert.equal(calls.length,1);
});
test('Existing tab session migrates once to persistent storage, isolated from club credentials',()=>{
 const old=JSON.stringify({access_token:'access',refresh_token:'refresh',expires_at:5000});
 const persistent=new Map([['acisu-session','CLUB']]),tab=new Map([[SESSION_KEY,old]]);
 const store=map=>({getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 const win={localStorage:store(persistent),sessionStorage:store(tab)};
 assert.equal(sessionStorageFor(win),win.localStorage);assert.equal(persistent.get(SESSION_KEY),old);assert(!tab.has(SESSION_KEY));assert.equal(persistent.get('acisu-session'),'CLUB');
 assert.equal(sessionStorageFor({get localStorage(){throw Error('blocked');},sessionStorage:win.sessionStorage}),win.sessionStorage);
});
test('Reopened app restores persisted login and logout clears another open instance',async()=>{
 const {api,map}=setup(c=>c.url.includes('grant_type=password')?ok({access_token:'a',refresh_token:'r',expires_at:5000}):ok({admin:true}));
 await api('login','POST',{email:'test@example.test',password:'temporary-input'});
 const calls=[],storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const reopened=createApi({url:'https://test',key:'public',storage,now:()=>1000000,fetchImpl:async(url,options)=>{calls.push(options.headers.Authorization);return ok({admin:true});}});
 await reopened('state');assert.equal(calls.at(-1),'Bearer a');assert(!map.get(SESSION_KEY).includes('temporary-input'));
 await api('logout','POST',{});await reopened('state');assert.equal(calls.at(-1),undefined);
});
test('Two app instances serialize refresh and reuse the rotated persistent session',async()=>{
 const map=new Map([[SESSION_KEY,JSON.stringify({access_token:'old',refresh_token:'old-r',expires_at:900})]]);
 const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 let chain=Promise.resolve(),refreshes=0;
 const sessionLock=fn=>{const result=chain.then(fn);chain=result.catch(()=>{});return result;};
 const opts={url:'https://test',key:'pub',storage,sessionLock,now:()=>1000000,fetchImpl:async(url,options)=>{
  if(url.includes('refresh_token')){refreshes++;return ok({access_token:'new',refresh_token:'new-r',expires_at:5000});}
  assert.equal(options.headers.Authorization,'Bearer new');return ok({admin:true});
 }};
 await Promise.all([createApi(opts)('state'),createApi(opts)('state')]);assert.equal(refreshes,1);
});
