import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIban,formatIban,reminderText} from '../public/payment-tools.js';
import {createApi} from '../public/transport.js';
const bban='0'.repeat(22),iban='TR'+String(98n-BigInt(bban+'292700')%97n).padStart(2,'0')+bban;
test('Turkish IBAN handles spaces and case, checks checksum and permits clearing',()=>{
 assert.equal(normalizeIban(formatIban(iban).toLowerCase()),iban);assert.equal(normalizeIban(' '),'');
 for(const v of ['TR12','DE'+iban.slice(2),'TR00'+bban,iban+'0','TRXX'+bban])assert.throws(()=>normalizeIban(v));
});
const state={settings:{name:'Test Apartmanı',iban,accountHolder:'Test Yönetimi'},units:[{id:1,label:'Daire 1',owner:'PRIVATE_OWNER'},{id:2,label:'Daire 2'}],charges:[{id:1,unit_id:1,period:'2026-08',amount:50000,paid:20000,kind:'opening',note:'PRIVATE_NOTE'},{id:2,unit_id:1,period:'2026-10',amount:50000,paid:10000},{id:3,unit_id:1,period:'2026-09',amount:50000,paid:50000},{id:4,unit_id:2,period:'2026-10',amount:90000,paid:0}]};
test('Reminder includes older debt and partial payments, excludes fully paid and other units/private fields',()=>{
 const text=reminderText(state,1,'2026-10-21');assert.match(text,/21\.10\.2026/);assert.match(text,/Ağustos 2026 \(devir borcu\)/);assert.match(text,/Ekim 2026/);assert.match(text,/700,00/);assert.match(text,/Test Yönetimi/);assert.match(text,/Ödeme açıklaması: Daire 1 aidat/);
 assert.doesNotMatch(text,/PRIVATE|Daire 2|Eylül/);assert.equal(state.charges[0].paid,20000);
});
test('Reminder works without bank details and blocks unknown or debt-free units',()=>{
 const s={...state,settings:{name:'Test'},units:[...state.units,{id:3,label:'Daire 3'}]};assert.doesNotMatch(reminderText(s,1,'2026-10-21'),/IBAN|undefined/);assert.throws(()=>reminderText(s,3,'2026-10-21'),/borcu yok/);assert.throws(()=>reminderText(s,4,'2026-10-21'),/bulunamadı/);
});
test('Bank settings use the separate protected RPC and preserve expected snapshot',async()=>{
 let call;const api=createApi({url:'https://test',key:'public',fetchImpl:async(url,options)=>{call={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({ok:true})}}});
 const payload={iban,accountHolder:'Test',expected:{iban:'',accountHolder:''}};await api('bank','PUT',payload);assert.match(call.url,/apartman_bank_save$/);assert.deepEqual(call.body,{payload});
});
