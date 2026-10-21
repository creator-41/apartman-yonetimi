import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openTasks,taskSave} from '../public/work.js';
import {uploadReceipt} from '../public/expense-files.js';
import {createApi} from '../public/transport.js';
test('Open task queue excludes done and archived, orders dates then undated without changing source',()=>{
 const rows=[{id:1,status:'pending'},{id:2,status:'done',due_date:'2020-01-01'},{id:3,status:'pending',archived:true},{id:4,status:'in_progress',due_date:'2026-10-21'},{id:5,status:'pending',due_date:'2026-10-20'}];
 assert.deepEqual(openTasks(rows,'2026-10-21').map(x=>x.id),[5,4,1]);assert.equal(rows[0].id,1);
});
test('Quick completion preserves task contents and original version',()=>{
 const t={id:7,title:'Bakım',notes:'Asansör',assignee:'Ali',due_date:'2026-10-21',decision_id:3,status:'pending',version:'original'};
 assert.deepEqual(taskSave(t,{status:'done'}),{operation:'save',id:7,title:'Bakım',notes:'Asansör',assignee:'Ali',dueDate:'2026-10-21',decisionId:3,status:'done',version:'original'});assert.equal(t.status,'pending');
});
test('Decision documents use the decision reservation then existing protected upload pipeline',async()=>{
 const calls=[];await uploadReceipt(async(path,method,data)=>{calls.push({path,data});return {file:{id:'f',path:'decisions/3/f.pdf'}}},3,{size:10,type:'application/pdf',name:'Karar.pdf'},'decision');
 assert.equal(calls[0].data.operation,'reserve-decision');assert.equal(calls[0].data.decisionId,3);assert.equal(calls[0].data.expenseId,undefined);assert.equal(calls[2].data.operation,'complete');
});
test('Work transport maps decision/task and backup to their RPCs',async()=>{
 const calls=[];const api=createApi({url:'https://test',key:'public',fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})}}});
 await api('tasks/manage','POST',{operation:'save'});await api('decisions/manage','POST',{operation:'archive'});await api('backup');
 assert.equal(calls[0].body.kind,'task');assert.equal(calls[1].body.kind,'decision');assert.match(calls[2].url,/apartman_backup$/);
});
