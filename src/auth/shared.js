"use strict";
(() => {
  const local=location.protocol==='file:'||['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  const enabled=!local||new URLSearchParams(location.search).get('mode')==='shared',config=window.TOKI_CONFIG;
  const guestCode=new URLSearchParams(location.search).get('guest');
  if(enabled&&guestCode!==null&&window.TokiGuest){
    window.TokiShared=window.TokiGuest({config,code:guestCode});
    return;
  }
  const hooks={},PREFIX='toki-company-v1:',PROFILE=PREFIX+'profile';
  const GUEST_LINK='toki-guest-google-link-v1';
  const REVIEW_LINK=PREFIX+'review-link';
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  let client,authStorage,user=null,company=null,companies=[],online=false,fetchedAt=null,epoch=0,refreshing=false,initialized=false,retryAt=0;
  let importAfterLink=false;
  const emit=(event,value)=>hooks[event]?.(value),error=(message,code)=>Object.assign(Error(message),{code});
  const messages={MEMBER_NOT_STOPPED:'アクセス停止中の参加者だけ削除できます。一覧を開き直して状態を確認してください。',JOIN_LIMIT:'参加申請が混み合っています。時間を置くか、管理者にメールアドレスでの招待を依頼してください。',REQUEST_EXPIRED:'参加申請の期限が切れました。組織コードからもう一度申請してください。',RATE_LIMIT:'操作が集中しています。1分ほど待ってから再度お試しください。',AUTH:'Googleでログインしてください。',DENIED:'この組織のアクセス権限がありません。管理者に確認してください。',COMPANY:'組織コードを確認してください。',CONFLICT:'他の人が予定を変更しました。最新の予定からもう一度編集してください。',INVALID:'入力内容を確認してください。',LAST_ADMIN:'最後の管理者は解除できません。先に別の管理者を設定してください。',LIMIT:'登録数の上限に達しました。管理者に確認してください。',NETWORK:'接続できません。保存済みの予定は閲覧のみ利用できます。',CONFIG:'組織の認証設定が完了していません。管理者に確認してください。',STALE:'画面が切り替わったため処理を中止しました。'};
  Object.assign(messages,{
    UPDATE_REQUIRED:'最新版に更新してから、もう一度お試しください。',
    NAME_INVALID:'表示名は1〜40文字で入力してください。',
    NAME_TAKEN:'その名前はすでに使用されています。別の名前を入力してください。',
    MEMBER_EXISTS:'このアカウントはすでに登録されています。参加者一覧で確認してください。',
    REVIEW_CLOSED:'この手続きは期限切れか、すでに処理されています。',
    RENAME_PENDING:'この名前の変更依頼は承認待ちです。',
    SCHEDULE_BUSY:'登録済みのMTGと重なるため保存できません。',
    INVITE_INVALID:'招待パスワードが違うか、すでに使われています。',
    INVITE_LIMIT:'招待パスワードの入力失敗が続いたため、一時的に停止しました。時間を置くか、管理者へ参加を申請してください。',
  });
  const read=(key,fallback=null)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
  const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{emit('warning','端末に保存できません。オフライン閲覧や表示設定の保存が利用できない場合があります。');}};
  const remove=key=>{try{localStorage.removeItem(key);}catch{}};
  const profile=()=>user?{id:user.id,email:user.email}:null;
  const companyKey=id=>PREFIX+user.id+':'+id;
  const scope=()=>enabled?(user&&company?user.id+':'+company.id:'signed-out'):'local';
  const validCompany=c=>c&&typeof c.id==='string'&&typeof c.name==='string'&&typeof c.code==='string'&&['pending','active','blocked'].includes(c.status)&&['admin','member'].includes(c.role);
  function state(){emit('account',{user:profile(),company,companies,online});}
  function connection(value){online=value;emit('state',{online,fetchedAt});state();}
  function reset(){epoch++;refreshing=false;online=false;fetchedAt=null;emit('reset');}
  function eraseUser(id){
    const keys=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(PREFIX+id+':')||key?.startsWith('toki-view-v1:'+id+':'))keys.push(key);}}catch{}
    keys.forEach(remove);remove(PROFILE);
  }
  const validBoard=(b,organization=company)=>Boolean(b&&organization&&b.companyId===organization.id&&Number.isSafeInteger(b.version)&&b.version>=1&&window.TokiModel.valid(b.payload)&&
    (b.access?['admin','member'].includes(b.access.role)&&Array.isArray(b.payload.rows)&&
      (b.access.personId===null||b.payload.rows.some(row=>row.kind==='person'&&row.id===b.access.personId)):!organization.scopedSchedule));
  function cached(organization=company){
    if(!user||!organization)return null;
    const entry=read(companyKey(organization.id));
    return entry?.userId===user.id&&entry.companyId===organization.id&&Number.isFinite(entry.fetchedAt)&&
      validBoard(entry.board,organization)&&(!entry.board.access||entry.board.access.role===organization.role)?entry:null;
  }
  function cacheBoard(board){
    if(!validBoard(board))throw error(messages.INVALID,'INVALID');
    const previous=cached();if(previous?.board.version>board.version)return;
    if(board.access){
      company={...company,role:board.access.role,scopedSchedule:true};
      companies=companies.map(c=>c.id===company.id?company:c);
      remember();
    }
    fetchedAt=Date.now();write(companyKey(company.id),{userId:user.id,companyId:company.id,board,fetchedAt});
  }
  function networkFailure(failure,status){return !status||status===0||status>=500||/fetch|network|通信/i.test(failure?.message||'');}
  async function rpc(action,extra={},endpoint='toki_company'){
    if(!user)throw error(messages.AUTH,'AUTH');
    if(Date.now()<retryAt)throw error(messages.RATE_LIMIT,'RATE_LIMIT');
    if(navigator.onLine===false)throw error(messages.NETWORK,'NETWORK');
    const generation=epoch,identity=user.id;
    let result;try{result=await client.rpc(endpoint,{p_action:action,...extra});}catch{if(epoch!==generation||user?.id!==identity)throw error(messages.STALE,'STALE');throw error(messages.NETWORK,'NETWORK');}
    if(epoch!==generation||user?.id!==identity)throw error(messages.STALE,'STALE');
    if(result.error){
      const code=Object.hasOwn(messages,result.error.message)?result.error.message:result.status===401?'AUTH':result.status===403?'DENIED':result.status===429?'RATE_LIMIT':result.error.code==='PGRST202'?'CONFIG':networkFailure(result.error,result.status)?'NETWORK':'INVALID';
      if(code==='RATE_LIMIT')retryAt=Date.now()+60000;
      throw error(messages[code],code);
    }
    return result.data;
  }
  const remember=()=>{write(PROFILE,profile());write(PREFIX+user.id+':companies',companies);};
  async function listCompanies(){
    const data=await rpc('list');if(!Array.isArray(data)||!data.every(validCompany))throw error(messages.INVALID,'INVALID');
    const persisted=read(PREFIX+user.id+':companies',[]);
    if(Array.isArray(persisted))for(const prior of persisted.filter(validCompany)){
      const current=data.find(c=>c.id===prior.id&&c.status==='active');
      if(!current||!cached(current))remove(companyKey(prior.id));
    }
    companies=data;
    if(company){
      const current=companies.find(c=>c.id===company.id&&c.status==='active');
      if(current){
        company=current;
        if(current.scopedSchedule&&!cached())remove(companyKey(company.id));
      }
      else {remove(companyKey(company.id));reset();company=null;}
    }
    remember();state();return companies;
  }
  function accept(board){cacheBoard(board);emit('board',board);connection(true);}
  function reviewLink(){
    try{
      const value=JSON.parse(sessionStorage.getItem(REVIEW_LINK));
      return value&&uuid(value.organization)&&uuid(value.id)?value:null;
    }catch{return null;}
  }
  function clearReviewLink(){
    try{sessionStorage.removeItem(REVIEW_LINK);}catch{}
    const url=new URL(location.href);url.searchParams.delete('organization');url.searchParams.delete('review');
    history.replaceState(null,'',url);
  }
  function failed(failure){
    if(failure.code==='STALE')return;
    if(['AUTH','DENIED','CONFIG'].includes(failure.code)){
      if(user&&company)remove(companyKey(company.id));
      reset();company=null;state();
      if(failure.code==='AUTH'){const id=user?.id;user=null;companies=[];if(id)eraseUser(id);state();}
    }
    connection(false);emit('error',failure);
  }
  const fetchBoard=()=>{if(!company)throw error(messages.COMPANY,'COMPANY');return rpc('read',{p_company:company.id});};
  async function refresh(){
    if(!user||!company||refreshing)return;
    const generation=epoch;refreshing=true;
    try{accept(await fetchBoard());}catch(failure){failed(failure);}finally{if(generation===epoch)refreshing=false;}
  }
  async function selectCompany(id){
    const next=companies.find(c=>c.id===id&&c.status==='active');if(!next)throw error(messages.DENIED,'DENIED');
    // Reconnection verifies membership without discarding an open edit in this company.
    if(company?.id===next.id&&fetchedAt!==null){company=next;state();await refresh();return;}
    reset();company=next;write(PREFIX+user.id+':selected',id);state();
    try{accept(await fetchBoard());}catch(failure){
      if(failure.code==='NETWORK'){const entry=cached();if(entry){fetchedAt=entry.fetchedAt;emit('board',entry.board);}}
      failed(failure);if(failure.code!=='NETWORK'||!cached())throw failure;
    }
  }
  async function loadAccount(session){
    if(authStorage&&!authStorage.active)return;
    const next=session?.user||null;
    if(user?.id!==next?.id){const previous=user?.id;reset();company=null;companies=[];if(previous)eraseUser(previous);user=next;window.TokiGoogleCalendar?.logout();}
    if(!user){state();return;}
    try{
      await listCompanies();
    }catch(failure){
      if(failure.code==='NETWORK'){
        const saved=read(PREFIX+user.id+':companies',[]);companies=Array.isArray(saved)?saved.filter(validCompany):[];state();
      }else {failed(failure);return;}
    }
    const review=reviewLink(),reviewOrganization=companies.find(entry=>entry.id===review?.organization&&entry.status==='active');
    const selected=reviewOrganization?.id||company?.id||read(PREFIX+user.id+':selected');
    if(selected&&companies.some(c=>c.id===selected&&c.status==='active')){try{await selectCompany(selected);}catch{/* selectCompany reports the failure; keep reconnect listeners running. */}}
    else {if(company){remove(companyKey(company.id));reset();company=null;}state();}
  }
  function guestLinkIntent(){
    try{
      const item=JSON.parse(sessionStorage.getItem(GUEST_LINK));
      return item&&/^[A-F0-9]{32}$/.test(item.code)&&/^[a-f0-9]{64}$/.test(item.token)&&item.expiresAt>Date.now()?item:null;
    }catch{return null;}
  }
  function returnToGuest(intent,message){
    try{
      sessionStorage.removeItem(GUEST_LINK);
      sessionStorage.setItem('toki-guest-google-error-v1',JSON.stringify(message));
    }catch{}
    const url=new URL(config.siteUrl);url.searchParams.set('guest',intent.code);location.replace(url);
  }
  async function finishGuestLink(intent,authorizationCode){
    const {data,error:failure}=await client.auth.exchangeCodeForSession(authorizationCode);
    if(failure||!data?.session?.user)throw error('Googleログインを完了できませんでした。','AUTH');
    user=data.session.user;
    const result=await rpc('link_guest',{p_code:intent.code,p_payload:intent.token});
    if(typeof result?.id!=='string')throw error(messages.INVALID,'INVALID');
    const cache=read('toki-guest-v1:'+intent.code),cachedGuest=cache?.result?.guest;
    if(cachedGuest?.id){
      const before='toki-view-v1:guest:'+cachedGuest.id+':'+result.id+':';
      const after='toki-view-v1:'+user.id+':'+result.id+':';
      for(const name of ['groups','collapsed','excluded','toki-mobile-table-collapsed']){
        const value=read(before+name);
        if(value!==null){if(read(after+name)===null)write(after+name,value);remove(before+name);}
      }
    }
    remove('toki-guest-v1:'+intent.code);
    try{sessionStorage.removeItem(GUEST_LINK);}catch{}
    write(PREFIX+user.id+':selected',result.id);
    importAfterLink=Boolean(intent.calendar);
    await loadAccount(data.session);
  }
  async function initialize(callbacks){
    Object.assign(hooks,callbacks);if(!enabled||initialized)return;initialized=true;
    if(!config?.url||!config?.publishableKey)throw error(messages.CONFIG,'CONFIG');
    const query=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
    if(uuid(query.get('organization'))&&uuid(query.get('review'))){
      try{sessionStorage.setItem(REVIEW_LINK,JSON.stringify({organization:query.get('organization'),id:query.get('review')}));}catch{}
    }
    const guestLink=guestLinkIntent(),startsGuestLink=query.get('start-guest-google')==='1';
    const guestCode=guestLink&&!startsGuestLink?query.get('code'):null;
    const callbackKeys=['error','error_code','error_description'];
    const callbackFailure=callbackKeys.some(key=>query.has(key)||fragment.has(key));
    // Provider error descriptions may contain parts of an authorization code.
    // Report a safe message, and do not keep the failed callback in the address bar.
    if(callbackFailure){
      for(const key of [...callbackKeys,'sb']){query.delete(key);fragment.delete(key);}
      history.replaceState(null,'',location.pathname+(query.size?'?'+query:'')+(fragment.size?'#'+fragment:''));
    }
    remove('toki-offline-v1:'+config.boardId);remove('toki-participant-v2:'+config.boardId);
    if(location.hash.startsWith('#share='))history.replaceState(null,'',location.pathname+location.search);
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/supabase.js';script.onload=resolve;script.onerror=()=>reject(error('認証機能を読み込めません。再読み込みしてください。','LOAD'));document.head.append(script);});
    createAuthClient(!guestCode);
    let booting=true;
    listenAuth(()=>booting);
    if(startsGuestLink&&guestLink&&!callbackFailure){
      try{await login();}catch(failure){returnToGuest(guestLink,failure.message);}
      return;
    }
    if(guestLink&&(guestCode||callbackFailure)){
      if(callbackFailure){returnToGuest(guestLink,'Googleログインを完了できませんでした。');return;}
      query.delete('code');
      history.replaceState(null,'',location.pathname+(query.size?'?'+query:'')+location.hash);
      try{
        await finishGuestLink(guestLink,guestCode);
      }catch(failure){returnToGuest(guestLink,failure.message);return;}
    }
    const {data,error:authError}=guestCode?{}:await client.auth.getSession();booting=false;
    if(!authStorage.active)return;
    if(callbackFailure||authError&&!networkFailure(authError,authError.status)){
      state();emit('error',error('Googleログインを完了できませんでした。もう一度ログインしてください。繰り返す場合は、管理者にGoogle認証の設定を確認してもらってください。','OAUTH'));
    }
    else if(data?.session)await loadAccount(data.session);
    else if(navigator.onLine===false||authError&&networkFailure(authError,authError.status)){
      const saved=read(PROFILE);if(saved?.id&&saved?.email){user=saved;await loadAccount({user:saved});}else state();
    }else state();
    setInterval(()=>{if(!document.hidden){if(company)refresh();else if(user&&navigator.onLine!==false)listCompanies().catch(failed);}},5000);
    window.addEventListener('online',()=>loadAccount(user?{user}:null).catch(failed));
    window.addEventListener('offline',()=>connection(false));
    window.addEventListener('storage',event=>{if(event.key===authStorage?.epochKey&&!authStorage.active)clearAccount();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  }
  function createAuthClient(detectSessionInUrl=true){
    const storageKey='sb-'+new URL(config.url).hostname.split('.')[0]+'-auth-token';
    authStorage=window.TokiAuthStorage.create(localStorage,storageKey);
    client=window.TokiSupabase.createClient(config.url,config.publishableKey,{auth:{storageKey,storage:authStorage.adapter,flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl}});
  }
  function clearAccount(){
    const previous=user?.id;reset();company=null;companies=[];user=null;if(previous)eraseUser(previous);window.TokiGoogleCalendar?.logout();state();
  }
  function listenAuth(booting=()=>false){
    const storage=authStorage;
    client.auth.onAuthStateChange((event,session)=>{
      if(booting()||!storage.active||event==='INITIAL_SESSION')return;
      // Never await Supabase methods within the auth callback (SDK lock).
      if(event==='SIGNED_OUT')clearAccount();
      else if(session?.user.id!==user?.id)setTimeout(()=>{if(storage.active)loadAccount(session).catch(failed);},0);
    });
  }
  async function login(code){
    if(!client)throw error(messages.CONFIG,'CONFIG');
    if(!authStorage.active){await client.auth.dispose();createAuthClient();listenAuth();}
    if(code)write(PREFIX+'join-code',code.trim());
    const {error:failure}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:config.siteUrl,queryParams:{prompt:'select_account'}}});
    if(failure)throw error('Googleログインを開始できません。認証設定と接続を確認してください。','AUTH');
  }
  async function logout(){
    let session=null;
    try{session=authStorage?.invalidate();}
    catch{emit('warning','端末の認証情報を消去できませんでした。共有端末では、このサイトのブラウザーデータを削除してください。');}
    clearAccount();remove(PREFIX+'join-code');retryAt=0;
    if(client)await client.auth.dispose();
    const generation=epoch;
    if(session)window.TokiAuthStorage.revoke(window.TokiSupabase.createClient,config,session).then(success=>{
      if(!success&&epoch===generation&&!user)emit('warning','この端末からログアウトしました。通信障害のためサーバー側の認証終了は確認できませんが、端末から自動ログインはしません。');
    });
  }
  async function join(code,{mode,name,password}={}){
    const result=await rpc(mode==='invite'?'accept_invite':mode==='apply'?'apply':'join',{
      p_code:code,...(mode==='invite'?{p_payload:password}:mode==='apply'?{p_name:name}:{})
    });
    remove(PREFIX+'join-code');
    const list=await listCompanies();
    if(mode&&list.some(c=>c.id===result.id&&c.status==='active'))await selectCompany(result.id);
    return list;
  }
  async function manage(action,extra={}){
    if(!company)throw error(messages.COMPANY,'COMPANY');
    const value=await rpc(action,{p_company:company.id,...extra});
    if(value?.queued)return value;
    if(action==='transfer_admin'){
      // The committed response is authoritative; a subsequent list request must
      // not make a completed transfer look like a failed operation.
      company={...company,role:'member'};
      companies=companies.map(c=>c.id===company.id?company:c);remember();state();
    }else if(!['members','invite_batch','review_list','review_result','review_acknowledge','rename_request'].includes(action)){
      await listCompanies();
      if(company?.scopedSchedule)await refresh();
    }
    return value;
  }
  async function save(payload,version){
    if(!online||!company)throw error(messages.NETWORK,'NETWORK');
    try{const board=await rpc('save',{p_company:company.id,p_payload:payload,p_version:version});if(!board?.queued)cacheBoard(board);connection(true);return board;}
    catch(failure){
      const rejected=['DENIED','NAME_TAKEN','NAME_INVALID','SCHEDULE_BUSY','INVALID','LIMIT','UPDATE_REQUIRED'];
      if(!['CONFLICT','STALE'].includes(failure.code)&&!(company?.scopedSchedule&&rejected.includes(failure.code)))failed(failure);
      throw failure;
    }
  }
  async function changeRoster(action,extra,version){
    if(!online||!company)throw error(messages.NETWORK,'NETWORK');
    const value=await rpc(action,{p_company:company.id,p_version:version,...extra});
    if(value?.queued)return value;
    if(value?.left===true){remove(companyKey(company.id));leaveView();await listCompanies();return {left:true};}
    cacheBoard(value?.board);connection(true);return value;
  }
  function leaveView(){reset();company=null;state();}
  const shareUrl=()=>config.siteUrl+(company?'#company='+encodeURIComponent(company.code):'');
  const guestAdmin=(action,params)=>rpc(action,{p_company:company.id,...params},'toki_guest_admin');
  const guestUrl=ticket=>{
    const url=new URL(config.siteUrl);url.searchParams.set('guest',company.code);
    url.hash=new URLSearchParams({invite:ticket}).toString();return url.href;
  };
  window.TokiShared={enabled,companyAccess:true,initialize,save,changeRoster,refresh,fetchBoard,shareUrl,login,logout,join,selectCompany,listCompanies,manage,leaveView,guestAdmin,guestUrl,
    reviewLink,clearReviewLink,
    takeGuestImport(){const pending=importAfterLink;importAfterLink=false;return pending;},
    get online(){return online;},get scope(){return scope();},get user(){return profile();},get company(){return company;},get companies(){return companies;},
    get pendingCode(){return new URLSearchParams(location.hash.slice(1)).get('company')||read(PREFIX+'join-code','');}};
})();
