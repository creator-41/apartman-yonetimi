export function installGuide(userAgent=''){
 return /iPad|iPhone|iPod/i.test(userAgent)?'ios':/Android/i.test(userAgent)?'android':'desktop';
}
export function initPwa({showGuide,showStatus,win=window,nav=navigator,doc=document}){
 let pending=null;
 const display=win.matchMedia?.('(display-mode: standalone)');
 const installed=()=>Boolean(nav.standalone||display?.matches);
 const panel=doc.querySelector('#installPanel'),connection=doc.querySelector('#connectionStatus');
 const update=()=>{if(panel)panel.hidden=installed();if(connection)connection.hidden=nav.onLine!==false;};
 update();
 win.addEventListener('online',update);win.addEventListener('offline',update);
 display?.addEventListener?.('change',update);
 win.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event;update();});
 win.addEventListener('appinstalled',()=>{pending=null;if(panel)panel.hidden=true;showStatus('Komşu ana ekranınıza eklendi.');});
 if('serviceWorker' in nav){
  const register=()=>nav.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
  if(doc.readyState==='complete')register();else win.addEventListener('load',register,{once:true});
 }
 return async()=>{
  if(installed()){showStatus('Komşu uygulama olarak açık.');return;}
  if(pending){
   const prompt=pending;pending=null;
   try{await prompt.prompt();await prompt.userChoice;return;}catch{/* Fall back to the browser menu instructions. */}
  }
  showGuide(installGuide(nav.userAgent));
 };
}
