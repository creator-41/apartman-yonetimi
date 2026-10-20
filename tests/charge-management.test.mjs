import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chargeRequest,unpaidCharges} from '../public/charge-management.js';
import {createApi} from '../public/transport.js';
const rows=[{id:1,unit_id:1,period:'2026-10',amount:35000,paid:0},{id:2,unit_id:2,period:'2026-10',amount:35000,paid:10000},{id:3,unit_id:3,period:'2026-10',amount:35000,paid:0}];
test('Only unpaid charges are selectable, including exclusion of partial payments',()=>{
 assert.deepEqual(unpaidCharges(rows).map(c=>c.id),[1,3]);
 assert.throws(()=>chargeRequest(rows,[1,2],'delete'),/Ödeme girilmiş/);
});
test('Edit request freezes old values for optimistic concurrency and includes target month',()=>{
 const r=chargeRequest(rows,[1,3],'edit',400,'2026-11');
 assert.equal(r.period,'2026-11');assert.equal(r.amount,400);
 rows[0].amount=45000;assert.equal(r.expected[0].amount,35000);rows[0].amount=35000;
 assert.equal(r.expected[0].paid,undefined);
});
test('Delete request requires an existing nonempty selection from one month',()=>{
 assert.throws(()=>chargeRequest(rows,[],'delete'),/seçin/);
 assert.throws(()=>chargeRequest(rows,[999],'delete'),/yenileyin/);
 assert.throws(()=>chargeRequest([...rows,{id:4,unit_id:1,period:'2026-11',amount:35000,paid:0}],[1,4],'delete'),/Tek bir ay/);
 assert.deepEqual(chargeRequest(rows,[1,1],'delete').ids,[1]);
});
test('Invalid target amounts and months are rejected before submission',()=>{
 for(const [amount,period] of [[-1,'2026-10'],[0,'2026-10'],[NaN,'2026-10'],[350,'2026-13']])assert.throws(()=>chargeRequest(rows,[1],'edit',amount,period),/Geçerli/);
});
test('Charge management goes through the protected RPC with the exact preview payload',async()=>{
 let sent;
 const api=createApi({url:'https://test.supabase.co',key:'public',fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:true,status:200,json:async()=>({ok:true,count:2})};}});
 const payload=chargeRequest(rows,[1,3],'delete');
 assert.equal((await api('charges/manage','POST',payload)).count,2);
 assert.match(sent.url,/rpc\/apartman_manage_charges$/);assert.deepEqual(sent.body,{payload});
});
