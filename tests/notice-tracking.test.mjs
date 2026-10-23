import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoticeBook,NOTICE_TRACKING_KEY} from '../public/notice-tracking.js';
import {createApi} from '../public/transport.js';
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
test('Notice tracking persists only scoped credentials, merges tabs, filters units, and drops definite rejections',()=>{
 const values=new Map(),host={localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};
 const book=createNoticeBook(host),another=createNoticeBook(host);
 assert.equal(book.remember({id,token,unitId:1,amount:100,note:'private',status:'pending'}),true);
 assert.deepEqual(JSON.parse(values.get(NOTICE_TRACKING_KEY)),[{id,token,unitId:1}]);
 another.remember({id:token,token:id,unitId:2});assert.equal(book.entries(2).length,1);
 assert.deepEqual(createNoticeBook(host).entries(1),[{id,token,unitId:1}]);
 assert.throws(()=>book.remember({id:'bad',token,unitId:1}),/Geçersiz/);
 book.forget(id);assert.equal(book.entries(1).length,0);assert.equal(book.entries(2).length,1);
});
test('Blocked storage still permits tracking this page and malformed saved credentials are ignored',()=>{
 const host={get localStorage(){throw new Error('blocked');}},book=createNoticeBook(host);
 assert.equal(book.remember({id,token,unitId:1}),false);assert.equal(book.entries(1).length,1);
 book.forget(id);assert.equal(book.entries(1).length,0);
 for(const raw of ['broken','{}','[null]',JSON.stringify([{id:'bad',token,unitId:1}])]){
  assert.equal(createNoticeBook({localStorage:{getItem:()=>raw}}).entries(1).length,0);
 }
});
test('Tracking uses its read-only RPC with paired credentials instead of a unit-based listing',async()=>{
 let call;const api=createApi({url:'https://example.supabase.co',key:'public',fetchImpl:async(url,options)=>{call={url,options};return {ok:true,json:async()=>[]};}});
 await api('payment-notices/track','POST',[{id,token}]);
 assert.ok(call.url.endsWith('/rpc/apartman_notice_track'));
 assert.deepEqual(JSON.parse(call.options.body),{payload:[{id,token}]});
});
