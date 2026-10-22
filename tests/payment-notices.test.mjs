import test from 'node:test';
import assert from 'node:assert/strict';
import { noticePayload, sendPaymentNotice, waitingNotices, noticeStatus } from '../public/payment-notices.js';
import { createApi } from '../public/transport.js';
const day='2026-10-22',id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
const values={requestId:id,unitId:1,amount:'12.50',date:day,note:' test '};
const file={name:'test.pdf',type:'application/pdf',size:120};
test('notice payload validates date, amount and optional restricted receipt before submission',()=>{
 assert.deepEqual(noticePayload(values,day),{...values,amount:12.5,note:'test',file:null});
 assert.deepEqual(noticePayload({...values,file},day).file,{fileName:'test.pdf',mimeType:'application/pdf',bytes:120});
 for(const change of [{unitId:0},{amount:0},{amount:Infinity},{date:'2026-02-30'},{date:'2026-10-23'},{note:'x'.repeat(201)},{file:{...file,size:5242881}},{file:{...file,type:'text/html'}},{file:{...file,size:0}}])assert.throws(()=>noticePayload({...values,...change},day));
});
test('no-file notice never calls financial APIs or storage',async()=>{
 const calls=[],api=async(...args)=>{calls.push(args);return {ok:true,id,status:'pending'};};
 const result=await sendPaymentNotice(api,noticePayload(values,day));
 assert.equal(result.status,'pending');assert.deepEqual(calls.map(c=>c[0]),['payment-notices/submit']);
});
test('receipt upload finalizes reserved claim; replay never uploads or creates another claim',async()=>{
 const calls=[],api=async(path,method,data)=>{calls.push([path,data]);return path.endsWith('/submit')?{id,token,path:id+'/'+token+'.pdf',status:'uploading'}:{id,status:'pending'};};
 await sendPaymentNotice(api,noticePayload({...values,file},day),file);
 assert.deepEqual(calls.map(c=>c[0]),['payment-notices/submit','notice-files/upload','payment-notices/complete']);
 assert.deepEqual(calls[2][1],{id,token});
 let count=0;await sendPaymentNotice(async()=>{count++;return {id,status:'approved'};},noticePayload({...values,file},day),file);assert.equal(count,1);
});
test('lost upload response is recovered through completion; unfinished upload remains retryable',async()=>{
 const paths=[];
 const result=await sendPaymentNotice(async path=>{paths.push(path);if(path.endsWith('/submit'))return {id,token,status:'uploading',path:id+'/'+token+'.pdf'};if(path==='notice-files/upload')throw new Error('response lost');return {id,status:'pending'};},noticePayload({...values,file},day),file);
 assert.equal(result.status,'pending');assert.equal(paths.length,3);
 await assert.rejects(()=>sendPaymentNotice(async path=>{if(path.endsWith('/submit'))return {id,token,status:'uploading'};throw new Error('offline');},noticePayload({...values,file},day),file),/Aynı formdaki bilgileri değiştirmeden/);
});
test('waiting queue and Turkish statuses include unfinished uploads',()=>{
 const rows=['approved','uploading','rejected','pending'].map(status=>({status}));assert.deepEqual(waitingNotices(rows).map(r=>r.status),['uploading','pending']);assert.equal(rows.length,4);assert.equal(noticeStatus('pending'),'Onay bekliyor');
});
test('notice RPCs and dedicated private bucket routes do not use expense or payment writes',async()=>{
 const calls=[];const api=createApi({url:'https://example.supabase.co',key:'public-key',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/sign/')?{signedURL:'/object/sign/apartman-payment-notices/'+id+'/'+token+'.pdf?token=test'}:{ok:true}};}});
 await api('payment-notices');await api('payment-notices/submit','POST',values);await api('payment-notices/complete','POST',{id,token});await api('payment-notices/review','POST',{id,operation:'reject'});
 assert.deepEqual(calls.map(c=>c.url.split('/').pop()),['apartman_notice_list','apartman_notice_submit','apartman_notice_complete','apartman_notice_review']);
 const path=id+'/'+token+'.pdf';await api('notice-files/upload','POST',{path,file});assert.equal(calls[4].options.body,file);assert.equal(calls[4].options.headers['x-upsert'],'false');assert.equal(calls[4].options.headers.Authorization,undefined);
 const link=await api('notice-files/sign','POST',{path});assert.ok(link.url.startsWith('https://example.supabase.co/storage/v1/object/sign/apartman-payment-notices/'));
 await assert.rejects(()=>api('notice-files/upload','POST',{path:'../private.pdf',file}),/Geçersiz/);
});

test('only explicit Postgres submission rejection permits correcting the frozen form',async()=>{
 const api=createApi({url:'https://example.supabase.co',key:'public-key',fetchImpl:async()=>({ok:false,status:400,json:async()=>({code:'P0001',message:'too much'})})});
 await assert.rejects(()=>sendPaymentNotice(api,noticePayload(values,day)),error=>error.noticeSubmissionRejected===true&&error.code==='P0001'&&error.status===400);
 for(const attributes of [{status:500,code:'P0001'},{status:400},{}, {status:400,code:'PGRST000'}]){
  await assert.rejects(()=>sendPaymentNotice(async()=>{throw Object.assign(new Error('unknown'),attributes);},noticePayload(values,day)),error=>error.noticeSubmissionRejected===false);
 }
 await assert.rejects(()=>sendPaymentNotice(async path=>{if(path.endsWith('/submit'))return {id,token,status:'uploading',path:id+'/'+token+'.pdf'};throw Object.assign(new Error('file incomplete'),{status:400,code:'P0001'});},noticePayload({...values,file},day),file),error=>!error.noticeSubmissionRejected);
});
