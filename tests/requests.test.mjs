import test from 'node:test';
import assert from 'node:assert/strict';
import {requestPayload,sendRequest,requestStatus,requestLink,requestFromHash,requestChange} from '../public/requests.js';
import {createApi} from '../public/transport.js';
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
const input={requestId:id,unitId:'1',title:' Lamba arızası ',body:' İkinci kat merdiven lambası yanmıyor. ',location:' 2. kat '};
const photo={name:'foto.png',type:'image/png',size:120};
test('resident request validates unit, trimmed text and a single bounded photo',()=>{
 const p=requestPayload(input);assert.equal(p.unitId,1);assert.equal(p.title,'Lamba arızası');assert.equal(p.file,null);
 assert.deepEqual(requestPayload({...input,file:photo}).file,{fileName:'foto.png',mimeType:'image/png',bytes:120});
 for(const change of [{unitId:0},{title:'aa'},{body:'kısa'},{location:'x'.repeat(101)},{file:{...photo,type:'application/pdf'}},{file:{...photo,size:5242881}}])assert.throws(()=>requestPayload({...input,...change}));
});
test('request upload reuses its reservation and recovers a lost upload response',async()=>{
 const calls=[];const result=await sendRequest(async(path,method,data)=>{calls.push([path,data]);if(path==='requests/submit')return {id,token,path:id+'/'+token+'.png',uploaded:false};if(path==='request-files/upload')throw new Error('response lost');return {ok:true};},requestPayload({...input,file:photo}),photo);
 assert.equal(result.uploaded,true);assert.deepEqual(calls.map(c=>c[0]),['requests/submit','request-files/upload','requests/complete']);assert.deepEqual(calls[2][1],{id,token});
});
test('finished or photo-free retries skip transfer; uncertain upload failures stay frozen',async()=>{
 for(const result of [{id,token,path:null},{id,token,path:'reserved',uploaded:true}]){let calls=0;assert.equal(await sendRequest(async()=>{calls++;return result;},requestPayload(input)),result);assert.equal(calls,1);}
 await assert.rejects(()=>sendRequest(async path=>{if(path==='requests/submit')return {id,token,path:'reserved'};throw new Error('offline');},requestPayload({...input,file:photo}),photo),error=>error.message.includes('kaydedildi')&&!error.requestSubmissionRejected);
 await assert.rejects(()=>sendRequest(async()=>{throw Object.assign(new Error('rejected'),{status:400,code:'P0001'});},requestPayload(input)),error=>error.requestSubmissionRejected===true);
});
test('tracking capability is carried in fragment and rejects malformed or unrelated hashes',()=>{
 const link=requestLink('https://example.test/apartman/index.html?x=1',id,token);const url=new URL(link);
 assert.equal(url.pathname,'/apartman/');assert.equal(url.search,'');assert.deepEqual(requestFromHash(url.hash),{id,token});
 assert.equal(requestFromHash('#other=secret'),null);assert.equal(requestFromHash('#talep=bad'),null);assert.throws(()=>requestLink('https://example.test/',id,'invalid'));
 assert.equal(requestStatus('received'),'Alındı');assert.equal(requestStatus('in_progress'),'Yapılıyor');
 assert.deepEqual(requestChange({id,version:'v1',task_version:'t1'},{operation:'status',status:'done'}),{id,version:'v1',taskVersion:'t1',operation:'status',status:'done'});
});
test('requests use dedicated RPCs and a private photo bucket',async()=>{
 const calls=[],api=createApi({url:'https://example.supabase.co',key:'public',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/sign/')?{signedURL:'/object/sign/apartman-request-photos/'+id+'/'+token+'.png?token=test'}:{ok:true}};}});
 await api('requests');for(const action of ['submit','complete','track','manage'])await api('requests/'+action,'POST',{id,token});
 assert.deepEqual(calls.map(c=>c.url.split('/').pop()),['apartman_request_list','apartman_request_submit','apartman_request_complete','apartman_request_track','apartman_request_manage']);
 const path=id+'/'+token+'.png';await api('request-files/upload','POST',{path,file:photo});assert.equal(calls[5].options.body,photo);assert.equal(calls[5].options.headers['x-upsert'],'false');
 const result=await api('request-files/sign','POST',{path});assert.ok(result.url.startsWith('https://example.supabase.co/storage/v1/object/sign/apartman-request-photos/'));
 await assert.rejects(()=>api('request-files/upload','POST',{path:id+'/'+token+'.pdf',file:photo}),/Geçersiz/);
});
