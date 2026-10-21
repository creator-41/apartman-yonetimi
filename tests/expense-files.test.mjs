import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateReceipt,expenseUpdate,uploadReceipt,removeReceipt,RECEIPT_LIMIT} from '../public/expense-files.js';
import {createApi} from '../public/transport.js';
const file={name:'fis.jpg',type:'image/jpeg',size:120};
const receipt={id:'12345678-1234-1234-1234-123456789abc',path:'7/12345678-1234-1234-1234-123456789abc.jpg'};
test('File validation rejects unsupported, empty and oversized files before reserving storage',async()=>{
 for(const bad of [null,{...file,size:0},{...file,type:'text/html'},{...file,size:RECEIPT_LIMIT+1},{...file,name:'x'.repeat(151)}])assert.throws(()=>validateReceipt(bad));
 let calls=0;await assert.rejects(uploadReceipt(async()=>{calls++},7,{...file,size:0}));assert.equal(calls,0);
 assert.deepEqual(validateReceipt(file),{fileName:'fis.jpg',mimeType:'image/jpeg',bytes:120});
});
test('Successful upload reserves, transfers and finalizes; never creates a financial expense',async()=>{
 const calls=[];const api=async(path,method,data)=>{calls.push({path,method,data});return {file:receipt};};
 await uploadReceipt(api,7,file);assert.deepEqual(calls.map(c=>c.path),['expenses/manage','files/upload','expenses/manage']);
 assert.equal(calls[0].data.operation,'reserve');assert.equal(calls[2].data.operation,'complete');assert.equal(calls[1].data.file,file);
});
test('Failed transfer is cleaned through Storage before metadata; original error is preserved',async()=>{
 const calls=[];const api=async(path,method,data)=>{calls.push({path,data});if(path==='files/upload')throw new Error('Bağlantı kesildi');return {file:receipt};};
 await assert.rejects(uploadReceipt(api,7,file),/Bağlantı kesildi/);
 assert.deepEqual(calls.map(c=>c.path),['expenses/manage','files/upload','files/remove','expenses/manage']);assert.equal(calls[3].data.operation,'remove');
});
test('Failed finalization does not leave an exposed file and failed cleanup remains actionable',async()=>{
 const calls=[];await assert.rejects(uploadReceipt(async(path,method,data)=>{
 calls.push({path,data});if(data.operation==='complete')throw new Error('Onay başarısız');if(path==='files/remove')throw new Error('Offline');return {file:receipt};},7,file),/Tamamlanmamış kaydı Belgeler/);
 assert(!calls.some(c=>c.data.operation==='visibility'));
});
test('Removing a file deletes actual bytes before removing metadata and never deletes its expense',async()=>{
 const calls=[];await removeReceipt(async(path,method,data)=>calls.push({path,method,data}),receipt);
 assert.deepEqual(calls.map(c=>c.path),['files/remove','expenses/manage']);assert.equal(calls[1].data.operation,'remove');
});
test('Expense editing freezes existing money and date for stale-write protection',()=>{
 const expense={id:7,category:'Elektrik',description:'Eski',amount:5000,date:'2026-10-01'};
 const payload=expenseUpdate(expense,{amount:60,date:'2026-09-30',description:'Yeni',category:'Elektrik'});expense.amount=9000;
 assert.equal(payload.expected.amount,5000);assert.equal(payload.amount,60);assert.equal(payload.expenseId,7);
});
test('Storage transport sends raw bytes, applies session refresh and validates signed URL destination',async()=>{
 const calls=[];const storage={getItem:()=>JSON.stringify({access_token:'session',refresh_token:'refresh',expires_at:9999999999}),setItem(){}};
 const api=createApi({url:'https://test.supabase.co',key:'public',storage,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({signedURL:'/object/sign/apartman-expense-files/'+receipt.path+'?token=test'})};}});
 const blob=new Blob(['abc'],{type:'image/jpeg'});await api('files/upload','POST',{path:receipt.path,file:blob});
 assert.equal(calls[0].options.body,blob);assert.equal(calls[0].options.headers.Authorization,'Bearer session');assert.equal(calls[0].options.headers['x-upsert'],'false');
 const signed=await api('files/sign','POST',{path:receipt.path});assert(signed.url.startsWith('https://test.supabase.co/storage/v1/object/sign/'));
 await assert.rejects(api('files/sign','POST',{path:'../../private'}),/Geçersiz/);
});
