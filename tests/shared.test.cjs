const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync('shared.js','utf8');
const token='a'.repeat(64);
const board=()=>({payload:{people:['既存の人'],dates:[],events:[]},version:1});
function environment(store={board:board(),registrations:new Map()},storage=new Map(),hash=`#share=${token}`){
  let apiError=false;
  const calls=[],notifications=[],participants=[];
  const client={async rpc(name,args){
    calls.push({name,args});
    if(apiError)return {error:{message:'offline'}};
    if(args.p_token!==token)return {error:{message:'LINK'}};
    const key=args.p_registration;
    if(args.p_action==='join'&&!store.registrations.has(key)){
      if(store.board.payload.people.some(n=>n.toLowerCase()===args.p_name.toLowerCase()))return {error:{message:'NAME_TAKEN'}};
      const person=store.board.payload.people.length;
      store.board.payload.people.push(args.p_name);store.registrations.set(key,person);store.board.version++;
    }
    if(args.p_action==='save'){
      if(args.p_version!==store.board.version)return {error:{message:'CONFLICT'}};
      store.board={payload:structuredClone(args.p_payload),version:args.p_version+1};
    }
    return {data:{...structuredClone(store.board),person:store.registrations.get(key)??null}};
  }};
  const window={TOKI_CONFIG:{url:'https://example.supabase.co',publishableKey:'public-test',boardId:'october-2026',siteUrl:'https://example.test/'},TokiSupabase:{createClient:()=>client},addEventListener(){}};
  const document={hidden:false,createElement:()=>({}),head:{append:script=>queueMicrotask(()=>script.onload())},addEventListener(){}};
  vm.runInNewContext(source,{window,document,location:{protocol:'https:',hostname:'example.github.io',search:'',hash},crypto,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},URLSearchParams,setInterval:()=>0});
  const adapter=window.TokiShared;
  return {adapter,calls,notifications,participants,async init(){await adapter.initialize({board:value=>notifications.push(value),participant:value=>participants.push(value),error:value=>notifications.push(value)});},setFailure:()=>{apiError=true;}};
}

test('link visitor can join without account and edit the schedule',async()=>{const env=environment();await env.init();assert.equal(env.notifications.length,0);await env.adapter.join('新しい人');assert.equal(env.participants[0].person,1);const saved=await env.adapter.save({people:['既存の人','新しい人'],events:[]},2);assert.equal(saved.version,3);});
test('duplicate name is rejected and does not reuse or append a row',async()=>{const env=environment();await env.init();await assert.rejects(env.adapter.join('  既存の人  '),e=>e.code==='NAME_TAKEN'&&e.message.includes('別の名前'));assert.equal((await env.adapter.fetchBoard()).payload.people.length,1);});
test('registration resumes after reload and retry does not create another row',async()=>{const store={board:board(),registrations:new Map()},storage=new Map();const a=environment(store,storage);await a.init();await a.adapter.join('Alice');await a.adapter.join('Alice');const b=environment(store,storage,'');await b.init();assert.equal(b.participants[0].name,'Alice');assert.equal(store.board.payload.people.length,2);});
test('different device entering an existing registered name is warned',async()=>{const store={board:board(),registrations:new Map()},a=environment(store),b=environment(store);await a.init();await b.init();await a.adapter.join('Alice');await assert.rejects(b.adapter.join('Ａｌｉｃｅ'),e=>e.code==='NAME_TAKEN');});
test('two devices cannot silently overwrite the same revision',async()=>{const store={board:board(),registrations:new Map()},a=environment(store),b=environment(store);await a.init();await b.init();await a.adapter.save({people:['既存の人'],events:[{title:'first change'}]},1);await assert.rejects(b.adapter.save({people:['既存の人'],events:[{title:'stale change'}]},1),e=>e.code==='CONFLICT');assert.equal(store.board.payload.events[0].title,'first change');});
test('missing link never makes an API request',async()=>{const env=environment(undefined,undefined,'');await assert.rejects(env.init(),e=>e.code==='LINK');assert.equal(env.calls.length,0);});
test('wrong link is rejected by the backend',async()=>{const env=environment(undefined,undefined,`#share=${'b'.repeat(64)}`);await assert.rejects(env.init(),e=>e.code==='LINK');});
test('network failure never reports success',async()=>{const env=environment();await env.init();env.setFailure();await assert.rejects(env.adapter.save({},1),e=>e.code==='NETWORK');});
test('public starter contains no personal names or schedules',()=>{const window={};vm.runInNewContext(fs.readFileSync('data.js','utf8'),{window,location:{protocol:'https:',hostname:'example.github.io'},document:{}});assert.equal(window.TOKI_DATA.people.length,16);assert.equal(window.TOKI_DATA.people[0],'メンバー1');assert.ok(window.TOKI_DATA.availability.flat().every(value=>value===''));});
