import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionReadPayload} from '../public/decision-reads.js';
import {createApi} from '../public/transport.js';
test('Read declaration requires a real unit and retains the exact decision revision',()=>{
 const d={id:2,version:'2026-10-22 12:00:00.123456+00',archived:false};
 assert.deepEqual(decisionReadPayload(d,'8'),{operation:'mark',decisionId:2,unitId:8,version:d.version});
 for(const unit of ['',0,-1,1.5,'bad'])assert.throws(()=>decisionReadPayload(d,unit),/seçin/);
 assert.throws(()=>decisionReadPayload({...d,archived:true},1),/arşivlenmiş/);
 assert.throws(()=>decisionReadPayload({...d,version:null},1),/değişmiş/);
});
test('Read declarations use their restricted RPC instead of financial mutations',async()=>{
 let sent;const api=createApi({url:'https://test',key:'pub',fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({ok:true})};}});
 const payload=decisionReadPayload({id:1,version:'v1'},2);await api('decisions/reads','POST',payload);
 assert.equal(sent.url,'https://test/rest/v1/rpc/apartman_decision_reads');assert.deepEqual(sent.body,{payload});
});
