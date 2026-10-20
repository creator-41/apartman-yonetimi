// Small REST adapter; all authorization and money rules are enforced in Postgres.
// Session storage is namespaced, scoped to this tab, and never shared with Acısu.
export function createApi({url,key,storage,fetchImpl=globalThis.fetch,now=Date.now}) {
  const storageKey='komsu-apartman-session-v1';
  let session=null,refreshing=null;
  try { session=JSON.parse(storage?.getItem(storageKey)||'null'); } catch { /* invalid storage is ignored */ }
  if(!session?.access_token||!session?.refresh_token) session=null;
  function save(value){session=value;try{if(value)storage?.setItem(storageKey,JSON.stringify(value));else storage?.removeItem(storageKey);}catch{/* privacy mode: memory-only session */}}
  async function request(path,data,token,method='POST') {
    const response=await fetchImpl(url+path,{method,headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=result.error_description||result.msg||result.message||result.error||'Bağlantı hatası.';
      const error=new Error(typeof message==='string'?message:'İşlem tamamlanamadı.');error.status=response.status;throw error;
    }
    return result;
  }
  async function token(force=false){
    if(!session)return null;
    if(!force && session.expires_at*1000>now()+30000)return session.access_token;
    if(!refreshing){
      refreshing=(async()=>{
        try {
          const fresh=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
          if(!fresh.access_token||!fresh.refresh_token)throw new Error('Oturum yenilenemedi. Tekrar giriş yapın.');
          save({...fresh,expires_at:fresh.expires_at||Math.floor(now()/1000)+fresh.expires_in});
          return session.access_token;
        }catch(e){if(e.status===400||e.status===401)save(null);throw e;}
        finally{refreshing=null;}
      })();
    }
    return refreshing;
  }
  async function rpc(name,data){
    const current=await token();
    try{return await request('/rest/v1/rpc/'+name,data,current);}
    catch(e){if(e.status===401&&session){const fresh=await token(true);return request('/rest/v1/rpc/'+name,data,fresh);}throw e;}
  }
  async function logout(){
    const current=session?.access_token;
    save(null);
    if(current)await request('/auth/v1/logout?scope=local',{},current);
    return {ok:true};
  }
  return async function api(path,method='GET',data){
    if(path==='login'){
      if(!data?.email||!data?.password)throw new Error('E-posta ve şifre girin.');
      const fresh=await request('/auth/v1/token?grant_type=password',{email:data.email,password:data.password});
      save({...fresh,expires_at:fresh.expires_at||Math.floor(now()/1000)+fresh.expires_in});
      const snapshot=await rpc('apartman_state',{});
      if(!snapshot.admin){try{await logout();}catch{/* local session already cleared */}throw new Error('Bu hesabın apartman yöneticisi yetkisi yok.');}
      return {ok:true};
    }
    if(path==='logout')return logout();
    if(path==='state')return rpc('apartman_state',{});
    if(path==='backup')return rpc('apartman_action',{action:'backup',payload:{}});
    if(path==='charges/manage'&&method==='POST')return rpc('apartman_manage_charges',{payload:data});
    let action,payload={...data};
    if(path==='settings'&&method==='PUT')action='settings';
    else if(/^units\/\d+$/.test(path)&&method==='PUT'){action='unit';payload.id=Number(path.split('/')[1]);}
    else if(path==='charges'&&method==='POST')action='charges';
    else if(path==='payments'&&method==='POST')action='payment';
    else if(path==='expenses'&&method==='POST')action='expense';
    else if(path==='notices'&&method==='POST')action='notice';
    else if(/^(payments|expenses|notices)\/\d+$/.test(path)&&method==='DELETE'){
      const [resource,id]=path.split('/');action='delete-'+({payments:'payment',expenses:'expense',notices:'notice'})[resource];payload.id=Number(id);
    }else throw new Error('Geçersiz işlem.');
    return rpc('apartman_action',{action,payload});
  };
}
