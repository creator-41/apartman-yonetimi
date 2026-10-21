import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthReport,unitStatement,monthReportText,unitStatementText,chargeDate} from '../public/reports.js';
import {createApi} from '../public/transport.js';
const state={admin:true,settings:{name:'Komşu',openingBalance:'10000'},units:[{id:1,label:'Daire 1',owner:'PRIVATE OWNER'},{id:2,label:'Daire 2'}],
 charges:[{id:1,unit_id:1,period:'2026-08',kind:'opening',incurred_on:'2026-08-20',amount:50000,note:'PRIVATE DEBT NOTE'},{id:2,unit_id:1,period:'2026-10',amount:30000},{id:3,unit_id:2,period:'2026-11',amount:10000}],
 payments:[{id:1,charge_id:1,date:'2026-09-05',amount:10000,note:'PRIVATE PAYMENT NOTE'},{id:2,charge_id:1,date:'2026-10-02',amount:20000},{id:3,charge_id:2,date:'2026-11-02',amount:30000}],
 expenses:[{id:1,date:'2026-09-10',amount:2000,category:'Temizlik'},{id:2,date:'2026-10-03',amount:5000,category:'Elektrik'}]};
test('Monthly cash follows actual payment dates, including old dues paid this month',()=>{
 const r=monthReport(state,'2026-10');assert.equal(r.opening,18000);assert.equal(r.income,20000);assert.equal(r.spent,5000);assert.equal(r.closing,33000);
 assert.equal(r.receivable,50000);assert.deepEqual(r.categories,[{category:'Elektrik',amount:5000}]);
 // Future charges/payments must not distort a historical month-end balance.
 assert.equal(monthReport(state,'2026-09').receivable,40000);
});
test('Debt entry alone does not change cash, partial payments and cancellation do',()=>{
 const base={...state,charges:[],payments:[],expenses:[]};
 const debt={...base,charges:[state.charges[0]]};assert.equal(monthReport(debt,'2026-10').closing,10000);
 assert.equal(monthReport(debt,'2026-10').receivable,50000);
 const paid={...debt,payments:[state.payments[1]]};assert.equal(monthReport(paid,'2026-10').closing,30000);assert.equal(monthReport(paid,'2026-10').receivable,30000);
 assert.equal(monthReport({...paid,payments:[]},'2026-10').closing,10000);
});
test('Unit statement orders charges/payments chronologically and excludes other units',()=>{
 const r=unitStatement(state,1);assert.deepEqual(r.rows.map(r=>r.balance),[50000,40000,70000,50000,20000]);
 assert.equal(r.debit,80000);assert.equal(r.credit,60000);assert.equal(r.balance,20000);
 assert.equal(r.rows[0].label,'Devir borcu');assert.equal(r.rows[0].date,'2026-08-20');
 assert.equal(chargeDate({...state.charges[0],period:'2026-07'}),'2026-07-01');
});
test('Resident statements and shared text omit owner names and private notes',()=>{
 const resident=unitStatement({...state,admin:false},1);assert(resident.rows.every(r=>r.note===''));
 const shared=unitStatementText(state,1);assert(!shared.includes('PRIVATE'));assert(shared.includes('Devir borcu'));assert(shared.includes('Kalan borç:'));
 assert(!monthReportText(state,'2026-10').includes('PRIVATE'));assert(monthReportText(state,'2026-10').includes('Ekim 2026'));
});
test('Empty months, year boundaries and invalid input remain predictable',()=>{
 const empty={...state,charges:[],payments:[],expenses:[]};assert.equal(monthReport(empty,'2027-01').opening,10000);assert.equal(monthReport(empty,'2027-01').income,0);
 assert.deepEqual(unitStatement(empty,1),{rows:[],debit:0,credit:0,balance:0});assert.throws(()=>monthReport(state,'2026-13'));
});
test('Opening debt transport uses its dedicated authenticated RPC',async()=>{
 let sent;const api=createApi({url:'https://test',key:'public',fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({ok:true})};}});
 const payload={unitId:1,date:'2026-09-30',amount:350,note:'Eski aidat'};await api('charges/opening','POST',payload);
 assert.equal(sent.url,'https://test/rest/v1/rpc/apartman_opening_charge');assert.deepEqual(sent.body,{payload});
});
test('Detailed monthly balance reconciles collections, spending, net cash and debtor totals',()=>{
 const r=monthReport(state,'2026-10');assert.equal(r.net,15000);assert.equal(r.collections.reduce((s,p)=>s+p.amount,0),r.income);assert.equal(r.spending.reduce((s,e)=>s+e.amount,0),r.spent);assert.equal(r.debtors.reduce((s,u)=>s+u.total,0),r.receivable);
 assert.deepEqual(r.debtors,[{unitId:1,label:'Daire 1',monthlyDue:30000,monthlyPaid:0,currentRemaining:30000,olderRemaining:20000,total:50000,status:'Ödemedi'}]);assert.equal(r.collections[0].period,'2026-08');assert.equal(r.collections[0].unit,'Daire 1');assert.doesNotMatch(JSON.stringify([r.debtors,r.collections,r.spending]),/PRIVATE/);
});
test('Partially paid and fully paid dues differ at selected month-end, ignoring later settlement',()=>{
 const s={...state,charges:[{id:10,unit_id:1,period:'2026-10',amount:50000,paid:50000},{id:11,unit_id:2,period:'2026-10',amount:50000,paid:50000}],payments:[{id:10,charge_id:10,date:'2026-10-03',amount:20000},{id:11,charge_id:10,date:'2026-11-03',amount:30000},{id:12,charge_id:11,date:'2026-10-05',amount:50000}]};
 const r=monthReport(s,'2026-10');assert.equal(r.debtors.length,1);assert.equal(r.debtors[0].label,'Daire 1');assert.equal(r.debtors[0].status,'Kısmi ödeme');assert.equal(r.debtors[0].currentRemaining,30000);assert.equal(r.income,70000);assert.equal(monthReport(s,'2026-11').debtors.length,0);
 const text=monthReportText(s,'2026-10');assert.match(text,/TAHSİLATLAR/);assert.match(text,/HARCAMA ÖZETİ/);assert.match(text,/AİDAT BORCU KALAN DAİRELER/);assert.match(text,/Kısmi ödeme/);
});
test('Old-debt-only units remain visible without being labelled unpaid for a month with no charge',()=>{
 const r=monthReport({...state,charges:[state.charges[0]],payments:[]},'2026-10');assert.equal(r.debtors[0].currentRemaining,0);assert.equal(r.debtors[0].olderRemaining,50000);assert.equal(r.debtors[0].status,'Önceki dönem borcu');
});
