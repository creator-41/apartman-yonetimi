import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentReceipt,receiptLink,receiptSvg} from '../public/receipts.js';
import {monthReport} from '../public/reports.js';
const state={settings:{name:'Test Apartmanı',openingBalance:0},units:[{id:1,label:'Daire 1',owner:'PRIVATE_OWNER',resident:'PRIVATE_RESIDENT'}],charges:[{id:4,unit_id:1,period:'2026-09',amount:50000,paid:20000,kind:'monthly',note:'PRIVATE_NOTE'}],payments:[{id:10,charge_id:4,date:'2026-10-21',amount:20000,note:'PRIVATE_PAYMENT_NOTE'}],expenses:[]};
test('Receipt uses a single payment and its actual date, preserving original charge period',()=>{
 const r=paymentReceipt(state,10);assert.equal(r.number,'KM-000010');assert.equal(r.amount,20000);assert.equal(r.period,'2026-09');assert.equal(r.date,'2026-10-21');assert.equal(r.unit,'Daire 1');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
 assert.equal(monthReport(state,'2026-10').closing,20000);assert.equal(monthReport(state,'2026-10').receivable,30000);
});
test('Cancelled/missing payments cannot generate a receipt; malformed IDs and orphan references fail',()=>{
 const cancelled={...state,payments:[]};assert.throws(()=>paymentReceipt(cancelled,10),/iptal/);assert.equal(monthReport(cancelled,'2026-10').closing,0);assert.equal(monthReport(cancelled,'2026-10').receivable,50000);
 for(const id of [0,-1,1.5,NaN,'10'])assert.throws(()=>paymentReceipt(state,id),/Geçersiz/);
 assert.throws(()=>paymentReceipt({...state,charges:[]},10),/bölüm/);
});
test('Receipt link stays within application directory and discards old page/query params',()=>{
 assert.equal(receiptLink('https://example.test/apartman/?v=x',10),'https://example.test/apartman/receipt.html?payment=10');assert.equal(receiptLink('https://example.test/apartman/receipt.html?payment=2',10),'https://example.test/apartman/receipt.html?payment=10');assert.throws(()=>receiptLink('https://example.test',0));
});
test('SVG escapes text, includes verification link and omits private information',()=>{
 const r=paymentReceipt({...state,settings:{name:'<script>alert(1)</script> & Test'}},10),svg=receiptSvg(r,'https://test/receipt.html?payment=10');
 assert.match(svg,/&lt;script&gt;/);assert.doesNotMatch(svg,/<script>|PRIVATE/);assert.match(svg,/KM-000010/);assert.match(svg,/200,00/);assert.match(svg,/21.10.2026/);assert.match(svg,/Eylül 2026/);assert.match(svg,/payment=10/);
});
