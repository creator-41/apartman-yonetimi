import test from 'node:test';import assert from 'node:assert/strict';
import {budgetSummary,budgetItem} from '../public/budget.js';import {createApi} from '../public/transport.js';
const state={settings:{monthlyDues:35000},units:[{id:1},{id:2},{id:3,exempt:true}]};
test('Budget uses current equal dues and nonexempt units, excluding old debts, cash and collections',()=>{
 const input={...state,charges:[{amount:9999999,paid:0}],payments:[{amount:888888}],totals:{cash:1234567}};
 const copy=JSON.stringify(input),r=budgetSummary(input,[{amount:70001}]);
 assert.equal(r.expected,70000);assert.equal(r.expense,70001);assert.equal(r.balance,-1);assert.equal(r.required,35001);assert.equal(r.extra,1);assert.equal(r.exemptCount,1);assert.equal(JSON.stringify(input),copy);
});
test('Budget rounds up kuruş, distinguishes surplus, balance, no payers and no costs',()=>{
 assert.equal(budgetSummary(state,[{amount:30000}]).balance,40000);
 assert.equal(budgetSummary(state,[{amount:70000}]).balance,0);
 const none=budgetSummary({...state,units:[{exempt:true}]},[{amount:30000}]);assert.equal(none.required,null);assert.equal(none.expected,0);
 assert.equal(budgetSummary(state,[]).expense,0);assert.equal(budgetSummary({...state,units:[]},[]).required,null);
});
test('Budget input accepts exact cents and rejects blank, excessive, negative and fractional cents',()=>{
 assert.deepEqual(budgetItem(' Temizlik ','3000.25'),{label:'Temizlik',amount:300025});
 for(const [label,amount] of [['',1],['x'.repeat(101),1],['Test',0],['Test',-1],['Test',Infinity],['Test','oops'],['Test',1.001],['Test',10000000.01]])assert.throws(()=>budgetItem(label,amount));
 assert.throws(()=>budgetSummary(state,[{amount:1.2}]));
});
test('Budget transport only maps plan read/save to dedicated RPCs with version payload',async()=>{
 const calls=[],api=createApi({url:'https://test.supabase.co',key:'public',storage:{getItem:()=>null},fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({items:[],version:0})};}});
 await api('budget');await api('budget','PUT',{items:[{label:'Temizlik',amount:300000}],expectedVersion:0});
 assert.deepEqual(calls.map(c=>c.url.split('/').at(-1)),['apartman_budget_get','apartman_budget_save']);assert.equal(calls[1].body.payload.expectedVersion,0);assert.equal(calls[1].body.payload.items[0].amount,300000);
});
