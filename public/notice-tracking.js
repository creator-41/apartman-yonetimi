export const NOTICE_TRACKING_KEY='komsu-apartman-notices-v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=rows=>Array.isArray(rows)?rows.filter(r=>r&&uuid.test(r.id)&&uuid.test(r.token)&&Number.isSafeInteger(r.unitId)&&r.unitId>0).map(({id,token,unitId})=>({id,token,unitId})).slice(-50):[];
// Only access credentials are saved. Status, notes and financial values stay on the server.
export function createNoticeBook(host){
 let rows=[],persistent=true;
 const sync=raw=>{try{rows=clean(JSON.parse(raw||'[]'));}catch{rows=[];}};
 const read=()=>{if(persistent)try{sync(host.localStorage.getItem(NOTICE_TRACKING_KEY));}catch{persistent=false;}};
 const save=()=>{if(persistent)try{host.localStorage.setItem(NOTICE_TRACKING_KEY,JSON.stringify(rows));}catch{persistent=false;}return persistent;};
 read();
 return {
  entries(unitId){read();return rows.filter(r=>r.unitId===unitId).map(r=>({...r}));},
  remember(entry){if(clean([entry]).length!==1)throw new Error('Geçersiz takip bilgisi.');read();rows=clean([...rows.filter(r=>r.id!==entry.id),entry]);return save();},
  forget(id){read();rows=rows.filter(r=>r.id!==id);save();},
  sync
 };
}
export const ownNoticeStatus=status=>({pending:'İnceleniyor',uploading:'Dekont tamamlanmadı',approved:'Onaylandı',rejected:'Reddedildi'})[status]||'Durum alınamadı';
