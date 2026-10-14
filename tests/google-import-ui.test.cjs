const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function environment(t){
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/TOKI/',runScripts:'outside-only',virtualConsole});
  const w=dom.window,d=w.document,$=id=>d.getElementById(id);
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  for(const file of ['model.js','availability.js','calendar-import.js'])w.eval(fs.readFileSync(file,'utf8'));
  let connected=false,fingerprint='original',listHandler,busyHandler,loginFailure=false;
  const items=[{id:'mine',name:'個人',primary:true},{id:'shared',name:'共有カレンダー'},{id:'text',name:'<img src=x onerror=alert(1)>'}],fetches=[],saves=[];
  const board={schemaVersion:4,people:['A','B'],groups:[],events:[],meetings:[]};
  w.TokiGoogleCalendar={configured:true,get connected(){return connected;},load:async()=>{},login:async()=>{connected=false;if(loginFailure)throw Error('権限不足');connected=true;},logout:()=>{connected=false;},listCalendars:async signal=>listHandler?listHandler(signal):items,fetchBusy:async(range,ids,signal)=>{fetches.push({range,ids:[...ids],signal});if(busyHandler)return busyHandler(range,ids,signal);return ids.includes('shared')?[{start:Date.parse('2026-10-05T11:10:00+09:00'),end:Date.parse('2026-10-05T11:50:00+09:00')}]:[];}};
  w.eval(fs.readFileSync('google-import-ui.js','utf8'));
  w.TokiGoogleImportUI({context:()=>({board,fingerprint,pending:false}),selected:()=> '2026-10-05',canOpen:()=>true,apply:async(plan,version)=>{saves.push({plan,version});return true;}});
  t.after(()=>{dom.window.close();assert.deepEqual(errors.map(e=>e.message),[]);});
  async function click(id){$(id).click();await flush();}
  const inputs=()=>[...$('google-calendar-list').querySelectorAll('input')];
  const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('input'));};
  return {w,d,$,items,fetches,saves,click,inputs,input,setList:fn=>listHandler=fn,setBusy:fn=>busyHandler=fn,failLogin:()=>loginFailure=true,update:()=>fingerprint='changed',async open(){await click('google-import-button');if(!connected)await click('google-login');},setRange(){input('google-time-min','2026-10-05T09:00');input('google-time-max','2026-10-05T14:00');}};
}

test('calendar selection starts with all checked and names remain plain text',async t=>{
  const e=await environment(t);await e.open();assert.equal(e.inputs().length,3);assert.ok(e.inputs().every(c=>c.checked));assert.equal(e.$('google-calendars-all').checked,true);
  assert.equal(e.$('google-preview-button').disabled,false);assert.equal(e.$('google-calendar-list').querySelector('img'),null);assert.match(e.$('google-calendar-list').textContent,/<img/);
  e.inputs()[1].click();assert.equal(e.$('google-calendars-all').indeterminate,true);assert.equal(e.$('google-calendar-count').textContent,'2 / 3件を選択');
  await e.click('google-calendars-all');assert.ok(e.inputs().every(c=>c.checked));await e.click('google-calendars-all');assert.ok(e.inputs().every(c=>!c.checked));assert.equal(e.$('google-preview-button').disabled,true);
  await e.click('google-preview-button');assert.equal(e.fetches.length,0);
});

test('selected-calendar busy time affects preview, selection changes invalidate it, save requires explicit action',async t=>{
  const e=await environment(t);await e.open();e.setRange();await e.click('google-preview-button');
  assert.deepEqual(e.fetches[0].ids,['mine','shared','text']);assert.match(e.$('google-import-rows').textContent,/09:00〜11:00、12:00〜14:00/);assert.equal(e.saves.length,0);
  e.inputs()[1].click();assert.equal(e.$('google-import-preview').hidden,true);assert.equal(e.$('google-apply-button').disabled,true);
  await e.click('google-preview-button');assert.deepEqual(e.fetches[1].ids,['mine','text']);assert.match(e.$('google-import-rows').textContent,/09:00〜14:00/);assert.match(e.$('google-import-summary').textContent,/2件のカレンダー/);
  await e.click('google-apply-button');assert.equal(e.saves.length,1);assert.equal(e.$('google-import-dialog').open,false);
});

test('list failure and empty lists disable import; retry reloads all choices',async t=>{
  const e=await environment(t);e.setList(()=>{throw Error('一覧取得失敗');});await e.open();assert.equal(e.inputs().length,0);assert.equal(e.$('google-preview-button').disabled,true);assert.equal(e.$('google-calendars-refresh').disabled,false);
  e.setList(()=>[]);await e.click('google-calendars-refresh');assert.match(e.$('google-import-error').textContent,/カレンダーがありません/);assert.equal(e.$('google-preview-button').disabled,true);
  e.setList(()=>e.items);await e.click('google-calendars-refresh');assert.ok(e.inputs().every(c=>c.checked));assert.equal(e.$('google-preview-button').disabled,false);
  e.inputs()[0].click();await e.click('google-calendars-refresh');assert.ok(e.inputs().every(c=>c.checked));
});

test('closing during list retrieval aborts it and ignores the stale result after reopening',async t=>{
  const e=await environment(t);let resolveOld,oldSignal;
  e.setList(signal=>{oldSignal=signal;return new Promise(resolve=>resolveOld=resolve);});await e.open();assert.equal(e.$('google-preview-button').disabled,true);
  await e.click('close-google-import');assert.equal(oldSignal.aborted,true);e.setList(()=>[{id:'new',name:'新しい一覧'}]);await e.open();resolveOld(e.items);await flush();
  assert.deepEqual(e.inputs().map(c=>c.value),['new']);assert.equal(e.$('google-import-dialog').open,true);
});

test('busy retrieval failure and concurrent board updates cannot produce a savable preview',async t=>{
  const e=await environment(t);await e.open();e.setRange();e.setBusy(()=>{throw Error('一部カレンダーの取得失敗');});await e.click('google-preview-button');assert.equal(e.$('google-import-preview').hidden,true);assert.equal(e.$('google-apply-button').disabled,true);
  e.setBusy(()=>{e.update();return [];});await e.click('google-preview-button');assert.match(e.$('google-import-error').textContent,/更新/);assert.equal(e.$('google-import-preview').hidden,true);assert.equal(e.saves.length,0);
});

test('changing the Google account or logging out clears prior calendar IDs and preview',async t=>{
  const e=await environment(t);await e.open();e.setRange();await e.click('google-preview-button');e.setList(()=>[{id:'other',name:'別アカウント'}]);await e.click('google-login');
  assert.deepEqual(e.inputs().map(c=>c.value),['other']);assert.equal(e.$('google-import-preview').hidden,true);await e.click('google-logout');assert.equal(e.inputs().length,0);assert.equal(e.$('google-preview-button').disabled,true);
  e.failLogin();await e.click('google-login');assert.equal(e.inputs().length,0);assert.equal(e.$('google-calendars').hidden,true);
});

test('editing the person or requested period invalidates old preview before saving',async t=>{
  const e=await environment(t);await e.open();e.setRange();await e.click('google-preview-button');e.input('google-import-person','1');assert.equal(e.$('google-import-preview').hidden,true);assert.equal(e.$('google-apply-button').disabled,true);
  await e.click('google-preview-button');e.input('google-time-min','2026-10-05T10:00');assert.equal(e.$('google-import-preview').hidden,true);assert.equal(e.saves.length,0);
});
