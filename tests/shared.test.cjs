const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('shared.js','utf8'),token='a'.repeat(64);
const board=()=>({payload:{schemaVersion:3,people:['Member'],groups:[],dates:[],events:[]},version:1});
function environment(store={board:board()},storage=new Map(),hash=`#share=${token}`){
  let failure=null;const calls=[],notifications=[],errors=[],states=[],listeners={},navigator={onLine:true};
  const client={async rpc(name,args){calls.push({name,args});if(failure)return {error:{message:failure}};if(args.p_token!==token)return {error:{message:'LINK'}};if(['save_calendar','save_availability'].includes(args.p_action)){if(args.p_version!==store.board.version)return {error:{message:'CONFLICT'}};store.board={payload:structuredClone(args.p_payload),version:args.p_version+1};}return {data:structuredClone(store.board)};}};
  const window={TOKI_CONFIG:{url:'https://example.supabase.co',publishableKey:'public-test',boardId:'october-2026',siteUrl:'https://example.test/'},TokiSupabase:{createClient:()=>client},addEventListener:(name,callback)=>{listeners[name]=callback;}};
  vm.runInNewContext(fs.readFileSync('model.js','utf8'),{window});
  const document={hidden:false,createElement:()=>({}),head:{append:s=>queueMicrotask(()=>s.onload())},addEventListener(){}};
  vm.runInNewContext(source,{window,document,navigator,location:{protocol:'https:',hostname:'example.github.io',search:'',hash},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},URLSearchParams,setInterval:()=>0});
  return {adapter:window.TokiShared,calls,notifications,errors,states,navigator,listeners,init(){return window.TokiShared.initialize({board:b=>notifications.push(b),error:e=>errors.push(e),state:s=>states.push(s)});},setFailure(value='offline'){failure=value;}};
}
test('first visitor immediately reads board without registering or adding a row',async()=>{const e=environment();await e.init();assert.equal(e.notifications[0].payload.people.length,1);assert.equal(e.calls.length,1);assert.equal(e.calls[0].args.p_action,'read_availability');assert.equal(Object.hasOwn(e.calls[0].args,'p_registration'),false);});
test('group and roster edits use the versioned calendar save',async()=>{const e=environment();await e.init();const p={...board().payload,groups:[{id:'g',name:'Team',members:[0]}]};const saved=await e.adapter.save(p,1);assert.deepEqual(saved.payload,p);assert.equal(saved.version,2);});
test('availability and fixed MTG participants use the new save endpoint and survive offline caching',async()=>{
  const storage=new Map(),e=environment(undefined,storage);await e.init();
  const p={schemaVersion:4,people:['Member'],groups:[{id:'g',name:'Team',members:[0]}],events:[],meetings:[{id:'m',group:'g',members:[0],date:'2026-10-15',start:600,end:660}]};
  await e.adapter.save(p,1);assert.equal(e.calls.at(-1).args.p_action,'save_availability');
  const offline=environment(undefined,storage);offline.setFailure();await offline.init();assert.deepEqual(structuredClone(offline.notifications[0].payload),p);
});
test('two clients cannot overwrite a newer roster or schedule',async()=>{const store={board:board()},a=environment(store),b=environment(store);await a.init();await b.init();await a.adapter.save({...store.board.payload,people:['Renamed']},1);await assert.rejects(b.adapter.save(board().payload,1),e=>e.code==='CONFLICT');assert.equal(store.board.payload.people[0],'Renamed');});
test('stored link works on revisit without participant identity',async()=>{const storage=new Map(),a=environment(undefined,storage);await a.init();const b=environment(undefined,storage,'');await b.init();assert.equal(b.notifications.length,1);});
test('missing or invalid link never exposes the board',async()=>{const a=environment(undefined,undefined,'');await assert.rejects(a.init(),e=>e.code==='LINK');assert.equal(a.calls.length,0);const b=environment(undefined,undefined,`#share=${'b'.repeat(64)}`);await assert.rejects(b.init(),e=>e.code==='LINK');assert.equal(b.notifications.length,0);});
test('network failure does not report save success',async()=>{const e=environment();await e.init();e.setFailure();await assert.rejects(e.adapter.save(board().payload,1),e=>e.code==='NETWORK');});

test('offline restart shows last successful shared snapshot and refuses writes',async()=>{
  const storage=new Map(),a=environment(undefined,storage);await a.init();
  const b=environment(undefined,storage,'');b.navigator.onLine=false;await b.init();
  assert.equal(b.calls.length,0);assert.equal(b.adapter.online,false);
  assert.deepEqual(structuredClone(b.notifications[0].payload),board().payload);assert.ok(b.states.at(-1).fetchedAt);
  await assert.rejects(b.adapter.save(board().payload,1),e=>e.code==='NETWORK');assert.equal(b.calls.length,0);
});
test('reconnection fetches a newer version before re-enabling edits',async()=>{
  const storage=new Map(),store={board:board()},a=environment(store,storage);await a.init();
  const b=environment(store,storage);b.setFailure();await b.init();assert.equal(b.adapter.online,false);
  store.board={payload:{...board().payload,people:['Updated']},version:2};
  b.setFailure(null);await b.listeners.online();assert.equal(b.adapter.online,true);
  assert.equal(b.notifications.at(-1).version,2);assert.equal(b.notifications.at(-1).payload.people[0],'Updated');
});
test('an unknown token cannot read another link cached on the device',async()=>{
  const storage=new Map(),a=environment(undefined,storage);await a.init();
  const b=environment(undefined,storage,`#share=${'b'.repeat(64)}`);b.setFailure();
  await assert.rejects(b.init(),e=>e.code==='NETWORK');assert.equal(b.notifications.length,0);
});
test('server rejection invalidates the matching offline snapshot',async()=>{
  const storage=new Map(),a=environment(undefined,storage);await a.init();a.setFailure('LINK');await a.adapter.refresh();
  assert.equal(a.adapter.online,false);assert.equal(storage.has('toki-offline-v1:october-2026'),false);
  const b=environment(undefined,storage);b.setFailure();await assert.rejects(b.init(),e=>e.code==='NETWORK');assert.equal(b.notifications.length,0);
});
test('successful save is the snapshot available offline; failed save is not',async()=>{
  const storage=new Map(),a=environment(undefined,storage);await a.init();
  await a.adapter.save({...board().payload,people:['Saved']},1);a.setFailure();
  await assert.rejects(a.adapter.save({...board().payload,people:['Unsaved']},2));
  const b=environment(undefined,storage);b.setFailure();await b.init();
  assert.equal(b.notifications[0].payload.people[0],'Saved');assert.equal(b.notifications[0].version,2);
});
test('corrupt cached data is never displayed',async()=>{
  const storage=new Map(),a=environment(undefined,storage);await a.init();
  const cached=JSON.parse(storage.get('toki-offline-v1:october-2026'));cached.board.payload.people=null;
  storage.set('toki-offline-v1:october-2026',JSON.stringify(cached));
  const b=environment(undefined,storage);b.setFailure();await assert.rejects(b.init());assert.equal(b.notifications.length,0);
});
test('a late older read cannot replace the offline copy of a successful save',async()=>{
  const storage=new Map(),store={board:board()},a=environment(store,storage);await a.init();
  await a.adapter.save({...board().payload,people:['Newer saved version']},1);
  store.board=board();await a.adapter.refresh();
  const b=environment(store,storage);b.setFailure();await b.init();
  assert.equal(b.notifications[0].version,2);assert.equal(b.notifications[0].payload.people[0],'Newer saved version');
});
test('public starter has no private initial names or schedules',()=>{const window={};vm.runInNewContext(fs.readFileSync('data.js','utf8'),{window,location:{protocol:'https:',hostname:'example.github.io'},document:{}});assert.equal(window.TOKI_DATA.people[0],'メンバー1');assert.ok(window.TOKI_DATA.availability.flat().every(v=>v===''));});
