"use strict";
// Isolate SDK lifetimes: a late token refresh must never undo a local logout.
(() => {
  function create(storage,key,random=()=>crypto.randomUUID()){
    const epochKey=key+'-logout-epoch',generation=storage.getItem(epochKey);
    let closed=false;
    const active=()=>!closed&&storage.getItem(epochKey)===generation;
    const owns=k=>k===key||k.startsWith(key+'-')&&k!==epochKey;
    const adapter={
      getItem:k=>active()?storage.getItem(k):null,
      setItem:(k,v)=>{if(active())storage.setItem(k,v);},
      removeItem:k=>{if(active())storage.removeItem(k);}
    };
    function invalidate(){
      const session=active()?storage.getItem(key):null;
      closed=true;
      // Synchronous deletion happens before any network operation.
      const keys=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k&&owns(k))keys.push(k);}
      keys.forEach(k=>storage.removeItem(k));
      storage.setItem(epochKey,random());
      return session;
    }
    return {adapter,invalidate,epochKey,get active(){return active();}};
  }
  async function revoke(createClient,config,session,options={}){
    if(!session)return true;
    // A separate, memory-only SDK instance can refresh an expired token before
    // revocation without restoring it on disk or broadcasting to a new login.
    const key='toki-logout-'+crypto.randomUUID(),memory=new Map([[key,session]]);
    const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
    let revoker;
    try{
      revoker=createClient(config.url,config.publishableKey,{...options,auth:{storageKey:key,storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
      return !(await revoker.auth.signOut({scope:'local'})).error;
    }
    catch{return false;}
    finally{try{await revoker?.auth.dispose();}catch{}finally{memory.clear();}}
  }
  const api={create,revoke};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.TokiAuthStorage=api;
})();
