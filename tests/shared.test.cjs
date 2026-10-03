const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('shared.js','utf8');
const board=()=>({payload:{people:Array.from({length:16},(_,i)=>`Member ${i+1}`),dates:[],events:[]},version:1});
function environment(store={board:board()},authorized=true){
  let authCallback,session=authorized?{user:{id:'member'}}:null,apiError=false;
  const calls=[];const notifications=[];
  const channel={on(){return this;},subscribe(callback){callback('SUBSCRIBED');return this;}};
  const client={
    auth:{async getSession(){return {data:{session},error:null};},onAuthStateChange(callback){authCallback=callback;},async signInWithPassword(){session={user:{id:'member'}};authCallback('SIGNED_IN',session);return {error:null};},async signOut(){session=null;authCallback('SIGNED_OUT',null);return {error:null};}},
    channel:()=>channel,removeChannel:async()=>{},
    from(table){let payload,version;calls.push(table);return {select(){return this;},update(next){payload=next.payload;return this;},eq(key,value){if(key==='version')version=value;return this;},async maybeSingle(){if(apiError)return {data:null,error:{message:'offline'}};if(!authorized)return {data:null,error:null};if(payload){if(version!==store.board.version)return {data:null,error:null};store.board={payload:structuredClone(payload),version:version+1};}return {data:structuredClone(store.board),error:null};}};}
  };
  const window={TOKI_CONFIG:{url:'https://example.supabase.co',publishableKey:'public-test',boardId:'october-2026'},TokiSupabase:{createClient:()=>client},addEventListener(){}};
  const document={hidden:false,createElement:()=>({}),head:{append:script=>queueMicrotask(()=>script.onload())},addEventListener(){}};
  vm.runInNewContext(source,{window,document,location:{protocol:'https:',hostname:'example.github.io',search:''},URLSearchParams,setInterval:()=>0,setTimeout:fn=>{queueMicrotask(fn);return 0;}});
  const adapter=window.TokiShared;
  return {adapter,calls,notifications,async init(){await adapter.initialize({board:value=>notifications.push(value),auth:()=>{},error:value=>notifications.push(value)});},setFailure:()=>{apiError=true;}};
}
test('member loads current data and saves with an exact version',async()=>{const env=environment();await env.init();assert.equal(env.notifications[0].version,1);const saved=await env.adapter.save({events:[]},1);assert.equal(saved.version,2);});
test('two devices cannot silently overwrite the same revision',async()=>{const store={board:board()},a=environment(store),b=environment(store);await a.init();await b.init();await a.adapter.save({events:[{title:'first change'}]},1);await assert.rejects(b.adapter.save({events:[{title:'stale change'}]},1),e=>e.code==='CONFLICT');assert.equal(store.board.payload.events[0].title,'first change');});
test('anonymous session never reads or writes the board',async()=>{const env=environment(undefined,false);await env.init();assert.equal(env.calls.length,0);await assert.rejects(env.adapter.save({},1),e=>e.code==='AUTH');});
test('signed-in nonmember receives no board',async()=>{const env=environment(undefined,false);await env.init();await env.adapter.signIn('member@example.test','not-a-real-password');await assert.rejects(env.adapter.fetchBoard(),e=>e.code==='MEMBER');});
test('network failures never report a successful save',async()=>{const env=environment();await env.init();env.setFailure();await assert.rejects(env.adapter.save({},1),e=>e.code==='NETWORK');});
test('signing out prevents further reads and writes',async()=>{const env=environment();await env.init();await env.adapter.signOut();await assert.rejects(env.adapter.fetchBoard(),e=>e.code==='AUTH');await assert.rejects(env.adapter.save({},1),e=>e.code==='AUTH');});
test('public starter contains no initial personal names or schedules',()=>{const window={};vm.runInNewContext(fs.readFileSync('data.js','utf8'),{window,location:{protocol:'https:',hostname:'example.github.io'},document:{}});assert.equal(window.TOKI_DATA.people.length,16);assert.equal(window.TOKI_DATA.people[0],'メンバー1');assert.ok(window.TOKI_DATA.availability.flat().every(value=>value===''));});
