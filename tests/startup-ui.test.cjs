const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const {sourcePath}=require('../scripts/pwa-assets.cjs');
const flush=()=>new Promise(resolve=>setTimeout(resolve,40));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const user={id:'test-user',email:'member@example.test'};
const company={id:'test-company',name:'Test company',code:'a'.repeat(32),role:'member',status:'active'};
const board={companyId:company.id,version:1,payload:{schemaVersion:4,people:['Test member'],groups:[],events:[],meetings:[]}};
async function environment(t,{width=1440,selected=true,offline=false,cached=false,sdkFailure=false}={}){
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(sourcePath('index.html'),'utf8'),{url:'https://example.test/TOKI/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const w=dom.window,$=id=>w.document.getElementById(id),session=deferred(),list=deferred(),read=deferred(),calls=[];
  t.after(()=>{w.close();assert.deepEqual(errors,[]);});
  // The first HTML paint must not show sign-in, company choices, or an unverified board.
  assert.equal($('auth-gate').hidden,true);assert.equal($('schedule-app').hidden,true);assert.equal($('mobile-app').hidden,true);assert.equal($('app-loading').hidden,false);
  let gateShown=false;
  const observer=new w.MutationObserver(records=>{if(!$('auth-gate').hidden||records.some(r=>r.oldValue===null))gateShown=true;});
  observer.observe($('auth-gate'),{attributes:true,attributeFilter:['hidden'],attributeOldValue:true});
  w.scrollTo=()=>{};w.matchMedia=q=>({matches:q.includes('767')?width<=767:false,addEventListener(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  Object.defineProperty(w.navigator,'onLine',{value:!offline});
  w.setInterval=()=>0;
  w.TOKI_DATA={people:[],dates:['2026-10-05'],availability:[]};w.TOKI_DATA_READY=Promise.resolve();
  w.TOKI_CONFIG={url:'https://example.supabase.co',publishableKey:'public-test',siteUrl:'https://example.test/TOKI/'};
  w.TokiSupabase={createClient:()=>({auth:{getSession:()=>session.promise,onAuthStateChange(){},dispose:async()=>{}},rpc:async(name,args)=>{calls.push(args.p_action);return args.p_action==='list'?list.promise:read.promise;}})};
  const append=w.document.head.append.bind(w.document.head);
  w.document.head.append=node=>{if(node.src?.endsWith('/vendor/supabase.js'))queueMicrotask(()=>sdkFailure?node.onerror():node.onload());else append(node);};
  if(selected)w.localStorage.setItem('toki-company-v1:'+user.id+':selected',JSON.stringify(company.id));
  w.localStorage.setItem('toki-view-v1:'+user.id+':'+company.id+':groups',JSON.stringify({version:1,selected:['@unassigned']}));
  if(cached){
    w.localStorage.setItem('toki-company-v1:profile',JSON.stringify(user));
    w.localStorage.setItem('toki-company-v1:'+user.id+':companies',JSON.stringify([company]));
    w.localStorage.setItem('toki-company-v1:'+user.id+':'+company.id,JSON.stringify({userId:user.id,companyId:company.id,board,fetchedAt:Date.now()}));
  }
  for(const name of ['auth-storage','shared','model','availability','schedule','availability-ui','meeting-menu','meeting-export-ui','row-drag','calendar-import','google-calendar','google-import-ui','mobile-model','mobile-ui','group-view','company-ui'])w.eval(fs.readFileSync(sourcePath(name+'.js'),'utf8'));
  const finished=w.eval(fs.readFileSync(sourcePath('app.js'),'utf8'));
  await flush();
  return {w,$,session,list,read,calls,finished,get gateShown(){return gateShown;},async signIn(value=user){session.resolve({data:{session:value?{user:value}:null}});await flush();},async companies(value=[company]){list.resolve({data:value});await flush();},async board(value={data:board}){read.resolve(value);await finished;await flush();}};
}
function assertLoading(e){
  assert.equal(e.$('app-loading').hidden,false);assert.equal(e.$('auth-gate').hidden,true);assert.equal(e.gateShown,false);
  assert.equal(e.$('schedule-app').hidden,true);assert.equal(e.$('mobile-app').hidden,true);
}
function assertGate(e){assert.equal(e.$('app-loading').hidden,true);assert.equal(e.$('auth-gate').hidden,false);assert.equal(e.$('schedule-app').hidden,true);assert.equal(e.$('mobile-app').hidden,true);}

for(const width of [1440,390])test(`returning user opens the verified board without flashing company choices (${width}px)`,async t=>{
  const e=await environment(t,{width});assertLoading(e);
  await e.signIn();assertLoading(e);assert.deepEqual(e.calls,['list']);
  await e.companies();assertLoading(e);assert.deepEqual(e.calls,['list','read']);
  // Even though the intermediate account notification renders the choices, they stay hidden.
  assert.match(e.$('company-list').textContent,/予定表を開く/);
  await e.board();assert.equal(e.gateShown,false);assert.equal(e.$('app-loading').hidden,true);assert.equal(e.$('auth-gate').hidden,true);
  assert.equal(e.$('schedule-app').hidden,false);assert.equal(e.$('mobile-app').hidden,width>767);
  assert.equal(e.w.TokiShared.online,true);
  assert.equal(e.$('company-button').querySelectorAll('svg.account-icon').length,1);
  if(width<768)assert.equal(e.$('mobile-app').querySelectorAll('button[aria-label="会社・アカウント"] svg.account-icon').length,1);
  // An explicit switch and a later logout must still show the original controls.
  e.w.TokiShared.leaveView();await flush();assertGate(e);assert.match(e.$('company-list').textContent,/予定表を開く/);
  await e.w.TokiShared.logout();await flush();assertGate(e);assert.equal(e.$('company-login').hidden,false);assert.equal(e.$('company-signed-in').hidden,true);
});

test('no session and no selected company show the appropriate gate after checking',async t=>{
  const signedOut=await environment(t);assertLoading(signedOut);await signedOut.signIn(null);await signedOut.finished;assertGate(signedOut);
  assert.equal(signedOut.$('company-login').hidden,false);assert.deepEqual(signedOut.calls,[]);
  const chooser=await environment(t,{selected:false});await chooser.signIn();assertLoading(chooser);await chooser.companies();await chooser.finished;assertGate(chooser);
  assert.match(chooser.$('auth-message').textContent,/開く会社/);assert.deepEqual(chooser.calls,['list']);
});

test('revoked membership never reveals an old board and leaves the gate usable',async t=>{
  const e=await environment(t,{cached:true});await e.signIn();await e.companies();assertLoading(e);
  await e.board({status:403,error:{message:'DENIED'}});assertGate(e);assert.match(e.$('auth-message').textContent,/アクセス権限/);
  assert.equal(e.$('auth-retry').hidden,false);assert.equal(e.$('chart').textContent.includes('Test member'),false);
  assert.equal(e.w.localStorage.getItem('toki-company-v1:'+user.id+':'+company.id),null);
});

test('offline restoration opens only an existing permitted snapshot without flashing choices',async t=>{
  const e=await environment(t,{offline:true,cached:true});assertLoading(e);await e.signIn(null);await e.finished;await flush();
  assert.equal(e.gateShown,false);assert.equal(e.$('app-loading').hidden,true);assert.equal(e.$('schedule-app').hidden,false);
  assert.equal(e.w.TokiShared.online,false);assert.equal(e.$('add-person').disabled,true);assert.deepEqual(e.calls,[]);
  const empty=await environment(t,{offline:true});await empty.signIn();await empty.finished;assertGate(empty);
});

test('SDK and OAuth failures replace loading with a visible error and retry',async t=>{
  const sdk=await environment(t,{sdkFailure:true});await sdk.finished;assertGate(sdk);assert.match(sdk.$('auth-message').textContent,/認証機能を読み込めません/);assert.equal(sdk.$('auth-retry').hidden,false);
  const oauth=await environment(t);oauth.session.resolve({data:{session:null},error:{status:400,message:'private-provider-message'}});await oauth.finished;assertGate(oauth);
  assert.match(oauth.$('auth-message').textContent,/Googleログインを完了できません/);assert.equal(oauth.$('auth-message').textContent.includes('private-provider-message'),false);
});
