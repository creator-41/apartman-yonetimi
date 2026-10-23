// Small REST adapter; all authorization and money rules are enforced in Postgres.
// Persistent sessions remain namespaced separately from Acısu; no passwords are stored.
export function createApi({url,key,storage,fetchImpl=globalThis.fetch,now=Date.now,sessionLock=fn=>globalThis.navigator?.locks?.request?globalThis.navigator.locks.request('komsu-apartman-auth',fn):fn()}) {
  const storageKey='komsu-apartman-session-v1';
  let session=null,refreshing=null,storageAvailable=true;
  function readSession(){
    if(!storage||!storageAvailable)return;
    try{const value=JSON.parse(storage.getItem(storageKey)||'null');session=value?.access_token&&value?.refresh_token?value:null;}
    catch{/* An invalid/blocked store must not expose another account's session. */session=null;}
  }
  readSession();
  function save(value){session=value;try{if(value)storage?.setItem(storageKey,JSON.stringify(value));else storage?.removeItem(storageKey);}catch{storageAvailable=false;/* privacy mode: memory-only session */}}
  async function request(path,data,token,method='POST') {
    const response=await fetchImpl(url+path,{method,headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=result.error_description||result.msg||result.message||result.error||'Bağlantı hatası.';
      const error=new Error(typeof message==='string'?message:'İşlem tamamlanamadı.');error.status=response.status;error.code=result.code;throw error;
    }
    return result;
  }
  async function token(force=false){
    readSession();
    if(!session)return null;
    if(!force && session.expires_at*1000>now()+30000)return session.access_token;
    if(!refreshing){
      const previous=session.access_token;
      refreshing=Promise.resolve().then(()=>sessionLock(async()=>{
        readSession();
        if(!session)return null;
        if((!force||session.access_token!==previous)&&session.expires_at*1000>now()+30000)return session.access_token;
        try {
          const fresh=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
          if(!fresh.access_token||!fresh.refresh_token)throw new Error('Oturum yenilenemedi. Tekrar giriş yapın.');
          save({...fresh,expires_at:fresh.expires_at||Math.floor(now()/1000)+fresh.expires_in});
          return session.access_token;
        }catch(e){if(e.status===400||e.status===401)save(null);throw e;}
      })).finally(()=>{refreshing=null;});
    }
    return refreshing;
  }
  async function rpc(name,data){
    const current=await token();
    try{return await request('/rest/v1/rpc/'+name,data,current);}
    catch(e){if(e.status===401&&session){const fresh=await token(true);return request('/rest/v1/rpc/'+name,data,fresh);}throw e;}
  }
  async function storageRequest(path,method,body,mime){
    const send=async access=>{
      const headers={apikey:key,...(access?{Authorization:'Bearer '+access}:{})};
      if(mime){headers['Content-Type']=mime;headers['x-upsert']='false';headers['cache-control']='max-age=60';}
      else headers['Content-Type']='application/json';
      const response=await fetchImpl(url+'/storage/v1/'+path,{method,headers,body:mime?body:JSON.stringify(body)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){const error=new Error(result.message||result.error||'Belge işlemi tamamlanamadı.');error.status=response.status;throw error;}
      return result;
    };
    let result;
    try{result=await send(await token());}catch(e){if(e.status===401&&session)result=await send(await token(true));else throw e;}
    return result;
  }
  async function logout(){
    return sessionLock(async()=>{
      readSession();const current=session?.access_token;
      save(null);
      if(current)await request('/auth/v1/logout?scope=local',{},current);
    });
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
    if(path.startsWith('request-files/')){
      const objectPath=data?.path,bucket='apartman-request-photos';
      if(typeof objectPath!=='string'||!(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/).test(objectPath))throw new Error('Geçersiz fotoğraf yolu.');
      if(path==='request-files/upload'&&method==='POST')return storageRequest('object/'+bucket+'/'+objectPath,'POST',data.file,data.file.type);
      if(path==='request-files/sign'&&method==='POST'){
        const result=await storageRequest('object/sign/'+bucket+'/'+objectPath,'POST',{expiresIn:60});
        if(typeof result.signedURL!=='string'||!result.signedURL.startsWith('/object/sign/'+bucket+'/'))throw new Error('Fotoğraf bağlantısı oluşturulamadı.');
        return {url:url+'/storage/v1'+result.signedURL};
      }
      throw new Error('Geçersiz fotoğraf işlemi.');
    }
    if(path==='push/device')return rpc('apartman_push_device',{payload:data});
    if(path==='requests')return rpc('apartman_request_list',{});
    if(['submit','complete','track','manage'].includes(path.split('/')[1])&&path.startsWith('requests/')&&method==='POST')return rpc('apartman_request_'+path.split('/')[1],{payload:data});
    if(path.startsWith('notice-files/')){
      const objectPath=data?.path,bucket='apartman-payment-notices';
      if(typeof objectPath!=='string'||!(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/).test(objectPath))throw new Error('Geçersiz dekont yolu.');
      if(path==='notice-files/upload'&&method==='POST')return storageRequest('object/'+bucket+'/'+objectPath,'POST',data.file,data.file.type);
      if(path==='notice-files/sign'&&method==='POST'){
        const result=await storageRequest('object/sign/'+bucket+'/'+objectPath,'POST',{expiresIn:60});
        if(typeof result.signedURL!=='string'||!result.signedURL.startsWith('/object/sign/'+bucket+'/'))throw new Error('Dekont bağlantısı oluşturulamadı.');
        return {url:url+'/storage/v1'+result.signedURL};
      }
      throw new Error('Geçersiz dekont işlemi.');
    }
    if(path==='payment-notices')return rpc('apartman_notice_list',{});
    if(path==='payment-notices/track'&&method==='POST')return rpc('apartman_notice_track',{payload:data});
    if(path==='payment-notices/submit'&&method==='POST')return rpc('apartman_notice_submit',{payload:data});
    if(path==='payment-notices/complete'&&method==='POST')return rpc('apartman_notice_complete',{payload:data});
    if(path==='payment-notices/review'&&method==='POST')return rpc('apartman_notice_review',{payload:data});
    if(path.startsWith('files/')){
      const objectPath=data?.path;
      if(typeof objectPath!=='string'||!/^(?:decisions\/)?\d+\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(objectPath))throw new Error('Geçersiz belge yolu.');
      const bucket='apartman-expense-files';
      if(path==='files/upload'&&method==='POST')return storageRequest('object/'+bucket+'/'+objectPath,'POST',data.file,data.file.type);
      if(path==='files/remove'&&method==='DELETE')return storageRequest('object/'+bucket,'DELETE',{prefixes:[objectPath]});
      if(path==='files/sign'&&method==='POST'){
        const result=await storageRequest('object/sign/'+bucket+'/'+objectPath,'POST',{expiresIn:60});
        if(typeof result.signedURL!=='string'||!result.signedURL.startsWith('/object/sign/'+bucket+'/'))throw new Error('Belge bağlantısı oluşturulamadı.');
        return {url:url+'/storage/v1'+result.signedURL};
      }
      throw new Error('Geçersiz belge işlemi.');
    }
    if(path==='expenses/save'&&method==='POST')return rpc('apartman_expense_save',{payload:data});
    if(path==='expenses/manage'&&method==='POST')return rpc('apartman_expense_manage',{payload:data});
    if(path==='bank'&&method==='PUT')return rpc('apartman_bank_save',{payload:data});
    if(path==='history')return rpc('apartman_change_history',{});
    if(path==='undo'&&method==='POST')return rpc('apartman_undo',{change_id:data.id});
    if(path==='payments/unit'&&method==='POST')return rpc('apartman_pay_unit',{payload:data});
    if(path==='payments/batch'&&method==='POST')return rpc('apartman_payment_batch_info',{batch_id:data.id});
    if(path==='payments/batch/undo'&&method==='POST')return rpc('apartman_undo_payment_batch',{batch_id:data.id});
    if(path==='state')return rpc('apartman_state',{});
    if(path==='backup')return rpc('apartman_backup',{});
    if(path==='decisions/reads')return rpc('apartman_decision_reads',{payload:data});
    if(['decisions/manage','tasks/manage'].includes(path)&&method==='POST')return rpc('apartman_work_manage',{kind:path==='decisions/manage'?'decision':'task',payload:data});
    if(path==='charges/opening'&&method==='POST')return rpc('apartman_opening_charge',{payload:data});
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
