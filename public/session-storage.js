export const SESSION_KEY='komsu-apartman-session-v1';
export function sessionStorageFor(win){
 try{
  const persistent=win.localStorage;
  persistent.getItem(SESSION_KEY);
  try{
   const old=win.sessionStorage.getItem(SESSION_KEY);
   if(old&&!persistent.getItem(SESSION_KEY)){
    const value=JSON.parse(old);
    if(value?.access_token&&value?.refresh_token)persistent.setItem(SESSION_KEY,old);
   }
   win.sessionStorage.removeItem(SESSION_KEY);
  }catch{/* A closed or unavailable old tab session does not prevent persistent login. */}
  return persistent;
 }catch{
  try{return win.sessionStorage;}catch{return undefined;}
 }
}
