import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeInfo} from '../public/history.js';
import {createApi} from '../public/transport.js';
test('Payment and expense reversals preview opposite cash and debt effects',()=>{
 const p={entity:'payment',operation:'INSERT',after_row:{amount:5000}};assert.equal(changeInfo(p).cashChange,-5000);assert.equal(changeInfo(p).debtChange,5000);
 const cancel={entity:'payment',operation:'DELETE',before_row:{amount:5000}};assert.equal(changeInfo(cancel).cashChange,5000);assert.equal(changeInfo(cancel).debtChange,-5000);
 assert.equal(changeInfo({entity:'expense',operation:'INSERT',after_row:{amount:3000}}).cashChange,3000);
 assert.equal(changeInfo({entity:'expense',operation:'DELETE',before_row:{amount:3000}}).cashChange,-3000);
 assert.equal(changeInfo({entity:'expense',operation:'UPDATE',before_row:{amount:3000},after_row:{amount:5000}}).cashChange,2000);
});
test('Completed undo and compensation entries have no undo action, malformed records fail',()=>{
 const e={entity:'expense',operation:'INSERT',after_row:{amount:1}};assert(changeInfo(e).canUndo);assert(!changeInfo({...e,undone_at:'2026-10-21'}).canUndo);assert(!changeInfo({...e,undo_of:1}).canUndo);assert.throws(()=>changeInfo({entity:'unknown'}));
});
test('History and undo use dedicated RPCs with event identity only',async()=>{
 const calls=[];const api=createApi({url:'https://test',key:'public',fetchImpl:async(url,options)=>{calls.push({url,data:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})}}});await api('history');await api('undo','POST',{id:17});assert.match(calls[0].url,/apartman_change_history$/);assert.match(calls[1].url,/apartman_undo$/);assert.deepEqual(calls[1].data,{change_id:17});
});
