import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unitPaymentPlan} from '../public/unit-payments.js';
import {createApi} from '../public/transport.js';
const charges=[{id:3,unit_id:1,period:'2026-10',amount:50000,paid:0},{id:1,unit_id:1,period:'2026-08',amount:50000,paid:20000},{id:2,unit_id:1,period:'2026-09',amount:50000,paid:0},{id:4,unit_id:2,period:'2026-07',amount:99000,paid:0},{id:5,unit_id:1,period:'2026-07',amount:50000,paid:50000}];
test('One payment fills the oldest remaining debt then partially fills the next month',()=>{
 const before=JSON.stringify(charges),p=unitPaymentPlan(charges,1,400);assert.equal(p.total,130000);assert.equal(p.amount,40000);assert.equal(p.remaining,90000);assert.deepEqual(p.allocations,[{chargeId:1,period:'2026-08',amount:30000,remaining:0},{chargeId:2,period:'2026-09',amount:10000,remaining:40000}]);assert.deepEqual(p.expected.map(c=>c.id),[1,2,3]);assert.equal(JSON.stringify(charges),before);
});
test('Full settlement, exact boundary and decimal rounding conserve every kurus',()=>{
 const full=unitPaymentPlan(charges,1);assert.equal(full.remaining,0);assert.equal(full.allocations.reduce((s,a)=>s+a.amount,0),full.amount);assert.equal(unitPaymentPlan(charges,1,300).allocations.length,1);assert.equal(unitPaymentPlan(charges,1,1.005).amount,101);assert.equal(unitPaymentPlan(charges,1,0.015).amount,2);
});
test('Zero, negative, excess, invalid and debt-free inputs are blocked',()=>{
 for(const value of [0,-1,0.009,1300.01,NaN,Infinity,10000001])assert.throws(()=>unitPaymentPlan(charges,1,value));assert.throws(()=>unitPaymentPlan(charges,3,1),/borcu yok/);
});
test('Snapshot detects old balances independently of allocation amount and is not mutated',()=>{
 const p=unitPaymentPlan(charges,1,400);assert.equal(p.expected[0].paid,20000);const changed=charges.map(c=>c.id===1?{...c,paid:30000}:c);assert.notDeepEqual(unitPaymentPlan(changed,1,400).expected,p.expected);
});
test('Unit payment, batch inspection and atomic batch undo have dedicated RPC mappings',async()=>{
 const calls=[];const api=createApi({url:'https://test',key:'public',fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})}}});const payload={unitId:1,requestId:'test',amount:400,expected:unitPaymentPlan(charges,1).expected};await api('payments/unit','POST',payload);await api('payments/batch','POST',{id:'batch'});await api('payments/batch/undo','POST',{id:'batch'});assert.match(calls[0].url,/apartman_pay_unit$/);assert.deepEqual(calls[0].body,{payload});assert.match(calls[1].url,/apartman_payment_batch_info$/);assert.deepEqual(calls[2].body,{batch_id:'batch'});
});
