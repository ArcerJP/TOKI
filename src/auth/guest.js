"use strict";
window.TokiGuest = ({config,code}) => {
  const key='toki-guest-v1:'+code,pendingKey='toki-guest-pending-v1:'+code;
  const validCode=/^[0-9A-F]{32}$/.test(code);
  const isToken=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
  const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  const messages={
    GUEST_ACCESS:'ゲストの招待またはアクセスが無効です。管理者に新しい招待リンクを依頼してください。',
    NETWORK:'接続できません。保存済みの予定は閲覧できます。',
    INVALID:'ゲストの予定を確認できません。再読み込みしてください。',
    CONFLICT:'他の人が予定を変更しました。最新の予定でやり直してください。',
    DENIED:'自分の可能時間だけを編集できます。',
    SCHEDULE_BUSY:'登録済みのMTGと重なるため保存できません。',
    RATE_LIMIT:'操作が集中しています。1分ほど待ってから再度お試しください。',
  };
  let hooks={},active=null,token=null,online=false,fetchedAt=null,pending=null,epoch=0,inFlight=false,retryAt=0;
  const emit=(name,value)=>hooks[name]?.(value);
  const error=code=>Object.assign(Error(messages[code]||messages.INVALID),{code});
  const read=(storage,name)=>{try{return JSON.parse(storage.getItem(name));}catch{return null;}};
  const remove=(storage,name)=>{try{storage.removeItem(name);}catch{}};
  const write=(storage,name,value)=>{try{storage.setItem(name,JSON.stringify(value));return true;}catch{return false;}};
  const profile=()=>active&&{id:active.guest.id,email:'ゲスト · '+active.guest.name};
  const organization=()=>active&&{...active.company,role:'guest',status:'active'};
  const scope=()=>active?'guest:'+active.guest.id+':'+active.company.id:'guest-closed';
  const valid=entry=>Boolean(entry&&typeof entry.company?.id==='string'&&typeof entry.company?.name==='string'&&
    typeof entry.guest?.id==='string'&&typeof entry.guest?.name==='string'&&entry.board?.companyId===entry.company.id&&
    Number.isSafeInteger(entry.board.version)&&entry.board.version>0&&entry.board.access?.role==='guest'&&
    window.TokiModel.valid(entry.board.payload)&&entry.board.payload.rows?.some(row=>row.id===entry.board.access.personId&&row.kind==='person'));
  function connection(value){
    online=value;emit('state',{online,fetchedAt});
    emit('account',{user:profile(),company:organization(),companies:active?[organization()]:[],online});
  }
  function reset(){
    epoch++;active=null;token=null;online=false;fetchedAt=null;emit('reset');
  }
  async function rpc(action,credential,extra={}){
    if(!validCode||!isToken(credential))throw error('GUEST_ACCESS');
    if(navigator.onLine===false)throw error('NETWORK');
    if(Date.now()<retryAt)throw error('RATE_LIMIT');
    let response;const generation=epoch;
    try{
      response=await fetch(config.url+'/rest/v1/rpc/toki_guest',{
        method:'POST',cache:'no-store',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},
        body:JSON.stringify({p_action:action,p_code:code,p_token:credential,...extra})
      });
    }catch{throw error('NETWORK');}
    let value;
    try{value=await response.json();}catch{throw error(response.status>=500?'NETWORK':'INVALID');}
    if(generation!==epoch)throw Object.assign(Error(),{code:'STALE'});
    if(!response.ok||value?.code){
      const code=Object.hasOwn(messages,value?.message)?value.message:response.status>=500?'NETWORK':'INVALID';
      if(code==='RATE_LIMIT')retryAt=Date.now()+60000;
      throw error(code);
    }
    return value;
  }
  function accept(result,credential,persist=true){
    if(!valid(result))throw error('INVALID');
    if(active&&active.guest.id!==result.guest.id){reset();}
    if(active&&active.board.version>result.board.version)return active.board;
    active=result;token=credential;
    if(persist){
      const previous=read(localStorage,key);
      const inviteDigest=pending?.digest??(previous?.token===credential?previous.inviteDigest:null);
      fetchedAt=Date.now();
      if(!write(localStorage,key,{token,result,fetchedAt,inviteDigest}))emit('warning','この端末に保存できません。再訪やオフライン閲覧に招待リンクの再発行が必要になる場合があります。');
    }
    return active.board;
  }
  function clearCurrent(credential){
    const saved=read(localStorage,key);
    if(saved&&saved.token===credential){
      remove(localStorage,key);
      const result=saved.result;
      if(valid(result))for(const preference of ['groups','collapsed','excluded'])
        remove(localStorage,`toki-view-v1:guest:${result.guest.id}:${result.company.id}:${preference}`);
    }
    reset();
  }
  async function refresh(){
    if(inFlight)return;
    inFlight=true;
    const cached=read(localStorage,key);
    const invitation=pending,credential=invitation?.token||token||cached?.token;
    const generation=epoch;
    try{
      const result=await rpc(invitation?'claim':'read',credential,invitation?{p_invite:invitation.invite}:{});
      const board=accept(result,credential);
      if(invitation){pending=null;remove(sessionStorage,pendingKey);}
      emit('board',board);connection(true);
    }catch(failure){
      if(failure.code==='STALE'||generation!==epoch)return;
      if(failure.code==='GUEST_ACCESS'){
        if(invitation){pending=null;remove(sessionStorage,pendingKey);reset();}
        else clearCurrent(credential);
      }
      if(failure.code==='NETWORK'&&!active&&!invitation&&isToken(cached?.token)&&valid(cached.result)){
        fetchedAt=cached.fetchedAt;emit('board',accept(cached.result,cached.token,false));
      }
      connection(false);emit('error',failure);
    }finally{inFlight=false;}
  }
  async function initialize(callbacks){
    hooks=callbacks;
    const fragment=new URLSearchParams(location.hash.slice(1)),invite=fragment.get('invite');
    if(fragment.has('invite'))history.replaceState(null,'',location.pathname+location.search);
    const saved=read(sessionStorage,pendingKey),cached=read(localStorage,key);
    const digest=isToken(invite)?hex(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(invite,c=>c.charCodeAt(0))))):null;
    if(digest&&digest===cached?.inviteDigest&&isToken(cached.token)){
      token=cached.token;remove(sessionStorage,pendingKey);
    }else if(digest&&(saved?.invite!==invite||!isToken(saved.token))){
      pending={invite,digest,token:hex(crypto.getRandomValues(new Uint8Array(32)))};
      write(sessionStorage,pendingKey,pending);
    }else if(isToken(saved?.invite)&&isToken(saved.token))pending=saved;
    await refresh();
    setInterval(()=>{if(!document.hidden&&(token||pending))refresh();},5000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(token||pending))refresh();});
    window.addEventListener('online',refresh);
    window.addEventListener('offline',()=>connection(false));
    window.addEventListener('storage',event=>{
      if(event.key!==key||!token||read(localStorage,key)?.token===token)return;
      reset();connection(false);emit('error',error('GUEST_ACCESS'));
    });
  }
  async function save(payload,version){
    if(!online||!token)throw error('NETWORK');
    try{return accept(await rpc('save',token,{p_payload:payload,p_version:version}),token);}
    catch(failure){if(failure.code==='GUEST_ACCESS'){clearCurrent(token);connection(false);emit('error',failure);}throw failure;}
  }
  const mainPage=()=>location.assign(config.siteUrl);
  async function logout(){
    const credential=token;
    clearCurrent(credential);pending=null;remove(sessionStorage,pendingKey);
    if(credential){try{await rpc('leave',credential);}catch{}}
    mainPage();
  }
  return {
    enabled:true,companyAccess:true,guest:true,initialize,save,refresh,logout,leaveView:mainPage,login:mainPage,
    listCompanies:async()=>active?[organization()]:[],shareUrl:()=>'',pendingCode:'',
    get scope(){return scope();},get online(){return online;},get user(){return profile();},get company(){return organization();},
    get companies(){return active?[organization()]:[];}
  };
};
