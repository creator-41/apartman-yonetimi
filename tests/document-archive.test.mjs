import test from 'node:test';import assert from 'node:assert/strict';
import {archiveFields,filterDocuments,uploadArchiveDocument} from '../public/document-archive.js';import {createApi} from '../public/transport.js';
const file={name:'plan.pdf',size:120,type:'application/pdf'},id='11111111-1111-4111-8111-111111111111',fields={id,title:'Plan',category:'Yönetim planı',shared:false};
test('Archive filters Turkish names and file names, categories and removed documents without mutation',()=>{
 const rows=[{title:'YÖNETİM PLANI',file_name:'plan.pdf',category:'Yönetim planı',archived:false},{title:'Eski sözleşme',file_name:'sozlesme.pdf',category:'Sözleşme',archived:true}],before=JSON.stringify(rows);
 assert.equal(filterDocuments(rows,{query:'yönetim'}).length,1);assert.equal(filterDocuments(rows,{query:'PLAN.PDF',category:'Fatura'}).length,0);assert.equal(filterDocuments(rows,{archived:true}).length,1);assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(archiveFields(' Plan ','Yönetim planı',true),{title:'Plan',category:'Yönetim planı',shared:true});assert.throws(()=>archiveFields('','Diğer'));assert.throws(()=>archiveFields('A','invalid'));
});
test('Archive upload reserves, transfers and verifies using same ID and never writes financial records',async()=>{
 const calls=[];await uploadArchiveDocument(async(path,method,data)=>{calls.push({path,data});return {file:{id,path:id+'.pdf',uploaded:false}};},fields,file);
 assert.deepEqual(calls.map(c=>c.path),['documents/manage','archive-files/upload','documents/manage']);assert.equal(calls[0].data.id,id);assert.equal(calls[2].data.id,id);assert.equal(calls[0].data.shared,false);
 let count=0;await assert.rejects(uploadArchiveDocument(async()=>{count++;},fields,{...file,size:10485761}));assert.equal(count,0);
});
test('Archive upload recovers existing bytes after lost upload reply and skips already completed upload',async()=>{
 let calls=0;const saved=await uploadArchiveDocument(async(path,method,data)=>{calls++;if(path==='archive-files/upload')throw new Error('Reply lost');return {file:{id,path:id+'.pdf',uploaded:data.operation==='complete'}};},fields,file);assert.equal(saved.uploaded,true);assert.equal(calls,3);
 calls=0;await uploadArchiveDocument(async()=>{calls++;return {file:{uploaded:true}};},fields,file);assert.equal(calls,1);
});
test('Failed archive transfer preserves recoverable reservation and never deletes possibly stored bytes',async()=>{
 const calls=[];await assert.rejects(uploadArchiveDocument(async(path,method,data)=>{calls.push({path,data});if(path==='archive-files/upload')throw new Error('Offline');if(data.operation==='complete')throw new Error('No bytes');return {file:{path:id+'.pdf'}};},fields,file),/Offline/);
 assert.equal(calls.length,3);assert(!calls.some(c=>/remove|delete/.test(c.path)));
});
test('Archive storage transport enforces its own bucket, path and signed URL destination',async()=>{
 const calls=[],api=createApi({url:'https://test.supabase.co',key:'public',storage:{getItem:()=>null},fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({signedURL:'/object/sign/apartman-documents/'+id+'.pdf?token=test'})};}});
 await api('documents');await api('documents/manage','POST',{operation:'complete',id});const blob=new Blob(['abc'],{type:'application/pdf'});await api('archive-files/upload','POST',{path:id+'.pdf',file:blob});assert.equal(calls[2].options.body,blob);assert.equal(calls[2].options.headers['x-upsert'],'false');
 const signed=await api('archive-files/sign','POST',{path:id+'.pdf'});assert(signed.url.startsWith('https://test.supabase.co/storage/v1/object/sign/apartman-documents/'));
 await assert.rejects(api('archive-files/sign','POST',{path:'../secret.pdf'}),/Geçersiz/);
 const bad=createApi({url:'https://test.supabase.co',key:'public',storage:{getItem:()=>null},fetchImpl:async()=>({ok:true,json:async()=>({signedURL:'https://evil.test/file'})})});await assert.rejects(bad('archive-files/sign','POST',{path:id+'.pdf'}),/bağlantısı/);
});
