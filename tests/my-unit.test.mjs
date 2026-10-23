import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnitPreference,MY_UNIT_KEY} from '../public/my-unit.js';
const units=[{id:1},{id:2}];
test('Unit choice survives reopening without storing names, balances or login data',()=>{
 const values=new Map(),host={localStorage:{getItem:key=>values.get(key),setItem:(k,v)=>values.set(k,v)}};
 const choice=createUnitPreference(host);assert.equal(choice.get(units),null);
 assert.equal(choice.set('2',units),true);assert.deepEqual([...values],[[MY_UNIT_KEY,'2']]);
 assert.equal(createUnitPreference(host).get(units),2);
 assert.equal(choice.get([{id:1}]),null);assert.throws(()=>choice.set('99',units),/seçin/);
 choice.sync('1');assert.equal(choice.get(units),1);choice.sync(null);assert.equal(choice.get(units),null);
});
test('Unavailable storage keeps the chosen unit usable in memory; malformed stored IDs are ignored',()=>{
 const host={get localStorage(){throw new Error('Blocked');}},choice=createUnitPreference(host);
 assert.equal(choice.get(units),null);assert.equal(choice.set(1,units),false);assert.equal(choice.get(units),1);
 for(const value of ['broken','0','-1','1.5','99'])assert.equal(createUnitPreference({localStorage:{getItem:()=>value}}).get(units),null);
});
