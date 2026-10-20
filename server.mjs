import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) throw new Error('ADMIN_PASSWORD en az 12 karakter olmalı.');
const dbPath = resolve(process.env.DB_PATH || 'data/apartman.sqlite');
mkdirSync(dirname(dbPath), {recursive:true});
const db = new DatabaseSync(dbPath);
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY, label TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', resident TEXT NOT NULL DEFAULT '', exempt INTEGER NOT NULL DEFAULT 0 CHECK(exempt IN (0,1)));
CREATE TABLE IF NOT EXISTS charges (id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES units(id), period TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(unit_id,period));
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, charge_id INTEGER NOT NULL REFERENCES charges(id), amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
if (!db.prepare('SELECT id FROM units LIMIT 1').get()) {
  db.exec('BEGIN');
  try {
    const insert=db.prepare('INSERT INTO units (label) VALUES (?)');
    for(let n=1;n<=8;n++) insert.run('Daire '+n);
    insert.run('Dükkân');
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
for(const [k,v] of [['name','Komşu Apartmanı'],['monthlyDues','50000'],['openingBalance','0']]) db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run(k,v);
const salt=randomBytes(16);
const passwordHash=scryptSync(password,salt,64);
const loginAttempts=new Map();
const categories=['Temizlik','Elektrik','Su','Asansör','Bakım / Onarım','Yönetim gideri','Diğer'];
const q=(sql,...p)=>db.prepare(sql).all(...p);
const one=(sql,...p)=>db.prepare(sql).get(...p);
const run=(sql,...p)=>db.prepare(sql).run(...p);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const txt=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
function cents(v,allowZero=false) {
  if(typeof v!=='number'||!Number.isFinite(v)||v<0||(!allowZero&&v===0)||v>10000000) fail('Geçerli bir tutar girin.');
  const n=Math.round(v*100);
  if(!allowZero && n<1) fail('Tutar en az 0,01 TL olmalı.');
  return n;
}
function date(v) {if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v) fail('Geçerli tarih girin.');return v;}
function period(v) {if(typeof v!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)) fail('Geçerli ay seçin.');return v;}
function transaction(fn){ db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function audit(action,details){run('INSERT INTO audit(action,details) VALUES (?,?)',action,JSON.stringify(details));}
const tokenHash=v=>createHash('sha256').update(v).digest('hex');
function auth(req) {
  const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);
  return token && one('SELECT token FROM sessions WHERE token=? AND expires>?',tokenHash(token),Date.now());
}
function snapshot(admin) {
 const settings=Object.fromEntries(q('SELECT * FROM settings').map(r=>[r.key,r.value]));
 const units=q(admin?'SELECT * FROM units ORDER BY id':'SELECT id,label,exempt FROM units ORDER BY id');
 const charges=q('SELECT c.*, COALESCE(SUM(p.amount),0) AS paid FROM charges c LEFT JOIN payments p ON p.charge_id=c.id GROUP BY c.id ORDER BY c.period DESC,c.unit_id');
 const expenses=q('SELECT * FROM expenses ORDER BY date DESC,id DESC');
 const income=one('SELECT COALESCE(SUM(amount),0) AS n FROM payments').n;
 const spent=expenses.reduce((s,e)=>s+e.amount,0);
 return {admin:!!admin,settings,units,charges,expenses,notices:q('SELECT * FROM notices ORDER BY id DESC'),
 totals:{income,expenses:spent,receivable:charges.reduce((s,c)=>s+c.amount-c.paid,0),cash:Number(settings.openingBalance)+income-spent},
 categories,...(admin?{payments:q('SELECT * FROM payments ORDER BY date DESC,id DESC'),audit:q('SELECT * FROM audit ORDER BY id DESC LIMIT 100')}:{})};
}
async function body(req) {
 let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>20000)fail('İstek çok büyük.',413);}
 try {const b=JSON.parse(raw||'{}');if(!b||Array.isArray(b)||typeof b!=='object')fail('Geçersiz istek.');return b;} catch(e){if(e.status)throw e;fail('Geçersiz JSON.');}
}
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try {
  const url=new URL(req.url,'http://localhost');
  if(!url.pathname.startsWith('/api/')){
    if(req.method!=='GET')fail('Yöntem desteklenmiyor.',405);
    const f=files.get(url.pathname);if(!f)fail('Bulunamadı.',404);
    res.writeHead(200,{'Content-Type':f[1],'Cache-Control':'no-cache'});
    return res.end(readFileSync(new URL('./public/'+f[0],import.meta.url)));
  }
  const admin=auth(req);
  if(req.method==='GET'&&url.pathname==='/api/state')return send(200,snapshot(admin));
  if(req.method==='GET'&&url.pathname==='/api/backup'){
    if(!admin)fail('Yönetici girişi gerekli.',401);
    const tables={};for(const table of ['units','charges','payments','expenses','settings','notices','audit'])tables[table]=q('SELECT * FROM '+table);
    res.setHeader('Content-Disposition','attachment; filename="apartman-yedek.json"');
    return send(200,{version:1,exportedAt:new Date().toISOString(),tables});
  }
  if(!['POST','PUT','DELETE'].includes(req.method))fail('Bulunamadı.',404);
  // Reject cross-site requests, including login CSRF.
  const origin=req.headers.origin;
  const expected=process.env.APP_ORIGIN;
  if(origin && (expected?origin!==expected:new URL(origin).host!==req.headers.host)) fail('Kaynak doğrulaması başarısız.',403);
  if(req.headers['sec-fetch-site']==='cross-site')fail('Kaynak doğrulaması başarısız.',403);
  if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('JSON gerekli.',415);
  const b=await body(req);
  if(req.method==='POST'&&url.pathname==='/api/login'){
    // Use direct socket address: forwarded headers are not trusted.
    const ip=req.socket.remoteAddress;
    const now=Date.now();
    if(loginAttempts.size>10000)for(const [key,v] of loginAttempts)if(v.until<now)loginAttempts.delete(key);
    let tries=loginAttempts.get(ip);
    if(tries?.until>now&&tries.count>=10)fail('Çok fazla deneme. 15 dakika sonra tekrar deneyin.',429);
    if(!tries||tries.until<now)tries={count:0,until:now+900000};
    tries.count++;loginAttempts.set(ip,tries);
    if(typeof b.password!=='string'||!timingSafeEqual(scryptSync(b.password.slice(0,1024),salt,64),passwordHash))fail('Şifre hatalı.',401);
    loginAttempts.delete(ip);
    run('DELETE FROM sessions WHERE expires<?',now);
    const token=randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES (?,?)',tokenHash(token),now+8*3600000);
    res.setHeader('Set-Cookie','session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(process.env.NODE_ENV==='production'?'; Secure':''));
    return send(200,{ok:true});
  }
  if(!admin)fail('Yönetici girişi gerekli.',401);
  const path=url.pathname;
  if(path==='/api/logout'&&req.method==='POST'){
    run('DELETE FROM sessions WHERE token=?',admin.token);
    res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  } else if(path==='/api/settings'&&req.method==='PUT'){
    const name=txt(b.name,100);if(!name)fail('Apartman adını girin.');
    const dues=cents(b.monthlyDues);
    const balance=cents(b.openingBalance,true);
    transaction(()=>{for(const [k,v]of [['name',name],['monthlyDues',dues],['openingBalance',balance]])run('UPDATE settings SET value=? WHERE key=?',String(v),k);audit('Ayarlar güncellendi',{name,dues,balance});});
  } else if(/^\/api\/units\/\d+$/.test(path)&&req.method==='PUT'){
    const id=Number(path.split('/').pop());if(!one('SELECT id FROM units WHERE id=?',id))fail('Bölüm bulunamadı.',404);
    const label=txt(b.label,60);if(!label||typeof b.exempt!=='boolean')fail('Bölüm adı ve muafiyet gerekli.');
    transaction(()=>{run('UPDATE units SET label=?,owner=?,resident=?,exempt=? WHERE id=?',label,txt(b.owner,100),txt(b.resident,100),b.exempt?1:0,id);audit('Bölüm güncellendi',{id,label,exempt:b.exempt});});
  } else if(path==='/api/charges'&&req.method==='POST'){
    const month=period(b.period), amount=cents(b.amount);
    const count=transaction(()=>{
      let n=0;for(const u of q('SELECT id FROM units WHERE exempt=0'))n+=Number(run('INSERT OR IGNORE INTO charges(unit_id,period,amount) VALUES (?,?,?)',u.id,month,amount).changes);
      audit('Aylık aidat oluşturuldu',{period:month,amount,count:n});return n;
    });
    return send(200,{ok:true,count});
  } else if(path==='/api/payments'&&req.method==='POST'){
    const paidDate=date(b.date);
    transaction(()=>{
      const c=one('SELECT c.*,COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.charge_id=c.id),0) paid FROM charges c WHERE id=?',Number(b.chargeId));
      if(!c)fail('Aidat kaydı bulunamadı.',404);
      const amount=b.amount==null?c.amount-c.paid:cents(b.amount);
      if(amount<=0||amount>c.amount-c.paid)fail('Ödeme kalan borcu aşamaz.');
      const result=run('INSERT INTO payments(charge_id,amount,date,note) VALUES (?,?,?,?)',c.id,amount,paidDate,txt(b.note,200));
      audit('Ödeme onaylandı',{id:Number(result.lastInsertRowid),chargeId:c.id,amount});
    });
  } else if(/^\/api\/payments\/\d+$/.test(path)&&req.method==='DELETE'){
    const id=Number(path.split('/').pop());
    transaction(()=>{const p=one('SELECT * FROM payments WHERE id=?',id);if(!p)fail('Ödeme bulunamadı.',404);run('DELETE FROM payments WHERE id=?',id);audit('Ödeme iptal edildi',p);});
  } else if(path==='/api/expenses'&&req.method==='POST'){
    const category=txt(b.category,60),description=txt(b.description,300),amount=cents(b.amount),d=date(b.date);
    if(!categories.includes(category)||!description)fail('Kategori ve açıklama gerekli.');
    transaction(()=>{const r=run('INSERT INTO expenses(category,description,amount,date) VALUES (?,?,?,?)',category,description,amount,d);audit('Gider eklendi',{id:Number(r.lastInsertRowid),category,amount});});
  } else if(/^\/api\/expenses\/\d+$/.test(path)&&req.method==='DELETE'){
    const id=Number(path.split('/').pop());
    transaction(()=>{const e=one('SELECT * FROM expenses WHERE id=?',id);if(!e)fail('Gider bulunamadı.',404);run('DELETE FROM expenses WHERE id=?',id);audit('Gider silindi',e);});
  } else if(path==='/api/notices'&&req.method==='POST'){
    const title=txt(b.title,100),content=txt(b.body,2000);if(!title||!content)fail('Başlık ve duyuru gerekli.');
    transaction(()=>{run('INSERT INTO notices(title,body) VALUES (?,?)',title,content);audit('Duyuru eklendi',{title});});
  } else if(/^\/api\/notices\/\d+$/.test(path)&&req.method==='DELETE'){
    const id=Number(path.split('/').pop());
    transaction(()=>{run('DELETE FROM notices WHERE id=?',id);audit('Duyuru silindi',{id});});
  } else fail('Bulunamadı.',404);
  return send(200,{ok:true});
 } catch(e) {
  if(!e.status)console.error(e);
  if(!res.headersSent)send(e.status||500,{error:e.status?e.message:'İşlem tamamlanamadı.'});else res.end();
 }
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Komşu hazır: http://localhost:'+server.address().port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
