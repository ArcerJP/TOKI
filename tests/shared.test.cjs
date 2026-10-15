const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const payload=()=>({schemaVersion:4,people:['Member'],groups:[],events:[],meetings:[]});
const choices=()=>['a','b'].map(id=>({id,name:'Company '+id,code:id.repeat(32),role:'member',status:'active'}));
function environment({storage=new Map(),identity='u1',offline=false,search='',hash='',authError=null}={}){
  let failure=null,callback,handler;const calls=[],boards=[],resets=[],errors=[],states=[],accounts=[],listeners={},navigator={onLine:!offline};
  const store={a:{companyId:'a',payload:payload(),version:1},b:{companyId:'b',payload:{...payload(),people:['Other company']},version:1}};
  const session=()=>identity?{user:{id:identity,email:identity+'@example.com'}}:null;
  const client={auth:{onAuthStateChange:fn=>callback=fn,getSession:async()=>({data:{session:session()},error:authError}),signInWithOAuth:async args=>{calls.push({oauth:args});return {};},signOut:async()=>{identity=null;callback('SIGNED_OUT',null);return {};}},async rpc(name,args){
    calls.push({name,args});if(handler)return handler(name,args);
    if(failure)return {status:failure==='NETWORK'?0:400,error:{message:failure}};
    if(args.p_action==='list')return {data:choices()};
    if(args.p_action==='save'){if(args.p_version!==store[args.p_company].version)return {status:400,error:{message:'CONFLICT'}};store[args.p_company]={companyId:args.p_company,payload:structuredClone(args.p_payload),version:args.p_version+1};}
    return {data:structuredClone(store[args.p_company]||{})};
  }};
  const localStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const window={TOKI_CONFIG:{url:'https://example.supabase.co',publishableKey:'public-test',boardId:'october-2026',siteUrl:'https://example.test/'},TokiSupabase:{createClient:()=>client},addEventListener:(type,fn)=>listeners[type]=fn};
  vm.runInNewContext(fs.readFileSync('model.js','utf8'),{window});
  const document={hidden:false,createElement:()=>({}),head:{append:s=>queueMicrotask(()=>s.onload())},addEventListener(){}};
  const replacedUrls=[];
  vm.runInNewContext(fs.readFileSync('shared.js','utf8'),{window,document,navigator,localStorage,location:{protocol:'https:',hostname:'example.test',search,hash,pathname:'/'},history:{replaceState:(state,title,url)=>replacedUrls.push(url)},URLSearchParams,setInterval:()=>0,setTimeout});
  return {api:window.TokiShared,calls,boards,resets,errors,states,accounts,storage,store,navigator,listeners,replacedUrls,init:()=>window.TokiShared.initialize({board:b=>boards.push(b),reset:()=>resets.push(1),error:e=>errors.push(e),state:s=>states.push(s),account:a=>accounts.push(a)}),fail:x=>failure=x,handle:fn=>handler=fn,async changeUser(id){identity=id;callback('SIGNED_IN',session());await new Promise(r=>setTimeout(r,10));}};
}

test('failed OAuth callbacks show a safe error, clean the URL, and never select a previous account',async()=>{
  const e=environment({search:'?mode=shared&error=server_error&error_code=unexpected_failure&error_description=private-code',hash:'#company=abc&error=server_error&error_description=private-code&sb=1'});
  await e.init();assert.equal(e.api.user,null);assert.equal(e.calls.length,0);
  assert.equal(e.errors[0].code,'OAUTH');assert.ok(e.errors[0].message.includes('Googleログイン'));
  assert.equal(e.errors[0].message.includes('private-code'),false);
  assert.equal(e.replacedUrls[0],'/?mode=shared#company=abc');
});

test('SDK authentication errors are visible without exposing their raw message',async()=>{
  const e=environment({identity:null,authError:{status:400,message:'private-code'}});await e.init();
  assert.equal(e.errors[0].code,'OAUTH');assert.equal(e.errors[0].message.includes('private-code'),false);assert.equal(e.boards.length,0);
});

test('rate limiting backs off locally and an HTTP permission denial clears cached data',async()=>{
  const e=environment();await e.init();await e.api.selectCompany('a');
  e.handle(()=>({status:403,error:{message:'Forbidden'}}));await e.api.refresh();
  assert.equal(e.api.company,null);assert.equal(e.storage.has('toki-company-v1:u1:a'),false);
  const limited=environment();await limited.init();limited.handle(()=>({status:429,error:{message:'RATE_LIMIT'}}));
  await assert.rejects(limited.api.join('a'),x=>x.code==='RATE_LIMIT');const count=limited.calls.length;
  await assert.rejects(limited.api.join('b'),x=>x.code==='RATE_LIMIT');assert.equal(limited.calls.length,count);
  assert.equal(limited.api.createCompany,undefined);
});
test('login is required; a sharing link is never used as authorization',async()=>{
  const e=environment({identity:null});await e.init();assert.equal(e.calls.length,0);await assert.rejects(e.api.join('a'),x=>x.code==='AUTH');
  await e.api.login('a');assert.equal(e.calls[0].oauth.provider,'google');assert.equal(e.calls[0].oauth.options.redirectTo,'https://example.test/');assert.equal(e.api.user,null);
});
test('only the explicitly selected approved company is read and its ID accompanies every save',async()=>{
  const e=environment();await e.init();assert.equal(e.boards.length,0);await e.api.selectCompany('a');assert.equal(e.boards[0].companyId,'a');
  await e.api.save({...payload(),people:['Saved']},1);assert.equal(e.calls.at(-1).args.p_company,'a');assert.equal(e.calls.at(-1).name,'toki_company');assert.ok(e.calls.every(c=>!c.args?.p_token));
  await assert.rejects(e.api.selectCompany('unknown'),x=>x.code==='DENIED');
});
test('offline cache is scoped to both user and company, and editing is disabled',async()=>{
  const storage=new Map(),a=environment({storage});await a.init();await a.api.selectCompany('a');await a.api.save({...payload(),people:['Saved A']},1);
  const b=environment({storage,offline:true});await b.init();assert.equal(b.boards[0].payload.people[0],'Saved A');assert.equal(b.api.online,false);assert.ok(b.states.at(-1).fetchedAt);
  await assert.rejects(b.api.save(payload(),2),x=>x.code==='NETWORK');await assert.rejects(b.api.selectCompany('b'),x=>x.code==='NETWORK');assert.equal(b.boards.length,1);
  const other=environment({storage,identity:'u2',offline:true});await other.init();assert.equal(other.boards.length,0);
});
test('returning online rechecks membership before restoring edits',async()=>{
  const e=environment();await e.init();await e.api.selectCompany('a');e.fail('NETWORK');await e.api.refresh();assert.equal(e.api.online,false);
  const resets=e.resets.length;e.fail(null);await e.listeners.online();assert.equal(e.api.online,true);assert.equal(e.calls.at(-2).args.p_action,'list');assert.equal(e.resets.length,resets,'keep the current editor until a different board version arrives');
});
test('revocation clears the current board and its offline snapshot',async()=>{
  const e=environment();await e.init();await e.api.selectCompany('a');const before=e.resets.length;e.fail('DENIED');await e.api.refresh();
  assert.equal(e.api.company,null);assert.equal(e.api.online,false);assert.ok(e.resets.length>before);assert.equal(e.storage.has('toki-company-v1:u1:a'),false);
});
test('logout clears all company caches for that user and returns to the sign-in gate',async()=>{
  const e=environment();await e.init();await e.api.selectCompany('a');await e.api.selectCompany('b');await e.api.logout();
  assert.equal(e.api.user,null);assert.equal(e.api.company,null);assert.ok([...e.storage.keys()].every(k=>!k.startsWith('toki-company-v1:u1:')));
});
test('late reads and writes from the previous company cannot replace the newly selected board',async()=>{
  for(const operation of ['read','save']){
    const e=environment();await e.init();await e.api.selectCompany('a');let release;
    e.handle((name,args)=>args.p_company==='a'?new Promise(resolve=>release=resolve):Promise.resolve({data:e.store.b}));
    const pending=operation==='read'?e.api.refresh():e.api.save({...payload(),people:['Late']},1);
    const rejected=operation==='save'?assert.rejects(pending,x=>x.code==='STALE'):pending;
    await e.api.selectCompany('b');release({data:{...e.store.a,version:3}});await rejected;
    assert.equal(e.api.company.id,'b');assert.equal(e.boards.at(-1).companyId,'b');assert.equal(e.api.online,true);
  }
});
test('changing Google accounts purges the previous account and does not reuse its last company',async()=>{
  const e=environment();await e.init();await e.api.selectCompany('a');await e.changeUser('u2');
  assert.equal(e.api.user.id,'u2');assert.equal(e.api.company,null);assert.equal(e.storage.has('toki-company-v1:u1:a'),false);
});
test('failed saves, corrupt data, and stale reads never replace a successful offline snapshot',async()=>{
  const e=environment();await e.init();await e.api.selectCompany('a');await e.api.save({...payload(),people:['Newer']},1);
  e.store.a={companyId:'a',payload:payload(),version:1};await e.api.refresh();
  assert.equal(JSON.parse(e.storage.get('toki-company-v1:u1:a')).board.payload.people[0],'Newer');
  e.fail('CONFLICT');await assert.rejects(e.api.save(payload(),1));assert.equal(e.api.online,true);
  const cached=JSON.parse(e.storage.get('toki-company-v1:u1:a'));cached.board.companyId='b';e.storage.set('toki-company-v1:u1:a',JSON.stringify(cached));
  const other=environment({storage:e.storage,offline:true});await other.init();assert.equal(other.boards.length,0);
});
