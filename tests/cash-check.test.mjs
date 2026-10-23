import test from 'node:test';import assert from 'node:assert/strict';
import {cashCheckAmounts,cashCheckResult} from '../public/cash-check.js';import {createApi} from '../public/transport.js';
test('Cash check adds bank and cash in cents and reports deficit, surplus and exact match',()=>{
 assert.deepEqual(cashCheckAmounts('10.01','2.34',1235),{bank:1001,cash:234,expectedCash:1235,total:1235,difference:0});
 assert.equal(cashCheckAmounts('10','0',1001).difference,-1);assert.equal(cashCheckAmounts('10','0',999).difference,1);
 assert.equal(cashCheckResult(0),'Hesap tutuyor');assert.equal(cashCheckResult(-1),'Eksik bakiye');assert.equal(cashCheckResult(1),'Fazla bakiye');
 assert.equal(cashCheckAmounts('-50','0',-5000).difference,0);assert.equal(cashCheckAmounts('0','0',0).difference,0);
});
test('Cash check requires both real amounts and rejects fractional cents, negative cash and invalid snapshots',()=>{
 for(const args of [['','0',0],['0','',0],[null,'0',0],['0','-1',0],['1.001','0',0],['0','0.001',0],['NaN',0,0],[Infinity,0,0],[10000000.01,0,0],[-10000000.01,0,0],[0,0,1.2]])assert.throws(()=>cashCheckAmounts(...args));
});
test('Cash check transport uses dedicated read/save RPCs and preserves idempotency identity',async()=>{
 const calls=[],api=createApi({url:'https://test.supabase.co',key:'public',storage:{getItem:()=>null},fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};}});
 const payload={requestId:'test-id',bank:100,cash:200,expectedCash:300,note:''};await api('cash-check');await api('cash-check','POST',payload);
 assert.deepEqual(calls.map(c=>c.url.split('/').at(-1)),['apartman_cash_check_get','apartman_cash_check_save']);assert.deepEqual(calls[1].body,{payload});
});
