import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('Aidat, muafiyet, ödeme, kasa ve erişim kuralları',async(t)=>{
 const folder=await mkdtemp(join(tmpdir(),'komsu-test-'));
 const password='Only-test-password-12345';
 const proc=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',ADMIN_PASSWORD:password,DB_PATH:join(folder,'test.sqlite'),NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 let logs='';proc.stderr.on('data',b=>logs+=b);
 t.after(async()=>{if(proc.exitCode===null){const done=once(proc,'exit');proc.kill('SIGTERM');await done;}await rm(folder,{recursive:true,force:true});});
 const base=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Sunucu başlamadı: '+logs)),15000);
  proc.stdout.on('data',b=>{const m=String(b).match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(m[0]);}});
  proc.once('exit',code=>{clearTimeout(timer);reject(new Error('Sunucu kapandı '+code+': '+logs));});
 });
 let cookie='';
 async function req(path,method='GET',data,authenticated=true,extra={}){
  const r=await fetch(base+'/api/'+path,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json'}:{}),...(authenticated&&cookie?{Cookie:cookie}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:r.status,data:await r.json(),headers:r.headers};
 }
 let r=await req('state');assert.equal(r.status,200);assert.equal(r.data.units.length,9);assert.equal(r.data.admin,false);
 assert.equal((await req('charges','POST',{period:'2026-10',amount:500},false)).status,401);
 assert.equal((await req('backup','GET',undefined,false)).status,401);
 assert.equal((await req('login','POST',{password:'wrong'})).status,401);
 assert.equal((await req('login','POST',{password},true,{Origin:'https://evil.example'})).status,403);
 r=await req('login','POST',{password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 r=await req('units/1','PUT',{label:'Daire 1',owner:'Gizli Malik',resident:'Gizli Oturan',exempt:true});assert.equal(r.status,200);
 r=await req('state','GET',undefined,false);assert.ok(!JSON.stringify(r.data).includes('Gizli'));assert.equal(r.data.payments,undefined);assert.equal(r.data.audit,undefined);
 r=await req('charges','POST',{period:'2026-10',amount:500});assert.equal(r.data.count,8);
 r=await req('charges','POST',{period:'2026-10',amount:1000});assert.equal(r.data.count,0);
 let s=(await req('state')).data;assert.equal(s.charges.length,8);assert.equal(s.totals.receivable,400000);assert.ok(!s.charges.some(c=>c.unit_id===1));assert.ok(s.charges.every(c=>c.amount===50000));
 const charge=s.charges[0],unit=s.units.find(u=>u.id===charge.unit_id);
 await req('units/'+unit.id,'PUT',{...unit,exempt:true});
 s=(await req('state')).data;assert.equal(s.charges.length,8);assert.equal(s.totals.receivable,400000);
 assert.equal((await req('payments','POST',{chargeId:charge.id,date:'2026-10-20',amount:600})).status,400);
 assert.equal((await req('payments','POST',{chargeId:charge.id,date:'2026-02-30',amount:100})).status,400);
 assert.equal((await req('payments','POST',{chargeId:charge.id,date:'2026-10-20',amount:200})).status,200);
 s=(await req('state')).data;assert.equal(s.totals.cash,20000);assert.equal(s.totals.receivable,380000);
 assert.equal((await req('payments','POST',{chargeId:charge.id,date:'2026-10-20'})).status,200);
 assert.equal((await req('payments','POST',{chargeId:charge.id,date:'2026-10-20'})).status,400);
 s=(await req('state')).data;assert.equal(s.totals.cash,50000);assert.equal(s.totals.receivable,350000);
 assert.equal((await req('expenses','POST',{category:'Yönetim gideri',description:'Defter ve kırtasiye',amount:120,date:'2026-10-20'})).status,200);
 s=(await req('state')).data;assert.equal(s.totals.cash,38000);assert.equal(s.expenses[0].category,'Yönetim gideri');
 assert.equal((await req('expenses/'+s.expenses[0].id,'DELETE',{})).status,200);
 await req('payments/'+s.payments[0].id,'DELETE',{});
 s=(await req('state')).data;assert.equal(s.totals.cash,20000);assert.equal(s.totals.receivable,380000);
 assert.equal((await req('charges','POST',{period:'2026-13',amount:500})).status,400);
 assert.equal((await req('charges','POST',{period:'2026-11',amount:-1})).status,400);
 assert.equal((await req('charges','POST',{period:'2026-11',amount:500})).data.count,7);
 assert.equal((await req('notices','POST',{title:'Toplantı',body:'Pazar 15:00'})).status,200);
 r=await req('backup');assert.equal(r.status,200);assert.ok(r.data.tables.audit.length>0);assert.equal(r.data.tables.sessions,undefined);
 await req('logout','POST',{});assert.equal((await req('backup')).status,401);
 const html=await fetch(base);assert.equal(html.status,200);assert.match(await html.text(),/Komşu/);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
